import test from 'node:test';
import assert from 'node:assert/strict';
import examples from './generated/examples.mjs';

// Bend's List is a tagged linked list, not a JavaScript array.
const list = (xs) => xs.reduceRight(
  (tail, head) => ({ $: 'Con', head, tail }),
  { $: 'Nil' },
);
const some = (value) => ({ $: 'Some', value });
const none = { $: 'None' };
const maxU32 = 0xffff_ffff;

// The compiled module exports one object, and calls may also be curried.
test('default export exposes every browser adapter', () => {
  for (const name of [
    'values', 'square', 'area', 'sum', 'functions', 'replicate',
    'parse', 'greeting', 'pow2', 'law_sample', 'array',
  ]) {
    assert.equal(typeof examples[name], 'function', name);
  }
  assert.equal(examples.functions(40)(2), 44);
  assert.equal(examples.area(1)(5), 75);
  assert.deepEqual(examples.parse('20')('22'), some(42));
});

test('values returns the original chapter result on repeated calls', () => {
  assert.equal(examples.values(), 42);
  assert.equal(examples.values(), 42);
});

test('square handles the chapter default, zero, and U32 wraparound', () => {
  for (const [x, expected] of [[7, 49], [0, 0], [1, 1], [65535, 4294836225], [65536, 0], [maxU32, 1]]) {
    assert.equal(examples.square(x), expected);
  }
});

test('area selects chapter shapes and preserves U32 arithmetic', () => {
  assert.equal(examples.area(0, 5), 25);
  assert.equal(examples.area(1, 5), 75);
  for (const shape of [0, 1]) {
    assert.equal(examples.area(shape, 0), 0);
    assert.equal(examples.area(shape, 65536), 0);
    assert.equal(examples.area(shape, maxU32), shape === 0 ? 1 : 3);
  }
});

test('sum consumes tagged lists with a zero accumulator', () => {
  assert.equal(examples.sum(list([1, 2, 3, 4])), 10);
  assert.equal(examples.sum(list([])), 0);
  assert.equal(examples.sum(list([maxU32])), maxU32);
  assert.equal(examples.sum(list([maxU32, 1])), 0);
  assert.equal(examples.sum(list(Array(2000).fill(1))), 2000);
});

test('sum does not mutate or retain the caller list', () => {
  const tail = Object.freeze({ $: 'Nil' });
  const xs = Object.freeze({ $: 'Con', head: 7, tail });
  assert.equal(examples.sum(xs), 7);
  assert.equal(examples.sum(xs), 7);
  assert.deepEqual(xs, list([7]));
});

test('functions uses the chapter closure and applies increment twice', () => {
  for (const [x, k, expected] of [[40, 2, 44], [0, 0, 2], [7, 0, 9], [0, 7, 9], [maxU32, 0, 1], [maxU32, maxU32, 0]]) {
    assert.equal(examples.functions(x, k), expected);
  }
  assert.equal(examples.functions(40, 2), 44);
});

test('replicate accepts numeric Nat and returns tagged lists', () => {
  assert.deepEqual(examples.replicate(3, 7), list([7, 7, 7]));
  assert.deepEqual(examples.replicate(0, maxU32), list([]));
  assert.deepEqual(examples.replicate(1, 0), list([0]));
  assert.deepEqual(examples.replicate(2, maxU32), list([maxU32, maxU32]));
  assert.equal(examples.sum(examples.replicate(100, 7)), 700);
});

test('replicate returns fresh nonempty list nodes on every call', () => {
  const first = examples.replicate(2, 7);
  const second = examples.replicate(2, 7);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.tail, second.tail);
  first.head = 99;
  first.tail.head = 100;
  assert.deepEqual(second, list([7, 7]));
  assert.deepEqual(examples.replicate(2, 7), list([7, 7]));
});

