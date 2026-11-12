import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { buildProgram } from './code-context.mjs';
import { pureStarter } from './editor.mjs';
import { compile } from './generated/compiler.mjs';

const directory = new URL('./', import.meta.url);
const markdown = await readFile(new URL('README.md', directory), 'utf8');
const files = await readdir(directory);
const chapters = new Map();
for (let number = 1; number <= 10; number++) {
  const filename = files.find((file) => file.startsWith(`${String(number).padStart(2, '0')}-`) && file.endsWith('.bend'));
  assert.ok(filename, `chapter ${number} source exists`);
  chapters.set(number, { filename, source: pureStarter(filename, await readFile(new URL(filename, directory), 'utf8')) });
}

// Extract the actual Markdown fences in Node; no generated HTML or DOM fixture.
const fences = [];
let chapterNumber, language, lines = [];
for (const line of markdown.split('\n')) {
  if (language !== undefined) {
    if (/^```\s*$/.test(line)) {
      if (language === 'bend') {
        const chapter = chapters.get(chapterNumber) ?? { filename: '', source: '' };
        const original = lines.join('\n') + '\n';
        const starter = original.includes('def main() -> IO(Unit):') ? pureStarter(chapter.filename, original) : original;
        fences.push({ number: chapterNumber, ...chapter, original, starter });
      }
      language = undefined;
      lines = [];
    } else lines.push(line);
  } else {
    const heading = /^## (\d+)\./.exec(line);
    if (heading) chapterNumber = Number(heading[1]);
    const opening = /^```(\w*)\s*$/.exec(line);
    if (opening) language = opening[1];
  }
}
assert.equal(fences.length, 18, 'all 18 rendered Bend fences are tested');

async function evaluate(source) {
  const checked = compile(source);
  assert.equal(typeof checked.type, 'string');
  assert.ok(checked.type.length);
  const module = await import(`data:text/javascript;base64,${Buffer.from(checked.javascript).toString('base64')}`);
  return { type: checked.type, value: module.default.main() };
}
const list = (...values) => values.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });
const some = (value) => ({ $: 'Some', value });
const arrayPair = (value) => ({ $: 'Tuple', fst: [0, 0, 0, 0, 0, value, 0, 0], snd: value });
const expected = [42, 42, 49, 50, 25, 25, 10, 44, 44, 44, list(7, 7, 7),
  'Hello, functional adventurer!', some(42), some(42), 1024, 1024, null, arrayPair(42)];
const assemble = (fence, edited = fence.starter) => buildProgram(edited, fence.starter, fence.source, fence.filename);
const fenceFor = (number, text) => {
  const fence = fences.find((entry) => entry.number === number && entry.starter.includes(text));
  assert.ok(fence, `chapter ${number} fence containing ${text}`);
  return fence;
};
const count = (source, kind, name) => [...source.matchAll(new RegExp(`^${kind} ${name}\\b`, 'gm'))].length;

for (const [index, fence] of fences.entries()) {
  test(`README fence ${index + 1}: chapter ${fence.number} compiles and executes`, async () => {
    const source = assemble(fence);
    assert.deepEqual((await evaluate(source)).value, expected[index]);
    if (fence.number === 7 || fence.number === 8) assert.doesNotMatch(source, /^def main\(\) -> IO/m);
    for (const match of source.matchAll(/^(def|law|type) ([A-Za-z_][\w.]*)/gm)) {
      assert.equal(count(source, match[1], match[2]), 1, `${match[1]} ${match[2]} is not duplicated`);
    }
  });
}

