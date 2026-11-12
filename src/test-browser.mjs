import test from 'node:test';
import assert from 'node:assert/strict';
import { chapters, parseInputs, formatResult, runWorker, mountTutorial, loadChapterSource } from './browser.mjs';
import { mountCodeBox } from './editor.mjs';
import { readFile } from 'node:fs/promises';
import { compile } from './generated/compiler.mjs';
import { formatValue } from './editor-execution-worker.mjs';
import { dispatch, validateArgs, toBendList } from './browser-worker.mjs';

const expected = [
  '42', '49', '25', '10', '44', '[7, 7, 7]',
  'Hello, functional adventurer!', 'Some(42)', '1024', '2 = 2',
  '([0, 0, 0, 0, 0, 42, 0, 0], 42)',
];

test('all eleven original adapter defaults execute the actual compiled Bend adapters', async () => {
  const demos = chapters.flatMap((chapter) => chapter.demos);
  assert.equal(demos.length, 11);
  for (const [i, demo] of demos.entries()) {
    const inputs = Object.fromEntries(demo.fields.map((field) => [field.name, String(field.value)]));
    const result = await dispatch(demo.operation, parseInputs(demo, inputs));
    assert.equal(formatResult(result), expected[i], demo.operation);
  }
});

test('user input reaches the compiled functions, including failure and wrapped reads', async () => {
  assert.equal(formatResult(await dispatch('square', [9])), '81');
  assert.equal(formatResult(await dispatch('sum', [[]])), '0');
  assert.equal(formatResult(await dispatch('area', [1, 4])), '48');
  assert.equal(formatResult(await dispatch('parse', ['40', 'biscuits'])), 'None');
  assert.equal(formatResult(await dispatch('array', [99, 13])), '([0, 0, 0, 0, 0, 99, 0, 0], 99)');
});

test('original adapter input parser accepts an empty list, but rejects malformed lists and unsafe integers', () => {
  const sum = chapters[3].demos[0];
  assert.deepEqual(parseInputs(sum, { xs: '' }), [[]]);
  for (const xs of ['1,,2', '-1', '1.5', '4294967296', Array(129).fill(1).join(',')]) {
    assert.throws(() => parseInputs(sum, { xs }));
  }
  assert.throws(() => parseInputs(chapters[1].demos[0], { x: '9007199254740992' }));
  assert.deepEqual(toBendList([7]), { $: 'Con', head: 7, tail: { $: 'Nil' } });
});

test('worker boundary enforces the operation whitelist, arity, and workload limits', async () => {
  for (const [operation, args] of [
    ['constructor', []], ['toString', []], ['square', []], ['square', [-1]],
    ['square', [1.5]], ['area', [2, 5]], ['sum', [Array(129).fill(1)]],
    ['replicate', [65, 7]], ['pow2', [17]], ['law_sample', [257]],
    ['greeting', ['x'.repeat(1025)]], ['parse', [1, '2']],
  ]) {
    assert.throws(() => validateArgs(operation, args));
    await assert.rejects(dispatch(operation, args));
  }
});

test('result formatting only accepts the supported runtime shapes', () => {
  assert.equal(formatResult({ $: 'None' }), 'None');
  assert.throws(() => formatResult({ unexpected: true }));
  assert.throws(() => formatResult({ $: 'Con', head: 1, tail: null }));
});

function mockWorker(t, action) {
  const original = globalThis.Worker;
  const workers = [];
  globalThis.Worker = class {
    constructor(url, options) {
      assert.match(url.pathname, /browser-worker\.mjs$/);
      assert.equal(options.type, 'module');
      this.terminated = false;
      workers.push(this);
    }
    postMessage(message) { action(this, message); }
    terminate() { this.terminated = true; }
  };
  t.after(() => {
    if (original === undefined) delete globalThis.Worker;
    else globalThis.Worker = original;
  });
  return workers;
}

test('each run creates and terminates a fresh worker after its result', async (t) => {
  const workers = mockWorker(t, (worker) => queueMicrotask(() => worker.onmessage({ data: { ok: true, value: 42 } })));
  assert.equal(await runWorker('values', []), 42);
  assert.equal(await runWorker('values', []), 42);
  assert.equal(workers.length, 2);
  assert.ok(workers.every((worker) => worker.terminated));
});

