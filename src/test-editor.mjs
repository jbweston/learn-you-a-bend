import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compile } from './generated/compiler.mjs';
import { chapters } from './browser.mjs';
import { pureStarter, runProgram, SOURCE_LIMIT, JAVASCRIPT_LIMIT } from './editor.mjs';
import { formatValue } from './editor-execution-worker.mjs';

const program = (body, type = 'U32') => `import Base\ndef main() -> ${type}:\n  ${body}\n`;
async function realRun(source) {
  const { javascript, type } = compile(source);
  assert.ok(type.length > 0);
  const module = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
  return { type, result: formatValue(module.default.main()) };
}

const expected = ['42', '49', '25', '10', '44', '[7, 7, 7]', 'Hello, functional adventurer!', '1024', 'null (erased at runtime)', '([0, 0, 0, 0, 0, 42, 0, 0], 42)'];
for (const [index, chapter] of chapters.entries()) {
  test(`REAL compiler: ${chapter.source} starter compiles and executes`, async () => {
    const original = await readFile(new URL(chapter.source, import.meta.url), 'utf8');
    const seed = pureStarter(chapter.source, original);
    if (index === 6 || index === 7) {
      assert.match(original, /IO\.print/);
      assert.doesNotMatch(seed, /IO\.print/);
      assert.equal(seed.slice(0, seed.indexOf('def main')), original.slice(0, original.indexOf('def main')));
      assert.throws(() => compile(original), /foreign.*forbidden/);
    } else assert.equal(seed, original);
    assert.equal((await realRun(seed)).result, expected[index]);
  });
}

test('REAL compiler: accepted edits change results, not a fixed-input adapter', async () => {
  assert.deepEqual(await realRun(program('(6 * 8 : U32)')), { type: 'U32', result: '48' });
  assert.equal((await realRun(program('(60 + 1 : U32)'))).result, '61');
  assert.equal((await realRun(`import Base\ndef square(+x: U32) -> U32:\n  (x * x : U32)\ndef main() -> U32:\n  square(9)\n`)).result, '81');
  assert.equal((await realRun(program('True{}', 'Bool'))).result, 'true');
  assert.equal((await realRun(program('Unit{}', 'Unit'))).result, 'Unit{}');
    await assert.rejects(realRun(program('(x => x, 1)', '(U32 -> U32) & U32')), /function result/);
  assert.equal((await realRun(`import Base\ntype Gift is Data:\n  Box{value: U32}\ndef main() -> Gift:\n  Box{61}\n`)).result, 'Box{value: 61}');
});

test('REAL compiler: diagnostics retain locations, invalid laws/imports/IO rejected, recovery works', async () => {
  assert.throws(() => compile(program('"wrong"')), /expected[\s\S]*observed[\s\S]*Location:/);
  const law = await readFile(new URL('./09-laws.bend', import.meta.url), 'utf8');
  assert.throws(() => compile(law.replace('== x : Nat', '== 1n+x : Nat')), /expected[\s\S]*Location:/);
  assert.throws(() => compile('import ./evil.bend as Evil\n' + program('1')), /only 'import Base'/);
  assert.throws(() => compile(program('IO.print("hi")', 'IO(Unit)')), /foreign.*forbidden/);
  assert.throws(() => compile('import Base\ndef unused() -> IO(Unit):\n  IO.print("hi")\ndef main() -> U32:\n  1\n'), /foreign.*forbidden/);
  assert.equal((await realRun(program('42'))).result, '42');
});

test('bounded formatter handles native and tagged data without cloning arbitrary values', () => {
  assert.equal(formatValue({ $: 'Tuple', fst: { $: 'Some', value: true }, snd: { $: 'None' } }), '(Some(true), None)');
  assert.equal(formatValue({ $: 'Con', head: 1, tail: { $: 'Nil' } }), '[1]');
  assert.equal(formatValue(['<script>', 2, false]), '[<script>, 2, false]');
  assert.equal(formatValue(null), 'null (erased at runtime)');
  assert.throws(() => formatValue(() => 1), /function result/);
  assert.throws(() => formatValue('λ'.repeat(32769)), /64 KiB/);
  assert.throws(() => formatValue(Array(4097).fill(0)), /node limits/);
  let deep = 0;
  for (let i = 0; i < 66; i++) deep = [deep];
  assert.throws(() => formatValue(deep), /depth limits/);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => formatValue(cycle), /cyclic/);
  const list = { $: 'Con', head: 1 }; list.tail = list;
  assert.throws(() => formatValue(list), /Cyclic/);
});

