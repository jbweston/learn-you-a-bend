import { validateArgs } from './browser-worker.mjs';
import { mountCodeBox } from './editor.mjs';

const number = (name, label, value, max = 4294967295) => ({ name, label, value, type: 'number', max });
const text = (name, label, value) => ({ name, label, value, type: 'text' });

export const chapters = [
  { id: '1-values-not-a-shopping-list-of-commands', source: '01-values.bend', demos: [
    { operation: 'values', title: 'A value, straight from Bend', fields: [], note: 'Original adapter example: 6 × 7.' },
  ] },
  { id: '2-functions-and-the-suspicious-little-plus', source: '02-functions.bend', demos: [
    { operation: 'square', title: 'Square a number', fields: [number('x', 'Number (U32)', 7)] },
  ] },
  { id: '3-shapes-in-tiny-labelled-boxes', source: '03-shapes.bend', demos: [
    { operation: 'area', title: 'Open a shape', fields: [
      { name: 'shape', label: 'Shape', type: 'select', value: 0, options: [[0, 'Square'], [1, 'Circle']] },
      number('size', 'Side length / radius (U32)', 5),
    ], note: 'The circle example uses 3 as its approximation of pi.' },
  ] },
  { id: '4-lists-one-biscuit-and-the-rest-of-the-tin', source: '04-lists.bend', demos: [
    { operation: 'sum', title: 'Sum a list', fields: [
      { name: 'xs', label: 'List (comma-separated U32 values; at most 128)', type: 'list', value: '1, 2, 3, 4' },
    ], note: 'Leave the list empty for Nil. JavaScript only packages the list; Bend computes the sum.' },
  ] },
  { id: '5-functions-in-your-backpack', source: '05-functions-as-values.bend', demos: [
    { operation: 'functions', title: 'A closure and a template', fields: [number('x', 'Starting number (U32)', 40), number('k', 'Captured addend (U32)', 2)], note: 'Bend calls adder(k)(x) once, then the compiled twice template increments twice.' },
  ] },
  { id: '6-quantities-the-librarian-is-counting', source: '06-quantities.bend', demos: [
    { operation: 'replicate', title: 'Repeat a value', fields: [number('n', 'Count (Nat; at most 64)', 3, 64), number('x', 'Value (U32)', 7)] },
  ] },
  { id: '7-effects-without-pretending-printing-is-pure', source: '07-effects.bend', demos: [
    { operation: 'greeting', title: 'A greeting', fields: [text('name', 'Name', 'functional adventurer')], note: 'The compiled adapter returns a string; this page displays it rather than performing terminal IO.' },
    { operation: 'parse', title: 'Parsing with Maybe', fields: [text('a', 'First string', '40'), text('b', 'Second string', '2')], note: 'Try “biscuits” for None. These are strings passed unchanged to Bend, not numbers parsed by the UI.' },
  ] },
  { id: '8-two-elves-two-independent-jobs', source: '08-parallelism.bend', demos: [
    { operation: 'pow2', title: 'Two recursive jobs', fields: [number('n', 'Counter (Nat; at most 16)', 10, 16)], note: 'The JavaScript target runs this parallel-call demo sequentially. This is not a multicore speed benchmark.' },
  ] },
  { id: '9-laws-bring-a-proof-not-just-good-intentions', source: '09-laws.bend', demos: [
    { operation: 'law_sample', title: 'A concrete law sample — not a proof', fields: [number('n', 'Sample (Nat; at most 256)', 2, 256)], note: 'Original adapter sample: two concrete values, not a universal proof.' },
  ] },
  { id: '10-bonus-a-mutable-array-with-one-owner', source: '10-arrays.bend', demos: [
    { operation: 'array', title: 'An array with one owner', fields: [number('value', 'Value to write at index 5 (U32)', 42), number('index', 'Index to read (U32; wraps modulo 8)', 5)], note: 'Each run allocates a fresh eight-element array, writes index 5, and returns the array together with the read value.' },
  ] },
];

function decimal(raw, label) {
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${label} must be a nonnegative decimal integer.`);
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe JavaScript integer.`);
  return value;
}

export function parseInputs(demo, inputs) {
  const args = demo.fields.map((field) => {
    const raw = inputs[field.name];
    if (field.type === 'text') return raw;
    if (field.type === 'list') {
      if (raw.length > 2048) throw new Error('List input is too long (at most 128 U32 values).');
      if (!raw.trim()) return [];
      const items = raw.split(',');
      if (items.length > 128) throw new Error('List must contain at most 128 U32 values.');
      return items.map((item) => decimal(item, 'List item'));
    }
    return decimal(raw, field.label);
  });
  return validateArgs(demo.operation, args);
}

