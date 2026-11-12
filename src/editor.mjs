import { buildProgram } from './code-context.mjs';

export const SOURCE_LIMIT = 32 * 1024;
export const JAVASCRIPT_LIMIT = 2 * 1024 * 1024;
export const OUTPUT_LIMIT = 64 * 1024;
const bytes = (text) => new TextEncoder().encode(text).length;

export function pureStarter(filename, original) {
  if (filename !== '07-effects.bend' && filename !== '08-parallelism.bend') return original;
  const start = original.indexOf('def main() -> IO(Unit):');
  if (start < 0) throw new Error(`Cannot adapt ${filename}: original IO main was not found.`);
  return original.slice(0, start) + (filename === '07-effects.bend'
    ? 'def main() -> String:\n  greeting("functional adventurer")\n'
    : 'def main() -> U32:\n  pow2(10n)\n');
}

function phaseError(phase, message) {
  const error = new Error(message);
  error.phase = phase;
  return error;
}

function exchange(filename, payload, phase, signal, timeout) {
  return new Promise((resolve, reject) => {
    let worker, timer, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(phaseError(phase, 'Run cancelled.'));
    try {
      if (signal?.aborted) { abort(); return; }
      worker = new Worker(new URL(filename, import.meta.url), { type: 'module' });
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(phaseError(phase, `${phase === 'compilation' ? 'Compilation' : 'Runtime'} timed out after 5 seconds.`)), timeout);
      worker.onmessage = ({ data }) => {
        if (data?.ok === true) finish(null, data);
        else finish(phaseError(phase, typeof data?.error === 'string' ? data.error.slice(0, OUTPUT_LIMIT / 4) : 'Invalid worker response.'));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(phaseError(phase, `Could not load or run the ${phase} worker. Check the tutorial build and localhost HTTP server.`));
      };
      worker.onmessageerror = () => finish(phaseError(phase, 'Could not read the worker response.'));
      worker.postMessage(payload);
    } catch (error) {
      finish(phaseError(phase, error.message || String(error)));
    }
  });
}