// These tests validate transport/lifecycle only; compiler correctness is tested above.
function mockWorkers(t, actions) {
  const original = globalThis.Worker;
  const workers = [];
  globalThis.Worker = class {
    constructor(url, options) {
      this.url = url.pathname;
      this.options = options;
      this.terminated = 0;
      this.action = actions[workers.length];
      workers.push(this);
    }
    terminate() { this.terminated++; }
    postMessage(payload) {
      this.payload = payload;
      this.action?.(this);
    }
    reply(data) { this.onmessage({ data }); }
  };
  t.after(() => { globalThis.Worker = original; });
  return workers;
}
const compiled = { ok: true, javascript: 'export default {main(){return 61}}', type: 'U32' };
const reply = (data) => (worker) => queueMicrotask(() => worker.reply(data));

test('worker lifecycle: two separate fresh module workers, cleanup on success, late messages ignored', async (t) => {
  const workers = mockWorkers(t, [reply(compiled), reply({ ok: true, result: '61' })]);
  const phases = [];
  assert.deepEqual(await runProgram(program('61'), { onPhase: (phase) => phases.push(phase) }), { type: 'U32', result: '61' });
  assert.deepEqual(phases, ['compilation', 'runtime']);
  assert.match(workers[0].url, /editor-compiler-worker\.mjs$/);
  assert.match(workers[1].url, /editor-execution-worker\.mjs$/);
  assert.deepEqual(workers.map((w) => w.options), [{ type: 'module' }, { type: 'module' }]);
  assert.deepEqual(workers[0].payload, { source: program('61') });
  assert.deepEqual(workers[1].payload, { javascript: compiled.javascript });
  workers[0].reply({ ok: false, error: 'stale' });
  assert.deepEqual(workers.map((w) => w.terminated), [1, 1]);
});

for (const phase of ['compilation', 'runtime']) {
  for (const failure of ['error', 'timeout', 'abort', 'onerror', 'messageerror']) {
    test(`worker lifecycle: ${phase} ${failure} terminates and labels failure`, async (t) => {
      const controller = new AbortController();
      const fail = (worker) => {
        if (failure === 'error') queueMicrotask(() => worker.reply({ ok: false, error: 'Location: 3>| bad' }));
        if (failure === 'abort') queueMicrotask(() => controller.abort());
        if (failure === 'onerror') queueMicrotask(() => worker.onerror({ preventDefault() {} }));
        if (failure === 'messageerror') queueMicrotask(() => worker.onmessageerror());
      };
      const workers = mockWorkers(t, phase === 'runtime' ? [reply(compiled), fail] : [fail]);
      await assert.rejects(runProgram(program('1'), { signal: controller.signal, timeout: 10 }), (error) => {
        assert.equal(error.phase, phase);
        if (failure === 'timeout') assert.match(error.message, /timed out/);
        if (failure === 'error') assert.match(error.message, /Location:/);
        return true;
      });
      assert.ok(workers.every((worker) => worker.terminated === 1));
      assert.equal(workers.length, phase === 'runtime' ? 2 : 1);
      workers.at(-1).reply({ ok: true, result: 'late' });
      assert.ok(workers.every((worker) => worker.terminated === 1));
    });
  }
}

test('worker lifecycle: source bounded before posting, output bounded before execution/UI', async (t) => {
  const workers = mockWorkers(t, [reply({ ...compiled, javascript: ' '.repeat(JAVASCRIPT_LIMIT + 1) })]);
  await assert.rejects(runProgram('λ'.repeat(SOURCE_LIMIT / 2 + 1)), /32 KiB/);
  assert.equal(workers.length, 0);
  await assert.rejects(runProgram(program('1')), /oversized compiler output/);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].terminated, 1);
});

test('worker lifecycle: pre-aborted run never creates a worker', async (t) => {
  const workers = mockWorkers(t, []);
  await assert.rejects(runProgram(program('1'), { signal: AbortSignal.abort() }), /cancelled/);
  assert.equal(workers.length, 0);
});