test('function edits change execution, not just displayed source', async () => {
  const edits = [
    [2, 'def square', '(x * x : U32)', '(x + x : U32)', 14],
    [3, 'def area', '(s * s : U32)', '(s + s : U32)', 10],
    [4, 'def sum', '(acc + h : U32)', '(acc + h + 1 : U32)', 14],
    [5, 'def adder', '(x + k : U32)', '(x + k + 1 : U32)', 45],
    [5, 'def twice', 'f(f(x))', 'f(x)', 43],
    [7, 'def add_strs', '(x + y : U32)', '(x * y : U32)', some(80)],
    [8, 'def pow2', '      1', '      2', 2048],
    [10, 'def array', 'array(42, 5)', 'array(99, 5)', arrayPair(99)],
  ];
  for (const [number, text, before, after, value] of edits) {
    const fence = fenceFor(number, text);
    assert.ok(fence.starter.includes(before));
    assert.deepEqual((await evaluate(assemble(fence, fence.starter.replace(before, after)))).value, value);
  }
});

test('type-only edit retains area and chapter main; an explicit new main overrides it', async () => {
  const fence = fenceFor(3, 'type Shape');
  const edited = fence.starter.replace('Square{s:', 'Square{side:');
  const source = assemble(fence, edited);
  assert.equal(count(source, 'type', 'Shape'), 1);
  assert.match(source, /area\(Square\{5\}\)/);
  assert.equal((await evaluate(source)).value, 25);
  const override = assemble(fence, `${edited}\ndef main() -> U32:\n  area(Circle{4})\n`);
  assert.equal(count(override, 'def', 'main'), 1);
  assert.equal((await evaluate(override)).value, 48);
});

test('hypothetical main fences use the edited main, with remaining definitions', async () => {
  const fence = fenceFor(2, 'answer =');
  assert.equal((await evaluate(assemble(fence, fence.starter.replace('answer + 1', 'answer + 2')))).value, 51);
  const maybe = fenceFor(7, 'def main() -> Maybe');
  assert.deepEqual((await evaluate(assemble(maybe, maybe.starter.replace('"2"', '"biscuits"')))).value, { $: 'None' });
});

test('the non-contiguous effects fence retains add_strs before main', async () => {
  const fence = fenceFor(7, 'def greeting');
  assert.ok(!fence.source.includes(fence.starter.trim()));
  const source = assemble(fence, fence.starter.replace('Hello, ', 'Welcome, '));
  assert.ok(source.indexOf('def add_strs') < source.indexOf('def main'));
  assert.equal(count(source, 'def', 'greeting'), 1);
  assert.equal((await evaluate(source)).value, 'Welcome, functional adventurer!');
});

test('an explicit main suppresses the add_strs implicit entry', async () => {
  const fence = fenceFor(7, 'def add_strs');
  const source = assemble(fence, `${fence.starter}\ndef main() -> U32:\n  17\n`);
  assert.equal(count(source, 'def', 'main'), 1);
  assert.equal((await evaluate(source)).value, 17);
});

test('parallel statement matches with or without Markdown indentation', async () => {
  const fence = fenceFor(8, 'a b = pow2');
  // Select the statement fence rather than the full pow2 declaration.
  const statement = fences.find((entry) => entry.number === 8 && !entry.starter.includes('def pow2'));
  assert.ok(fence && statement);
  for (const starter of [statement.starter, statement.starter.trim()]) {
    const edited = 'a b = pow2(p) U32.add(0, 1)';
    const source = buildProgram(edited, starter, statement.source, statement.filename);
    assert.match(source, /^      a b = pow2\(p\) U32.add\(0, 1\)$/m);
    assert.doesNotMatch(source, /a b = pow2\(p\) pow2\(p\)/);
    assert.equal((await evaluate(source)).value, 11);
  }
  assert.equal((await evaluate(assemble(statement))).value, 1024);
});

test('helpers keep edited declaration order, before templates and main', async () => {
  const fence = fenceFor(5, 'def twice');
  const edited = `def square(+x: U32) -> U32:\n  (x * x : U32)\n\n${fence.starter}\ndef main() -> U32:\n  twice(~(x => square(x)), 2)\n`;
  const source = assemble(fence, edited);
  assert.ok(source.indexOf('def square') < source.indexOf('def twice'));
  assert.ok(source.indexOf('def twice') < source.indexOf('def main'));
  assert.equal(count(source, 'def', 'main'), 1);
  assert.equal((await evaluate(source)).value, 16);
  const mainFence = fenceFor(2, 'answer =');
  const mainEdit = 'def helper(x: U32) -> U32:\n  (x + 3 : U32)\n\ndef main() -> U32:\n  helper(square(7))\n';
  assert.equal((await evaluate(assemble(mainFence, mainEdit))).value, 52);
});