// Source and generated modules are messages to fresh workers, never page imports.
export async function runProgram(source, { signal, timeout = 5000, onPhase } = {}) {
  if (typeof source !== 'string' || bytes(source) > SOURCE_LIMIT) throw phaseError('compilation', 'Source must be at most 32 KiB of UTF-8.');
  onPhase?.('compilation');
  const deadline = Math.min(timeout, 5000);
  const compiled = await exchange('./editor-compiler-worker.mjs', { source }, 'compilation', signal, deadline);
  if (typeof compiled.javascript !== 'string' || bytes(compiled.javascript) > JAVASCRIPT_LIMIT ||
      typeof compiled.type !== 'string' || bytes(compiled.type) > OUTPUT_LIMIT) {
    throw phaseError('compilation', 'Invalid or oversized compiler output (JavaScript limit: 2 MiB).');
  }
  onPhase?.('runtime');
  const executed = await exchange('./editor-execution-worker.mjs', { javascript: compiled.javascript }, 'runtime', signal, deadline);
  if (typeof executed.result !== 'string' || bytes(executed.result) > OUTPUT_LIMIT) throw phaseError('runtime', 'Invalid or oversized formatted result.');
  return { type: compiled.type, result: executed.result };
}

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export function mountCodeBox(pre, { filename = '', heading = 'Bend', index, localFile = false, getChapterSource = async () => '' }) {
  const box = node('div', 'bend-codebox');
  const id = `codebox-${index}`;
  box.id = id;
  box.dataset.codebox = box.dataset.codeboxIndex = String(index);
  box.dataset.editor = filename;
  box.dataset.source = filename;
  const originalSnippet = pre.textContent;
  const adapted = (filename === '07-effects.bend' || filename === '08-parallelism.bend') &&
    originalSnippet.includes('def main() -> IO(Unit):');
  const starter = adapted ? pureStarter(filename, originalSnippet) : originalSnippet;
  box.originalSnippet = originalSnippet;
  box.starter = starter;
  const textarea = node('textarea', 'bend-source-code');
  textarea.id = `${id}-source`;
  textarea.value = starter;
  textarea.spellcheck = false;
  textarea.maxLength = SOURCE_LIMIT;
  textarea.wrap = 'off';
  textarea.setAttribute('aria-label', `Bend code box ${index + 1}: ${heading}${adapted ? ' (pure IO main variant)' : ''}`);
  const autosize = () => { textarea.rows = Math.max(3, Math.min(24, textarea.value.replace(/\n$/, '').split('\n').length)); };
  autosize();
  textarea.addEventListener('input', autosize);
  const buttons = node('div', 'bend-editor-buttons');
  const runButton = node('button', 'bend-demo-run', 'Run');
  runButton.title = 'Runs with original chapter definitions; paste full program with import Base to run independently';
  const reset = node('button', 'bend-editor-reset', 'Reset');
  runButton.type = reset.type = 'button';
  runButton.disabled = localFile;
  buttons.append(runButton, reset);
  const note = node('p', 'bend-demo-note', adapted
    ? 'Pure IO main variant: returns a value instead of terminal IO. Reset restores this snippet.'
    : filename ? 'Uses original chapter context unless you paste a full program with import Base.' : 'Standalone program; no chapter context.');
  note.id = `${id}-note`;
  textarea.setAttribute('aria-describedby', note.id);
  const output = node('output', 'bend-demo-output');
  output.id = `${id}-output`;
  output.setAttribute('aria-label', `Type and result for Bend code box ${index + 1}: ${heading}`);
  output.setAttribute('aria-live', 'polite');
  output.setAttribute('aria-atomic', 'true');
  const ready = () => {
    output.dataset.state = localFile ? 'error' : 'ready';
    output.dataset.phase = 'ready';
    output.textContent = localFile ? 'Run needs localhost HTTP. Use just open.' : 'Ready.';
  };
  ready();
  box.append(textarea, buttons, note, output);
  pre.replaceWith(box);
  let generation = 0, active;
  const run = async () => {
    if (active || localFile) return;
    const current = ++generation;
    const controller = new AbortController();
    active = controller;
    const edited = textarea.value;
    runButton.disabled = true;
    box.setAttribute('aria-busy', 'true');
    output.dataset.state = 'pending';
    output.dataset.phase = 'context';
    try {
      if (edited.length > SOURCE_LIMIT || bytes(edited) > SOURCE_LIMIT) {
        throw phaseError('compilation', 'Source must be at most 32 KiB of UTF-8.');
      }
      let source;
      // The helper recognizes import Base without mistaking comments or strings
      // for imports. Standalone programs must not depend on fetching context.
      try { source = buildProgram(edited, starter, '', filename); }
      catch {
        output.textContent = 'Loading original chapter context…';
        const original = await getChapterSource();
        if (current !== generation) return;
        box.originalSource = original;
        const chapterProgram = pureStarter(filename, original);
        source = buildProgram(edited, starter, chapterProgram, filename);
      }
      const value = await runProgram(source, { signal: controller.signal, onPhase: (phase) => {
        output.dataset.phase = phase;
        output.textContent = phase === 'compilation' ? 'Compiling locally…' : 'Running in isolated worker…';
      } });
      if (current !== generation) return;
      output.textContent = `Type: ${value.type}\nResult: ${value.result}`;
      if (value.result === 'null (erased at runtime)') output.textContent += '\nSource checked; runtime evidence is erased, not a proof verdict.';
      output.dataset.state = 'success';
    } catch (error) {
      if (current !== generation) return;
      output.dataset.phase = error.phase || output.dataset.phase;
      const label = output.dataset.phase === 'context' ? 'Context' : output.dataset.phase === 'runtime' ? 'Runtime' : 'Compilation';
      output.textContent = `${label} error: ${error.message}`;
      output.dataset.state = 'error';
    } finally {
      if (current === generation) {
        active = undefined;
        runButton.disabled = false;
        box.setAttribute('aria-busy', 'false');
      }
    }
  };
  runButton.addEventListener('click', () => void run());
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); }
  });
  reset.addEventListener('click', () => {
    generation++;
    active?.abort();
    active = undefined;
    textarea.value = starter;
    autosize();
    runButton.disabled = localFile;
    box.setAttribute('aria-busy', 'false');
    ready();
  });
  return box;
}