test('worker-reported failures and loading errors clean up workers', async (t) => {
  const workers = mockWorker(t, (worker) => queueMicrotask(() => worker.onmessage({ data: { ok: false, error: 'Bend failed' } })));
  await assert.rejects(runWorker('values', []), /Bend failed/);
  assert.ok(workers[0].terminated);
  workers.length = 0;
  globalThis.Worker.prototype.postMessage = function () {
    queueMicrotask(() => this.onerror({ preventDefault() {} }));
  };
  await assert.rejects(runWorker('values', []), /compiled Bend worker/);
  assert.ok(workers[0].terminated);
});

test('stalled workers time out and terminate instead of hanging the page', async (t) => {
  const workers = mockWorker(t, () => {});
  await assert.rejects(runWorker('values', [], 10), /timed out/);
  assert.ok(workers[0].terminated);
});

// Minimal DOM for mounting/lifecycle checks; real compiler assertions remain real.
class Element {
  constructor(tag, text = '') {
    this.tagName = tag;
    this.textContent = text;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.className = '';
  }
  get textContent() { return (this.text ?? '') + (this.children ?? []).map(child => child.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  before(node) {
    node.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this), 0, node);
  }
  replaceWith(node) {
    node.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this), 1, node);
    this.parent = undefined;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name, event = {}) { this.listeners[name]?.(event); }
  matches(selector) {
    if (selector === '[data-tutorial-browser]') return this.dataset.tutorialBrowser !== undefined;
    if (selector === '[data-codebox]') return this.dataset.codebox !== undefined;
    const [tag, className] = selector.split('.');
    return (!tag || this.tagName === tag) && (!className || this.className.split(' ').includes(className));
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(selector.split(',').some((part) => child.matches(part.trim())) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
}
function fakeDOM(t, root = new Element('body')) {
  const originals = { document: globalThis.document, location: globalThis.location };
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
  };
  globalThis.location = { protocol: 'http:' };
  t.after(() => {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });
  return root;
}
function stubFetch(t, action) {
  const original = globalThis.fetch;
  globalThis.fetch = action;
  t.after(() => { globalThis.fetch = original; });
}
function editorWorkers(t, action) {
  const original = globalThis.Worker;
  const workers = [];
  globalThis.Worker = class {
    constructor(url) { this.url = url.pathname; this.terminated = false; workers.push(this); }
    postMessage(payload) { this.payload = payload; action?.(this, payload); }
    terminate() { this.terminated = true; }
  };
  t.after(() => { globalThis.Worker = original; });
  return workers;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settled(box) {
  const output = box.querySelector('output');
  const deadline = Date.now() + 10000;
  while (output.dataset.state === 'pending' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.notEqual(output.dataset.state, 'pending', `box run completed: ${output.textContent}`);
  return output;
}
const decodeHTML = (text) => text.replace(/<[^>]*>/g, '').replace(/&(lt|gt|amp|quot|#39);/g,
  (_, name) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'" })[name]);

test('all 18 existing HTML Bend fences mount in place and Run real contextual programs', async (t) => {
  const root = fakeDOM(t);
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<h2\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>|<pre\b[^>]*class="([^"]+)"[^>]*>([\s\S]*?)<\/pre>/g)) {
    const element = new Element(match[1] ? 'h2' : 'pre', decodeHTML(match[2] ?? match[4]));
    element.id = match[1] ?? '';
    element.className = match[3] ?? '';
    root.append(element);
  }
  const originalBend = root.querySelectorAll('pre.bend');
  assert.equal(originalBend.length, 18);
  const staticBlocks = root.querySelectorAll('pre').filter((pre) => !pre.matches('pre.bend'));
  const originalOrder = [...root.children];
  const gets = new Map();
  stubFetch(t, async (url, options) => {
    assert.equal(options.method, undefined, 'default GET only');
    const filename = url.pathname.split('/').at(-1);
    gets.set(filename, (gets.get(filename) ?? 0) + 1);
    return { ok: true, text: () => readFile(url, 'utf8') };
  });
  const workers = editorWorkers(t, (worker, payload) => {
    queueMicrotask(async () => {
      try {
        if (worker.url.endsWith('editor-compiler-worker.mjs')) {
          worker.onmessage({ data: { ok: true, ...compile(payload.source) } });
        } else {
          assert.match(worker.url, /editor-execution-worker\.mjs$/);
          const module = await import(`data:text/javascript;base64,${Buffer.from(payload.javascript).toString('base64')}`);
          worker.onmessage({ data: { ok: true, result: formatValue(module.default.main()) } });
        }
      } catch (error) { worker.onmessage({ data: { ok: false, error: error.message } }); }
    });
  });
  mountTutorial();
  mountTutorial();
  const boxes = root.querySelectorAll('[data-codebox]');
  assert.equal(boxes.length, 18);
  assert.deepEqual(root.querySelectorAll('pre.bend'), originalBend);
  assert.deepEqual(root.querySelectorAll('pre').filter(pre => !pre.matches('pre.bend')), staticBlocks);
  assert.equal(root.querySelectorAll('details, summary').length, 0);
  assert.equal(gets.size, 0, 'code is visible before fetching any context');
  assert.deepEqual(root.children.filter((child) => child.dataset.tutorialBrowser === undefined),
    originalOrder.map((child) => child.matches('pre.bend') ? boxes[originalBend.indexOf(child)] : child));
  const results = ['42', '42', '49', '50', '25', '25', '10', '44', '44', '44', '[7, 7, 7]',
    'Hello, functional adventurer!', 'Some(42)', 'Some(42)', '1024', '1024', 'null (erased at runtime)',
    '([0, 0, 0, 0, 0, 42, 0, 0], 42)'];
  const labels = new Set();
  for (const [index, box] of boxes.entries()) {
    assert.equal(box.dataset.codebox, String(index));
    const textarea = box.querySelector('textarea');
    assert.equal(textarea.value, box.starter);
    assert.equal(box.originalSnippet, originalBend[index].textContent);
    assert.equal(box.querySelector('pre'), originalBend[index], 'original semantic pre stays in the article');
    assert.equal(box.querySelector('pre').querySelector('code').textContent, box.originalSnippet);
    if (!box.originalSnippet.includes('def main() -> IO(Unit):')) assert.equal(textarea.value, box.originalSnippet);
    else assert.match(box.querySelector('.bend-demo-note').textContent, /Pure IO main variant/);
    assert.equal(textarea.spellcheck, false);
    assert.equal(textarea.wrap, 'off');
    assert.ok(textarea.rows >= 3 && textarea.rows <= 24);
    labels.add(textarea.attributes['aria-label']);
    assert.equal(box.querySelectorAll('.bend-demo-run').length, 1);
    const button = box.querySelector('.bend-demo-run');
    assert.equal(button.textContent, 'Run');
    button.fire('click');
    const output = await settled(box);
    assert.equal(output.dataset.state, 'success', output.textContent);
    assert.equal(output.dataset.phase, 'runtime');
    assert.ok(output.textContent.includes(`Result: ${results[index]}`), output.textContent);
  }
  assert.equal(labels.size, 18);
  assert.equal(gets.size, 10);
  assert.ok([...gets.values()].every((count) => count === 1));
  assert.equal(workers.length, 36);
  assert.ok(workers.every((worker) => worker.terminated));
  const square = boxes[2];
  square.querySelector('textarea').value = square.starter.replace('x * x', 'x + x');
  square.querySelector('.bend-demo-run').fire('click');
  assert.match((await settled(square)).textContent, /Result: 14/);
  assert.equal(boxes[3].querySelector('textarea').value, boxes[3].starter, 'other box edits stay independent');
  boxes[3].querySelector('.bend-demo-run').fire('click');
  assert.match((await settled(boxes[3])).textContent, /Result: 50/);
  assert.equal(gets.get('02-functions.bend'), 1);
});

test('custom heading IDs use data-chapter-source for real contextual compilation', async (t) => {
  const root = fakeDOM(t);
  const heading = new Element('h2', 'Functions with a custom publication ID');
  heading.id = 'custom-functions-heading';
  heading.dataset.chapterSource = '02-functions.bend';
  assert.ok(!chapters.some(chapter => chapter.id === heading.id));
  const pre = new Element('pre', 'def main() -> U32:\n  square(9)\n');
  pre.className = 'bend';
  root.append(heading, pre);
  const original = await readFile(new URL('./02-functions.bend', import.meta.url), 'utf8');
  stubFetch(t, async (url) => {
    assert.ok(url.pathname.endsWith('/02-functions.bend'));
    return { ok: true, text: async () => original };
  });
  const workers = editorWorkers(t, (worker, payload) => {
    queueMicrotask(async () => {
      try {
        if (worker.url.endsWith('editor-compiler-worker.mjs')) {
          worker.onmessage({ data: { ok: true, ...compile(payload.source) } });
        } else {
          const module = await import(`data:text/javascript;base64,${Buffer.from(payload.javascript).toString('base64')}`);
          worker.onmessage({ data: { ok: true, result: formatValue(module.default.main()) } });
        }
      } catch (error) { worker.onmessage({ data: { ok: false, error: error.message } }); }
    });
  });
  mountTutorial();
  const box = root.querySelector('[data-codebox]');
  assert.equal(box.dataset.source, heading.dataset.chapterSource);
  box.querySelector('.bend-demo-run').fire('click');
  const output = await settled(box);
  assert.equal(output.dataset.state, 'success', output.textContent);
  assert.match(output.textContent, /Type: U32\nResult: 81$/);
  assert.equal(box.originalSource, original);
  assert.match(workers[0].payload.source, /def square/);
  assert.equal(workers.length, 2);
  assert.ok(workers.every(worker => worker.terminated));
});

function singleBox(t, source, options = {}) {
  const root = fakeDOM(t);
  const pre = new Element('pre', source);
  root.append(pre);
  return mountCodeBox(pre, { index: 0, heading: 'Test heading', ...options });
}

test('semantic reader listing preserves pre/code and safely tracks ordinary edits and Reset', (t) => {
  const root = fakeDOM(t, new Element('article'));
  const source = 'def main() -> U32:\n  42\n';
  const pre = new Element('pre');
  const code = new Element('code', source);
  pre.className = 'bend';
  code.className = 'sourceCode';
  pre.append(code);
  root.append(pre);
  const box = mountCodeBox(pre, { index: 0 });
  assert.equal(root.children[0], box);
  assert.equal(box.querySelector('pre'), pre);
  assert.equal(pre.querySelector('code'), code, 'keep the original semantic code element');
  assert.ok(pre.matches('.bend-reader-source'));
  for (const element of [box, pre, code]) {
    for (const name of ['hidden', 'aria-hidden', 'style']) assert.equal(element.attributes[name], undefined);
  }
  const textarea = box.querySelector('textarea');
  const edited = 'import Base\n// <script>alert("not HTML")</script>\ndef main() -> U32:\n  61\n';
  textarea.value = edited;
  textarea.fire('input');
  assert.equal(code.textContent, edited);
  assert.equal(code.children.length, 0, 'edits are text, never parsed HTML');
  assert.equal(box.originalSnippet, source);
  box.querySelector('.bend-editor-reset').fire('click');
  assert.equal(code.textContent, source);
});

test('reader and print listing retain original IO intent instead of pure-variant edits', (t) => {
  const original = 'def main() -> IO(Unit):\n  IO.print(greeting("functional adventurer"))\n';
  const box = singleBox(t, original, { filename: '07-effects.bend' });
  const textarea = box.querySelector('textarea');
  const code = box.querySelector('pre').querySelector('code');
  assert.notEqual(textarea.value, original);
  assert.equal(code.textContent, original);
  textarea.value = 'def main() -> U32:\n  99\n';
  textarea.fire('input');
  assert.equal(code.textContent, original);
  box.querySelector('.bend-editor-reset').fire('click');
  assert.equal(code.textContent, original);
  assert.equal(textarea.value, box.starter);
  assert.match(box.querySelector('.bend-demo-note').textContent, /Reader mode and print preserve the original terminal-IO listing/);
});

test('reader listing uses visual clipping, not Readability-invisible attributes or styles', async () => {
  const css = await readFile(new URL('./browser.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/\.bend-codebox \.bend-reader-source\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.equal(rules.length, 2, 'screen clipping and print restoration');
  assert.match(rules[0], /position:\s*absolute/);
  assert.match(rules[0], /clip-path:\s*inset\(50%\)/);
  assert.match(rules[0], /width:\s*1px/);
  assert.match(rules[0], /height:\s*1px/);
  for (const rule of rules) assert.doesNotMatch(rule, /display:\s*none|visibility:\s*hidden|content-visibility:\s*hidden/);
  assert.match(rules[1], /position:\s*static/);
  assert.match(rules[1], /clip-path:\s*none/);
});

test('standalone paste bypasses unavailable context; Reset aborts workers and restores only snippet', async (t) => {
  const source = 'def main() -> U32:\n  42\n';
  let fetches = 0;
  const box = singleBox(t, source, { filename: '01-values.bend', getChapterSource: async () => { fetches++; throw new Error('offline'); } });
  const workers = editorWorkers(t);
  const textarea = box.querySelector('textarea');
  const pasted = 'import Base\ndef main() -> U32:\n  61\n';
  textarea.value = pasted;
  let prevented = false;
  textarea.fire('keydown', { key: 'Enter', metaKey: true, preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(fetches, 0);
  assert.equal(workers[0].payload.source, pasted);
  box.querySelector('.bend-editor-reset').fire('click');
  await tick();
  assert.ok(workers[0].terminated);
  assert.equal(textarea.value, source);
  assert.equal(box.querySelector('output').dataset.state, 'ready');
  assert.equal(box.querySelector('output').dataset.phase, 'ready');
  assert.equal(box.querySelector('.bend-demo-run').disabled, false);
  box.querySelector('.bend-demo-run').fire('click');
  const output = await settled(box);
  assert.equal(output.dataset.phase, 'context');
  assert.match(output.textContent, /offline/);
  assert.equal(textarea.value, source, 'failed context never hides source');
});

test('Reset cancels a pending context run without changing shared originals or starting workers', async (t) => {
  let resolve;
  const box = singleBox(t, 'def main() -> U32:\n  42\n', {
    filename: '01-values.bend', getChapterSource: () => new Promise((done) => { resolve = done; }),
  });
  const workers = editorWorkers(t);
  box.querySelector('.bend-demo-run').fire('click');
  box.querySelector('.bend-editor-reset').fire('click');
  resolve('import Base\ndef main() -> U32:\n  42\n');
  await tick();
  assert.equal(workers.length, 0);
  assert.equal(box.querySelector('output').dataset.state, 'ready');
});

test('local file mode preserves editable small snippets and Reset but disables Run', (t) => {
  const box = singleBox(t, 'one line', { localFile: true });
  assert.equal(box.querySelector('textarea').rows, 3);
  assert.notEqual(box.querySelector('textarea').disabled, true);
  assert.equal(box.querySelector('.bend-demo-run').disabled, true);
  box.querySelector('.bend-editor-reset').fire('click');
  assert.equal(box.querySelector('.bend-demo-run').disabled, true);
});

test('chapter context GET failures are cached and include actionable filename errors', async (t) => {
  let calls = 0;
  stubFetch(t, async () => { calls++; return { ok: false, status: 503 }; });
  const first = loadChapterSource('unavailable-context.bend');
  assert.equal(loadChapterSource('unavailable-context.bend'), first);
  await assert.rejects(first, /unavailable-context\.bend.*HTTP 503.*import Base/);
  assert.equal(calls, 1);
});

test('chapter context GET and response body have a five-second bound and abort the fetch', async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  let signal;
  globalThis.setTimeout = (callback, delay) => {
    assert.equal(delay, 5000);
    return originalSetTimeout(callback, 5);
  };
  t.after(() => { globalThis.setTimeout = originalSetTimeout; });
  stubFetch(t, async (_, options) => {
    signal = options.signal;
    return { ok: true, text: () => new Promise(() => {}) };
  });
  await assert.rejects(loadChapterSource('stalled-context.bend'), /timed out after 5 seconds.*import Base/);
  assert.ok(signal.aborted);
});
