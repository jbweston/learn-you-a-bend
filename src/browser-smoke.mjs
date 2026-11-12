// Standalone opt-in test: nix run .#node -- src/browser-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const chromium = process.env.CHROMIUM || 'chromium';
const python = process.env.PYTHON || 'python3';
const controller = new AbortController();
const { signal } = controller;
const overallTimer = setTimeout(() => controller.abort(new Error('Browser smoke test exceeded 60 seconds.')), 60_000);
const children = [];
let profile;
let cdp;
let evaluate;
const pageErrors = [];
const networkRequests = [];
const parsedBlobs = [];
const workerSessions = new Set();

function launch(command, args) {
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const owned = { child, log: '', error: null, exited: false };
  children.push(owned);
  child.on('error', (error) => {
    owned.error = new Error(`Cannot launch ${command}: ${error.message}. Check the executable or set ${command === python ? 'PYTHON' : 'CHROMIUM'}.`);
  });
  child.on('exit', (code, terminationSignal) => {
    owned.exited = true;
    owned.exitDescription = `exit ${code}, signal ${terminationSignal}`;
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (text) => { owned.log = (owned.log + text).slice(-24_000); });
  }
  return owned;
}

function checkChild(owned) {
  if (owned.error) throw owned.error;
  if (owned.exited) throw new Error(`Child ${owned.child.spawnfile} stopped (${owned.exitDescription}):\n${owned.log}`);
}

async function poll(label, probe, timeout = 10_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    signal.throwIfAborted();
    last = await probe();
    if (last) return last;
    await delay(75, undefined, { signal });
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.nextId = 0;
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`));
        else request.resolve(message.result);
      } else if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.type === 'worker') {
              const workerSession = message.params.sessionId;
              workerSessions.add(workerSession);
              void Promise.all(['Network.enable', 'Debugger.enable'].map(method => this.send(method, {}, workerSession))).catch(error => pageErrors.push(error.message));
            } else if (message.method === 'Network.requestWillBeSent') {
              networkRequests.push(message.params.request);
            } else if (message.method === 'Debugger.scriptParsed' && message.params.url.startsWith('blob:')) {
              parsedBlobs.push({ url: message.params.url, session: message.sessionId });
            } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        pageErrors.push(details.exception?.description || details.text);
      }
    });
    this.fail = (error) => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
    };
    this.socket.addEventListener('close', () => this.fail(new Error('Chromium CDP connection closed.')));
    this.socket.addEventListener('error', () => this.fail(new Error('Chromium CDP WebSocket error.')));
    this.abort = () => { this.fail(signal.reason); this.socket.close(); };
    signal.addEventListener('abort', this.abort, { once: true });
  }

  async open() {
    await poll('CDP WebSocket connection', () => {
      if (this.socket.readyState === WebSocket.CLOSED) throw new Error('Could not connect to Chromium CDP.');
      return this.socket.readyState === WebSocket.OPEN;
    }, 5000);
  }

  send(method, params = {}, sessionId) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out after 5 seconds: ${method}`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    signal.removeEventListener('abort', this.abort);
    this.fail(new Error('CDP test finished.'));
    this.socket.close();
  }
}