// Presentation only: computations and ownership-sensitive allocations stay in Bend.
export function formatResult(value) {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (Array.isArray(value)) return `[${value.map(formatResult).join(', ')}]`;
  switch (value?.$) {
    case 'Nil': return '[]';
    case 'Con': {
      const items = [];
      let node = value;
      while (node?.$ === 'Con' && items.length < 128) {
        items.push(formatResult(node.head));
        node = node.tail;
      }
      if (node?.$ !== 'Nil') throw new Error('Unexpected or oversized list result.');
      return `[${items.join(', ')}]`;
    }
    case 'Some': return `Some(${formatResult(value.value)})`;
    case 'None': return 'None';
    case 'Tuple': return `(${formatResult(value.fst)}, ${formatResult(value.snd)})`;
    default: throw new Error('Unexpected compiled result.');
  }
}

export function runWorker(operation, args, timeout = 5000) {
  validateArgs(operation, args);
  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    const finish = (error, value) => {
      clearTimeout(timer);
      worker?.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    try {
      worker = new Worker(new URL('./browser-worker.mjs', import.meta.url), { type: 'module' });
      timer = setTimeout(() => finish(new Error('Demo timed out after 5 seconds. Try a smaller input and Run again.')), timeout);
      worker.onmessage = ({ data }) => {
        if (data?.ok === true) finish(null, data.value);
        else finish(new Error(typeof data?.error === 'string' ? data.error.slice(0, 500) : 'Invalid worker response.'));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(new Error('Could not run the compiled Bend worker. Check that the tutorial was built and is served over localhost HTTP (just open).'));
      };
      worker.onmessageerror = () => finish(new Error('Could not read the worker result. Please try again.'));
      worker.postMessage({ operation, args });
    } catch (error) {
      finish(error);
    }
  });
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

// Cache originals, never edits or assembled programs. Multiple fences share one GET.
const chapterSources = new Map();
export function loadChapterSource(filename) {
  if (!chapterSources.has(filename)) {
    chapterSources.set(filename, (async () => {
      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(new URL(filename, import.meta.url), { signal: controller.signal, mode: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error('Context fetch timed out after 5 seconds'));
              controller.abort();
            }, 5000);
          }),
        ]);
      } catch (error) {
        throw new Error(`Could not load original chapter context (${filename}): ${error.message}. Reload to retry, or paste a full program with import Base to run independently.`);
      } finally { clearTimeout(timer); }
    })());
  }
  return chapterSources.get(filename);
}

export function mountTutorial() {
  if (document.querySelector('[data-tutorial-browser]')) return;
  const blocks = [...document.querySelectorAll('h2, pre.bend')];
  const firstBlock = blocks.find((block) => block.matches('pre.bend'));
  if (!firstBlock) return;
  const localFile = location.protocol === 'file:';
  const intro = element('aside', 'bend-browser-note', localFile
    ? 'Inline Bend Run requires localhost HTTP. Use just open, then visit the printed URL. Code remains editable here.'
    : 'Edit any Bend code box directly, then Run to compile and run locally; Ctrl/Cmd+Enter also runs. Function fragments use original chapter definitions; paste a full program with import Base to run independently. No source upload. Only import Base; main must be non-template, take zero live arguments, and return a pure value. Foreign effects and unsafe code are forbidden everywhere. IO main examples in chapters 7 and 8 use labelled pure variants. Compilation and execution use separate fresh workers, each limited to five seconds. Laws are checked by the normal Bend checker, not Lean; runtime proof evidence is erased. The JS parallel calls run sequentially.');
  intro.dataset.tutorialBrowser = '';
  firstBlock.before(intro);
  const byHeading = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  let heading, index = 0;
  for (const block of blocks) {
    if (block.matches('h2')) { heading = block; continue; }
    const filename = byHeading.get(heading?.id)?.source ?? '';
    mountCodeBox(block, {
      filename, heading: heading?.textContent ?? 'Bend', index: index++, localFile,
      getChapterSource: () => filename ? loadChapterSource(filename) : Promise.resolve(''),
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountTutorial, { once: true });
  else mountTutorial();
}