test('parse returns tagged Some for decimal U32 strings', () => {
  assert.deepEqual(examples.parse('20', '22'), some(42));
  assert.deepEqual(examples.parse('0', '0'), some(0));
  assert.deepEqual(examples.parse('00020', '0022'), some(42));
  assert.deepEqual(examples.parse(String(maxU32), '0'), some(maxU32));
  assert.deepEqual(examples.parse(String(maxU32), '1'), some(0));
});

test('parse returns None for either invalid operand', () => {
  for (const invalid of ['', 'nope', '-1', '+1', '1.5', '0x10', '1e2', ' 1', '1 ', '1\n', '4294967296', '１２']) {
    assert.deepEqual(examples.parse(invalid, '2'), none, `left: ${JSON.stringify(invalid)}`);
    assert.deepEqual(examples.parse('2', invalid), none, `right: ${JSON.stringify(invalid)}`);
  }
  assert.deepEqual(examples.parse('bad', 'bad'), none);
  assert.deepEqual(examples.parse('20', '22'), some(42));
});

test('greeting uses native strings, including empty and Unicode names', () => {
  assert.equal(examples.greeting('functional adventurer'), 'Hello, functional adventurer!');
  assert.equal(examples.greeting(''), 'Hello, !');
  assert.equal(examples.greeting('Ada'), 'Hello, Ada!');
  assert.equal(examples.greeting('世界 🌍'), 'Hello, 世界 🌍!');
  assert.equal(examples.greeting('a\u0000b'), 'Hello, a\u0000b!');
  assert.equal(examples.greeting('\ud800'), 'Hello, \ud800!');
  assert.equal(examples.greeting('Ada'), 'Hello, Ada!');
});

test('pow2 computes the original sequential JS recursion', () => {
  // Keep n small: the chapter deliberately makes two recursive calls.
  for (const n of [0, 1, 2, 5, 10, 12]) {
    assert.equal(examples.pow2(n), 2 ** n);
  }
  assert.equal(examples.pow2(10), 1024);
});

test('Nat inputs reject negative, fractional, and nonnumeric values', () => {
  for (const n of [-1, 0.5, NaN, Infinity, '2', 2n, 2 ** 54]) {
    for (const call of [() => examples.replicate(n, 7), () => examples.pow2(n), () => examples.law_sample(n)]) {
      assert.throws(call, (error) => String(error).includes('a Nat'));
    }
  }
});

test('law_sample displays concrete sides, not a universal runtime proof', () => {
  for (const n of [0, 1, 2, 10, 100]) {
    assert.equal(examples.law_sample(n), `${n} = ${n}`);
  }
});

test('array returns a tagged pair containing eight native JS elements', () => {
  for (let index = 0; index < 8; index += 1) {
    const result = examples.array(42, index);
    assert.equal(result.$, 'Tuple');
    assert.ok(Array.isArray(result.fst));
    assert.deepEqual(result.fst, [0, 0, 0, 0, 0, 42, 0, 0]);
    assert.equal(result.snd, index === 5 ? 42 : 0);
  }
  assert.deepEqual(examples.array(0, 5), { $: 'Tuple', fst: Array(8).fill(0), snd: 0 });
  assert.equal(examples.array(maxU32, 5).snd, maxU32);
});

test('array reads wrap indices modulo the allocation size', () => {
  assert.equal(examples.array(42, 8).snd, 0);
  assert.equal(examples.array(42, 13).snd, 42);
  assert.equal(examples.array(42, maxU32).snd, 0);
});

test('array calls allocate fresh storage with no shared mutation', () => {
  const first = examples.array(42, 5);
  const second = examples.array(7, 5);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.fst, second.fst);
  assert.equal(first.snd, 42);
  assert.equal(second.snd, 7);
  first.fst.fill(99);
  assert.deepEqual(second.fst, [0, 0, 0, 0, 0, 7, 0, 0]);
  assert.deepEqual(examples.array(42, 5), { $: 'Tuple', fst: [0, 0, 0, 0, 0, 42, 0, 0], snd: 42 });
  second.fst[5] = 123;
  assert.equal(examples.array(7, 5).snd, 7);
});