// Kill only process groups created by our detached spawns, including workers.
async function stop(owned) {
  const pid = owned.child.pid;
  if (!pid) return;
  const kill = (terminationSignal) => {
    try { process.kill(-pid, terminationSignal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  kill('SIGTERM');
  await delay(300);
  kill('SIGKILL');
  await pollExit(owned);
}

async function pollExit(owned) {
  for (let attempt = 0; attempt < 20 && !owned.exited; attempt++) await delay(50);
  if (!owned.exited) throw new Error(`Child ${owned.child.spawnfile} did not terminate after SIGKILL.`);
}

const snapshotExpression = `Array.from(document.querySelectorAll('[data-codebox]'), box => ({
  index: Number(box.dataset.codebox),
  source: box.dataset.source,
  run: box.querySelector('.bend-demo-run')?.textContent,
  reset: box.querySelector('.bend-editor-reset')?.textContent,
  state: box.querySelector('output')?.dataset.state,
  phase: box.querySelector('output')?.dataset.phase,
  output: box.querySelector('output')?.textContent,
  text: box.querySelector('textarea')?.value,
  starter: box.starter,
  originalSnippet: box.originalSnippet,
  listing: box.querySelector('pre.bend-reader-source code')?.textContent,
  listingStyle: (() => {
    const pre = box.querySelector('pre.bend-reader-source');
    if (!pre) return null;
    const style = getComputedStyle(pre);
    return { display: style.display, visibility: style.visibility, clipPath: style.clipPath,
      width: style.width, height: style.height, hidden: pre.hidden, ariaHidden: pre.getAttribute('aria-hidden') };
  })(),
  originalSource: box.originalSource,
  disabled: box.querySelector('.bend-demo-run')?.disabled,
  editable: !box.querySelector('textarea')?.disabled && !box.querySelector('textarea')?.readOnly,
  visible: box.getClientRects().length > 0 && getComputedStyle(box).visibility === 'visible',
  spellcheck: box.querySelector('textarea')?.spellcheck,
  label: box.querySelector('textarea')?.getAttribute('aria-label'),
  controls: box.querySelectorAll('textarea').length
}))`;

async function editorSnapshot(index) {
  return (await evaluate(snapshotExpression)).find(row => row.index === index);
}

async function edit(index, source, state, expected, phase = 'runtime', timeout = 10_000) {
  await evaluate(`(() => {
    const box = document.querySelector('[data-codebox="${index}"]');
    const textarea = box.querySelector('textarea');
    textarea.value = ${JSON.stringify(source)};
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    box.querySelector('.bend-demo-run').click();
  })()`);
  const result = await poll(`box ${index} ${state}`, async () => {
    const current = await editorSnapshot(index);
    if (current.state === 'error' && state !== 'error') throw new Error(`Box ${index}: ${current.output}`);
    return current.state === state && !current.disabled ? current : null;
  }, timeout);
  if (expected instanceof RegExp) assert.match(result.output, expected);
  else assert.equal(result.output.split('\n').find(line => line.startsWith('Result: ')), `Result: ${expected}`, `box ${index}: ${result.output}`);
  assert.equal(result.phase, phase);
  assert.equal(result.listing, result.originalSnippet.includes('def main() -> IO(Unit):') ? result.originalSnippet : source);
  console.log(`PASS box ${index} ${state}: ${result.output.slice(0, 240)}`);
  return result;
}

function replace(source, before, after) {
  assert.ok(source.includes(before), `Edit anchor missing: ${before}`);
  return source.replace(before, after);
}

async function resetBox(box, expected) {
  await evaluate(`document.querySelector('[data-codebox="${box.index}"] .bend-editor-reset').click()`);
  const reset = await editorSnapshot(box.index);
  assert.equal(reset.state, 'ready');
  assert.equal(reset.phase, 'ready');
  assert.equal(reset.disabled, false);
  assert.equal(reset.text, box.starter);
  assert.equal(reset.listing, box.originalSnippet);
  await edit(box.index, reset.text, 'success', expected);
}

async function heavyTimeout(box, source, phase, starterResult, other) {
  let interval;
  try {
    interval = await evaluate(`(() => {
      const panel = document.querySelector('[data-codebox="${box.index}"]');
      window.heavyHeartbeat = { ticks: 0, pendingTicks: 0, maxGap: 0, last: performance.now() };
      const timer = setInterval(() => {
        const heartbeat = window.heavyHeartbeat;
        const now = performance.now();
        heartbeat.ticks++;
        heartbeat.maxGap = Math.max(heartbeat.maxGap, now - heartbeat.last);
        heartbeat.last = now;
        const output = panel.querySelector('output');
        if (output.dataset.state === 'pending' && output.dataset.phase === ${JSON.stringify(phase)}) heartbeat.pendingTicks++;
      }, 100);
      panel.querySelector('textarea').value = ${JSON.stringify(source)};
      panel.querySelector('.bend-demo-run').click();
      return timer;
    })()`);
    await poll(`heavy ${phase} to start`, async () => {
      const current = await editorSnapshot(box.index);
      if (current.state !== 'pending') throw new Error(`Heavy ${phase} fixture ended early (${current.phase}): ${current.output}`);
      return current.phase === phase;
    }, 2000);
    // Interact after work has begun, not during worker startup or after its deadline.
    await delay(350, undefined, { signal });
    const before = await editorSnapshot(box.index);
    assert.equal(before.state, 'pending');
    assert.equal(before.phase, phase);
    const demoStart = Date.now();
    const number = phase === 'runtime' ? 12 : 13;
    const square = replace(other.starter, 'square(7)', `square(${number})`);
    await edit(other.index, square, 'success', String(number * number), 'runtime', 1500);
    const demoMilliseconds = Date.now() - demoStart;
    assert.ok(demoMilliseconds < 1500, `Square Run took ${demoMilliseconds}ms during ${phase}`);
    const after = await editorSnapshot(box.index);
    assert.equal(after.state, 'pending', `Heavy ${phase} must still be running when square completes`);
    assert.equal(after.phase, phase);
    const result = await poll(`heavy ${phase} timeout`, async () => {
      const current = await editorSnapshot(box.index);
      return current.state !== 'pending' && !current.disabled ? current : null;
    }, 7000);
    const heartbeat = await evaluate('window.heavyHeartbeat');
    console.log(`OBSERVED heavy ${phase}: phase=${result.phase}, state=${result.state}, output=${JSON.stringify(result.output)}, heartbeat=${heartbeat.pendingTicks} pending ticks / ${heartbeat.ticks} total at 100ms, max gap=${Math.round(heartbeat.maxGap)}ms, square=${demoMilliseconds}ms`);
    assert.equal(result.state, 'error');
    assert.equal(result.phase, phase);
    assert.equal(result.output, `${phase === 'runtime' ? 'Runtime error: Runtime' : 'Compilation error: Compilation'} timed out after 5 seconds.`);
    assert.ok(heartbeat.pendingTicks >= 10, `Only ${heartbeat.pendingTicks} main-thread ticks during pending ${phase}`);
    await resetBox(box, starterResult);
    await resetBox(other, '49');
    console.log(`PASS heavy ${phase}: page heartbeat and other box Run stayed responsive; Reset recovered both`);
  } finally {
    if (interval !== undefined && !signal.aborted) await evaluate(`clearInterval(${interval})`);
  }
}

async function checkReadability(readability, listings, label) {
  if (!readability) {
    console.log(`SKIP Mozilla Readability (${label}): set READABILITY_JS to a temporary Readability.js installation`);
    return;
  }
  const extracted = await evaluate(`(() => {
    ${readability}
    const article = new Readability(document.cloneNode(true)).parse();
    if (!article) throw new Error('Readability found no article');
    const doc = new DOMParser().parseFromString(article.content, 'text/html');
    return { listings: [...doc.querySelectorAll('pre code')].map(code => code.textContent),
      textareas: doc.querySelectorAll('textarea').length };
  })()`);
  for (const listing of listings) assert.ok(extracted.listings.includes(listing), `${label}: Readability preserves each Bend listing`);
  assert.equal(extracted.textareas, 0);
  console.log(`PASS Mozilla Readability (${label}): all ${listings.length} semantic Bend listings survive extraction; textareas removed`);
}

async function main() {
  if (typeof WebSocket !== 'function') throw new Error('Node with built-in WebSocket is required (use nix run .#node -- src/browser-smoke.mjs; Node 24).');
  for (const file of ['src/serve.py', 'src/index.html', 'src/browser.mjs', 'src/browser-worker.mjs', 'src/generated/examples.mjs', 'src/generated/compiler.mjs', 'src/editor.mjs', 'src/editor-compiler-worker.mjs', 'src/editor-execution-worker.mjs']) {
    try { await access(path.join(root, file)); }
    catch { throw new Error(`Missing prerequisite ${file}; build the tutorial first.`); }
  }
  profile = await mkdtemp(path.join(os.tmpdir(), 'bend-browser-smoke-'));
  const server = launch(python, ['src/serve.py', '--port', '0']);
  const url = await poll('tutorial server URL', () => {
    checkChild(server);
    return server.log.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
  });
  const browser = launch(chromium, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', 'about:blank',
  ]);
  const endpoint = await poll('Chromium DevTools endpoint', async () => {
    checkChild(browser);
    const logged = browser.log.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    if (logged) return logged;
    try {
      const [port, socketPath] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
      if (/^\d+$/.test(port) && socketPath?.startsWith('/devtools/browser/')) return `ws://127.0.0.1:${port}${socketPath}`;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return null;
  });
  cdp = new CDP(endpoint);
  await cdp.open();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Debugger.enable', {}, sessionId);
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'interactive') return;
        window.originalFences = [...document.querySelectorAll('pre.bend')].map(pre => pre.textContent);
        window.staticFences = [...document.querySelectorAll('pre:not(.bend)')].map(pre => ({ className: pre.className, text: pre.textContent }));
      });
      window.editorWorkerAudit = [];
      const OriginalWorker = window.Worker;
      window.Worker = class extends OriginalWorker {
        constructor(url, options) {
          super(url, options);
          const row = { url: String(url), sent: [], terminated: 0 };
          window.editorWorkerAudit.push(row);
          const post = this.postMessage.bind(this), terminate = this.terminate.bind(this);
          this.postMessage = data => { row.sent.push({ keys: Object.keys(data), javascriptBytes: typeof data.javascript === 'string' ? new TextEncoder().encode(data.javascript).length : 0 }); post(data); };
          this.terminate = () => { row.terminated++; terminate(); };
        }
      };
      window.pageBlobCount = 0;
      const OriginalBlob = window.Blob;
      window.Blob = class extends OriginalBlob { constructor(...args) { super(...args); window.pageBlobCount++; } };
    ` }, sessionId);
  evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`Page evaluation: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    return result.result.value;
  };
  const navigation = await cdp.send('Page.navigate', { url }, sessionId);
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  const boxes = await poll('all 18 inline Bend code boxes to mount', async () => {
    const current = await evaluate(snapshotExpression);
    return current.length === 18 && current.every(box => box.state === 'ready') ? current : null;
  });
  assert.deepEqual(boxes.map(box => box.index), Array.from({ length: 18 }, (_, index) => index));
  const layout = await evaluate(`({
    bendPres: document.querySelectorAll('pre.bend').length,
    demos: document.querySelectorAll('[data-demo]').length,
    detailsEditors: document.querySelectorAll('details[data-editor], details[data-source], details textarea, details .bend-codebox').length,
    runs: document.querySelectorAll('.bend-demo-run').length,
    runLabels: [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Run').length,
    oldLabels: [...document.querySelectorAll('button, summary')].filter(button => /Compile\\s*&\\s*Run|Edit full source/.test(button.textContent)).length,
    textareas: document.querySelectorAll('textarea').length,
    originals: window.originalFences,
    staticBefore: window.staticFences,
    staticAfter: [...document.querySelectorAll('pre:not(.bend)')].map(pre => ({ className: pre.className, text: pre.textContent }))
  })`);
  assert.equal(layout.bendPres, 18);
  assert.equal(layout.demos, 0);
  assert.equal(layout.detailsEditors, 0);
  assert.equal(layout.runs, 18);
  assert.equal(layout.runLabels, 18);
  assert.equal(layout.oldLabels, 0);
  assert.equal(layout.textareas, 18);
  assert.deepEqual(layout.staticAfter, layout.staticBefore, 'Haskell/shell fences remain static and unchanged');
  assert.ok(layout.staticBefore.some(pre => /haskell/.test(pre.className)));
  assert.ok(layout.staticBefore.some(pre => /sh/.test(pre.className)));
  assert.deepEqual(boxes.map(box => box.originalSnippet), layout.originals, 'Existing Markdown fences become the editable boxes');
  for (const box of boxes) {
    assert.equal(box.run, 'Run');
    assert.equal(box.reset, 'Reset');
    assert.equal(box.disabled, false);
    assert.equal(box.editable, true);
    assert.equal(box.visible, true);
    assert.equal(box.controls, 1);
    assert.equal(box.spellcheck, false);
    assert.match(box.label, /Bend code box/);
    assert.equal(box.text, box.starter);
    assert.equal(box.listing, box.originalSnippet);
    assert.deepEqual(box.listingStyle, { display: 'block', visibility: 'visible', clipPath: 'inset(50%)',
      width: '1px', height: '1px', hidden: false, ariaHidden: null });
    if (box.originalSnippet.includes('def main() -> IO(Unit):')) {
      assert.doesNotMatch(box.starter, /IO\.print|def main\(\) -> IO/);
      assert.match(await evaluate(`document.querySelector('[data-codebox="${box.index}"] .bend-demo-note').textContent`), /Pure IO main variant/);
    } else assert.equal(box.starter, box.originalSnippet);
  }
  const unstyled = await evaluate(`(() => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument;
    for (const pre of document.querySelectorAll('pre.bend-reader-source')) doc.body.append(pre.cloneNode(true));
    const rows = [...doc.querySelectorAll('pre')].map(pre => ({ text: pre.querySelector('code').textContent,
      visible: pre.getBoundingClientRect().height > 1 && frame.contentWindow.getComputedStyle(pre).clipPath === 'none' }));
    frame.remove();
    return rows;
  })()`);
  assert.deepEqual(unstyled.map(row => row.text), layout.originals);
  assert.ok(unstyled.every(row => row.visible), 'listings become visible without page styles');
  // Optional temporary tooling; no Readability dependency is needed by the tutorial.
  const readability = process.env.READABILITY_JS ? await readFile(process.env.READABILITY_JS, 'utf8') : null;
  await checkReadability(readability, layout.originals, 'full tutorial');
  console.log('PASS layout: 18 visible editors with clipped semantic listings that appear without CSS; 18 Run/Reset pairs; Haskell/shell unchanged');
  const defaults = ['42', '42', '49', '50', '25', '25', '10', '44', '44', '44', '[7, 7, 7]',
    'Hello, functional adventurer!', 'Some(42)', 'Some(42)', '1024', '1024', 'null (erased at runtime)', '([0, 0, 0, 0, 0, 42, 0, 0], 42)'];
  for (const box of boxes) {
    await edit(box.index, box.starter, 'success', defaults[box.index]);
    const current = await editorSnapshot(box.index);
    if (current.originalSource !== undefined) {
      assert.equal(current.originalSource, await readFile(path.join(root, 'src', box.source), 'utf8'));
    }
  }
  const first = boxes[1];
  await edit(1, replace(first.starter, '6 * 7', '6 * 8'), 'success', '48');
  // Standalone imports bypass chapter context, including its original main.
  await edit(1, 'import Base\ndef square(+x: U32) -> U32:\n  (x * x : U32)\ndef main() -> U32:\n  square(9)\n', 'success', '81');
  await edit(4, boxes[4].starter, 'success', '25');
  await edit(5, boxes[5].starter, 'success', '25');
  await edit(5, replace(boxes[5].starter, '(s * s : U32)', '(s + s : U32)'), 'success', '10');
  await resetBox(boxes[5], '25');
  await edit(15, replace(boxes[15].starter, 'pow2(p) pow2(p)', 'pow2(p) U32.add(0, 1)'), 'success', '11');
  await resetBox(boxes[15], '1024');
  await edit(12, replace(boxes[12].starter, 'U32.read(a)', 'U32.read("biscuits")'), 'success', 'None');
  await resetBox(boxes[12], 'Some(42)');
  await edit(1, replace(first.starter, '(6 * 7 : U32)', '"wrong"'), 'error', /Compilation error:[\s\S]*expected[\s\S]*observed[\s\S]*Location:[\s\S]*\^/, 'compilation');
  await resetBox(first, '42');
  await edit(16, replace(boxes[16].starter, '== x : Nat', '== 1n+x : Nat'), 'error', /Compilation error:[\s\S]*expected[\s\S]*observed[\s\S]*Location:/, 'compilation');
  await resetBox(boxes[16], defaults[16]);
  for (const [source, expected] of [
    ['import Base\nimport https://example.invalid/evil.bend as Evil\ndef main() -> U32:\n  1\n', /only 'import Base'/],
    ['import Base\ndef main() -> IO(Unit):\n  IO.print("hello")\n', /foreign.*forbidden/],
    ['import Base\ndef main() -> IO(Unit):\n  IO.pure(Unit, Unit{})\n', /pure value, not IO/],
    ['import Base\ndef unused() -> IO(Unit):\n  IO.print("unused")\ndef main() -> U32:\n  1\n', /foreign.*forbidden/],
    ['import Base\ndef unused() -> IO(Unit):\n  import "./evil.js"\ndef main() -> U32:\n  1\n', /foreign.*forbidden/],
    ['import Base\n@unsafe\ndef unused() -> U32:\n  42\ndef main() -> U32:\n  1\n', /unsafe.*forbidden/],
    ['import Base\ndef unused?() -> U32:\n  42\ndef main() -> U32:\n  1\n', /unsafe.*forbidden/],
  ]) {
    await edit(1, source, 'error', expected, 'compilation');
    await resetBox(first, '42');
  }
  await edit(1, 'import Base\ndef main() -> (U32 -> U32) & U32:\n  (x => x, 1)\n', 'error', /Runtime error:.*function result/, 'runtime');
  await edit(1, 'import Base\ndef main() -> String:\n  "<script>window.bad = true</script>"\n', 'success', '<script>window.bad = true</script>');
  assert.equal(await evaluate('window.bad'), undefined);
  // Reset while compilation is pending: termination must prevent a stale result.
  await evaluate(`(() => {
    const box = document.querySelector('[data-codebox="1"]');
    box.querySelector('textarea').value = 'import Base\\ndef main() -> U32:\\n  61\\n';
    box.querySelector('.bend-demo-run').click();
    if (box.querySelector('output').dataset.phase !== 'compilation') throw new Error('Expected pending compilation');
    box.querySelector('.bend-editor-reset').click();
  })()`);
  await delay(150, undefined, { signal });
  assert.equal((await editorSnapshot(1)).state, 'ready');
  assert.equal((await editorSnapshot(1)).text, first.starter);
  await resetBox(first, '42');
  assert.match(boxes[14].starter, /def pow2/);
  const runtimeHeavy = `import Base\n${boxes[14].starter}\ndef main() -> U32:\n  pow2(30n)\n`;
  await heavyTimeout(boxes[14], runtimeHeavy, 'runtime', '1024', boxes[2]);
    const heavyProof = `import Base

  def heavy(+n: Nat) -> U32:
    match n:
      case 0n:
        0
      case 1n+p:
        a b = heavy(p) heavy(p)
        (a + b : U32)

  law expensive:
    {heavy(30n) == 0 : U32}

  def expensive():
    {==}

  def main() -> U32:
    0
  `;
    // The same proof succeeds at a small input: the timeout exercises real
      // normalization work, not a malformed source or synthetic worker stall.
      await edit(16, replace(heavyProof, 'heavy(30n)', 'heavy(4n)'), 'success', '0');
      await heavyTimeout(boxes[16], heavyProof, 'compilation', defaults[16], boxes[2]);
    const audit = await evaluate('window.editorWorkerAudit');
  const compilerWorkers = audit.filter(row => row.url.endsWith('/editor-compiler-worker.mjs'));
  const executionWorkers = audit.filter(row => row.url.endsWith('/editor-execution-worker.mjs'));
  assert.ok(compilerWorkers.length >= 18);
  assert.ok(executionWorkers.length >= 18);
  assert.equal(audit.length, compilerWorkers.length + executionWorkers.length, 'Only real compiler/execution workers; no fixed-demo adapters');
  for (const row of compilerWorkers) assert.deepEqual(row.sent.map(item => item.keys), [['source']]);
  for (const row of executionWorkers) {
    assert.deepEqual(row.sent.map(item => item.keys), [['javascript']]);
    assert.ok(row.sent[0].javascriptBytes > 0 && row.sent[0].javascriptBytes <= 2 * 1024 * 1024);
  }
  for (const row of audit) assert.equal(row.terminated, 1, row.url);
  assert.equal(await evaluate('window.pageBlobCount'), 0, 'Generated modules never become page Blobs');
  assert.ok(parsedBlobs.length >= 18, 'Observed generated ES modules in execution workers');
  assert.ok(parsedBlobs.every(item => workerSessions.has(item.session)), 'No generated Blob modules executed on the page');
  assert.equal(await evaluate('document.querySelectorAll("article.book-tutorial [data-codebox]").length'), 18);
  const contentsUrl = await evaluate('document.querySelector(".reading-mode a[href=\\"contents.html\\"]").href');
  assert.equal(contentsUrl, new URL('contents.html', url).href);
  const contentsNavigation = await cdp.send('Page.navigate', { url: contentsUrl }, sessionId);
  assert.ok(!contentsNavigation.errorText, contentsNavigation.errorText);
  const chapterSlug = '2-functions-and-the-suspicious-little-plus';
  const chapterUrl = await poll('contents link to individual functions chapter', () => evaluate(`
    location.pathname.endsWith('/contents.html') && document.readyState === 'complete'
      ? document.querySelector('.chapter-list a[href="${chapterSlug}.html"]')?.href : null
  `));
  assert.equal(chapterUrl, new URL(`${chapterSlug}.html`, url).href);
  const chapterNavigation = await cdp.send('Page.navigate', { url: chapterUrl }, sessionId);
  assert.ok(!chapterNavigation.errorText, chapterNavigation.errorText);
  const chapterBoxes = await poll('two individual functions chapter editors to mount', async () => {
    if (!await evaluate(`location.pathname.endsWith('/${chapterSlug}.html')`)) return null;
    const current = await evaluate(snapshotExpression);
    return current.length === 2 && current.every(box => box.state === 'ready') ? current : null;
  });
  assert.deepEqual(chapterBoxes.map(box => box.index), [0, 1]);
  assert.ok(chapterBoxes.every(box => box.source === '02-functions.bend' && box.visible && box.editable));
  const chapterLayout = await evaluate(`({
    articleSource: document.querySelector('article.book-chapter')?.dataset.chapterSource,
    headingSource: document.querySelector('article.book-chapter h2')?.dataset.chapterSource,
    editors: document.querySelectorAll('article.book-chapter [data-codebox]').length,
    navigation: [...document.querySelectorAll('.chapter-navigation')].map(nav => [...nav.querySelectorAll('a')].map(a => a.getAttribute('href'))),
    longPage: document.querySelector('.reading-mode a[href^="index.html"]')?.getAttribute('href'),
    originals: window.originalFences
  })`);
  assert.equal(chapterLayout.articleSource, '02-functions.bend');
  assert.equal(chapterLayout.headingSource, '02-functions.bend');
  assert.equal(chapterLayout.editors, 2);
  assert.deepEqual(chapterLayout.navigation, Array.from({ length: 2 }, () => [
    '1-values-not-a-shopping-list-of-commands.html', 'contents.html', '3-shapes-in-tiny-labelled-boxes.html',
  ]));
  assert.equal(chapterLayout.longPage, `index.html#${chapterSlug}`);
  assert.deepEqual(chapterBoxes.map(box => box.listing), chapterLayout.originals);
  await edit(0, chapterBoxes[0].starter, 'success', '49');
  const contextual = await edit(1, replace(chapterBoxes[1].starter, 'square(7)', 'square(9)'), 'success', '82');
  assert.equal(contextual.originalSource, await readFile(path.join(root, 'src/02-functions.bend'), 'utf8'));
  await checkReadability(readability, (await evaluate(snapshotExpression)).map(box => box.listing), 'individual functions chapter after edit');
  const chapterAudit = await evaluate('window.editorWorkerAudit');
  assert.equal(chapterAudit.filter(row => row.url.endsWith('/editor-compiler-worker.mjs')).length, 2);
  assert.equal(chapterAudit.filter(row => row.url.endsWith('/editor-execution-worker.mjs')).length, 2);
  assert.ok(chapterAudit.every(row => row.terminated === 1));
  assert.equal(await evaluate('window.pageBlobCount'), 0);
  console.log('PASS individual chapter: contents navigation, previous/next and long-page links, metadata context, real results 49/82, and synced reader listing');
  assert.ok(networkRequests.length > 0);
  for (const request of networkRequests) {
    assert.equal(request.method, 'GET', 'No POST/source uploads');
    assert.equal(request.hasPostData || false, false);
    assert.ok(request.url.startsWith(url) || request.url.startsWith('blob:'), `Unexpected network destination ${request.url}`);
    assert.doesNotMatch(request.url, /def%20|def\+|import%20/);
  }
  assert.deepEqual(pageErrors, [], 'Uncaught page errors');
  console.log(`PASS 18 inline defaults; contextual/standalone edits, None/parallel/type/proof/policy errors and Reset recovery; two 5-second heavy timeouts with responsive other Run and >=10 heartbeat ticks; ${compilerWorkers.length} compiler / ${executionWorkers.length} execution workers; no source uploads or page execution.`);
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL browser smoke: ${signal.aborted ? signal.reason.message : error.stack || error}`);
  if (evaluate && !signal.aborted) {
    try { console.error(`DOM outputs: ${JSON.stringify(await evaluate(snapshotExpression))}`); }
    catch (diagnosticError) { console.error(`Cannot collect DOM outputs: ${diagnosticError.message}`); }
  }
  for (const owned of children) console.error(`${owned.child.spawnfile} recent output:\n${owned.log}`);
  if (pageErrors.length) console.error(`Uncaught page errors: ${JSON.stringify(pageErrors)}`);
} finally {
  clearTimeout(overallTimer);
  cdp?.close();
  const cleanup = await Promise.allSettled(children.map(stop));
  for (const result of cleanup) {
    if (result.status === 'rejected') {
      process.exitCode = 1;
      console.error(`FAIL child cleanup: ${result.reason.message}`);
    }
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