test('renames and deletions do not leave stale original definitions', async () => {
  const fence = fenceFor(2, 'def square');
  const source = assemble(fence, fence.starter.replaceAll('square', 'cube').replace('x * x', 'x * x * x'));
  assert.doesNotMatch(source, /^def square\b/m);
  assert.equal(count(source, 'def', 'cube'), 1);
  assert.equal((await evaluate(source)).value, 343);
  const deleted = assemble(fence, 'def main() -> U32:\n  12\n');
  assert.doesNotMatch(deleted, /^def square\b/m);
  assert.equal((await evaluate(deleted)).value, 12);
});

test('law and proof with the same name are distinct; real checker rejects false goals', async () => {
  const fence = fenceFor(9, 'law add_zero');
  const source = assemble(fence);
  assert.equal(count(source, 'law', 'add_zero'), 1);
  assert.equal(count(source, 'def', 'add_zero'), 1);
  assert.equal((await evaluate(source)).value, null);
  const invalid = assemble(fence, fence.starter.replace('== x : Nat', '== 1n+x : Nat'));
  assert.match(invalid, /^def add_zero\(x\):/m);
  assert.throws(() => compile(invalid), /expected[\s\S]*observed[\s\S]*Location:/);
});

test('comments and strings do not create declaration or standalone anchors', async () => {
  const fence = fenceFor(1, 'def main');
  const text = 'import Base\ndef helper() -> U32:\n  99\nlaw fake:\ntype Fake is Data:';
  const edited = `# import Base\n# def fake() -> U32:\ndef main() -> String:\n  ${JSON.stringify(text)} # law bogus:\n`;
  const source = assemble(fence, edited);
  assert.match(source, /^import Base/m);
  assert.equal(count(source, 'def', 'main'), 1);
  assert.equal((await evaluate(source)).value, text);
  assert.match(source, /^# import Base\n# def fake\(\) -> U32:/m);
  assert.throws(() => buildProgram('"import Base"', 'unknown', fence.source), /standalone program/);
});

test('pasted standalone programs bypass all context and retain user text', async () => {
  const source = '# user comment\nimport Base # base comment\n\ndef main() -> U32:\n  123\n';
  assert.equal(buildProgram(source, 'unmatched starter', 'unmatched chapter', '07-effects.bend'), source);
  assert.equal((await evaluate(source)).value, 123);
  // Assembly does not rescue invalid standalone source or weaken worker policy.
  const invalid = 'import Base\ndef main() -> U32:\n  "wrong"\n';
  assert.equal(buildProgram(invalid, '', ''), invalid);
  assert.throws(() => compile(invalid), /expected[\s\S]*observed/);
});

test('unknown and ambiguous fragments fail clearly instead of guessing', () => {
  const chapter = chapters.get(2).source;
  for (const [edited, starter] of [
    ['def stranger() -> U32:\n  1', 'def stranger() -> U32:\n  0'],
    ['square(8)', 'square(100)'],
    ['"discarded"\ndef main() -> U32:\n  1', 'def main() -> U32:\n  42'],
    ['def main() -> U32:\n  1', 'unknown fragment'],
    ['42', 'def main() -> U32:\n  42'],
    ['', 'def main() -> U32:\n  42'],
  ]) assert.throws(() => buildProgram(edited, starter, chapter), /Cannot match[\s\S]*standalone program[\s\S]*import Base/);
  const ambiguous = 'import Base\ndef first() -> U32:\n  42\ndef main() -> U32:\n  42\n';
  assert.throws(() => buildProgram('43', '42', ambiguous), /standalone program/);
  assert.throws(() => buildProgram(null, '', ''), TypeError);
});
