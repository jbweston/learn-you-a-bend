const OUTPUT_LIMIT = 64 * 1024;
const bytes = (text) => new TextEncoder().encode(text).length;

// Format inside the worker: never structured-clone arbitrary program data to the UI.
export function formatValue(value) {
  let nodes = 0, size = 0;
  const parts = [], ancestors = new Set();
  const emit = (text) => {
    if (text.length > OUTPUT_LIMIT || (size += bytes(text)) > OUTPUT_LIMIT) throw new Error('Formatted output exceeds 64 KiB.');
    parts.push(text);
  };
  const visit = (value, depth) => {
    if (++nodes > 4096 || depth > 64) throw new Error('Result exceeds serialization node/depth limits.');
    if (value === null) { emit('null (erased at runtime)'); return; }
    switch (typeof value) {
      case 'number': case 'boolean': emit(String(value)); return;
      case 'string': emit(value); return;
      case 'function': throw new Error('Cannot serialize a function result. Return data from main instead.');
      case 'object': break;
      default: throw new Error(`Cannot serialize a ${typeof value} result.`);
    }
    if (ancestors.has(value)) throw new Error('Cannot serialize cyclic data.');
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > 4096) throw new Error('Result exceeds serialization node limits.');
        emit('[');
        value.forEach((item, index) => { if (index) emit(', '); visit(item, depth + 1); });
        emit(']');
      } else if (value.$ === 'Nil' || value.$ === 'Con') {
        emit('[');
        let current = value, first = true;
        const seen = new Set();
        while (current?.$ === 'Con') {
          if (seen.has(current) || ++nodes > 4096) throw new Error('Cyclic or oversized list result.');
          seen.add(current);
          if (!first) emit(', ');
          first = false;
          visit(current.head, depth + 1);
          current = current.tail;
        }
        if (current?.$ !== 'Nil') throw new Error('Invalid list tail.');
        emit(']');
      } else if (value.$ === 'Tuple') {
        emit('('); visit(value.fst, depth + 1); emit(', '); visit(value.snd, depth + 1); emit(')');
      } else if (value.$ === 'Some') {
        emit('Some('); visit(value.value, depth + 1); emit(')');
      } else if (value.$ === 'None' || value.$ === 'Unit') {
        emit(value.$ === 'Unit' ? 'Unit{}' : 'None');
      } else {
        const keys = Object.keys(value);
        if (keys.length > 4096) throw new Error('Result exceeds serialization node limits.');
        if (typeof value.$ === 'string') emit(value.$);
        emit('{');
        let first = true;
        for (const key of keys) {
          if (key === '$') continue;
          if (!first) emit(', ');
          first = false;
          emit(key); emit(': '); visit(value[key], depth + 1);
        }
        emit('}');
      }
    } finally { ancestors.delete(value); }
  };
  visit(value, 0);
  return parts.join('');
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  // Defense in depth, not a general JavaScript sandbox. The real compiler rejects
  // foreign imports/effects/unsafe code; generated pure code cannot request modules.
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'Worker', 'SharedWorker', 'importScripts']) {
    Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
  }
  self.onmessage = async ({ data }) => {
    let url;
    try {
      if (typeof data?.javascript !== 'string' || bytes(data.javascript) > 2 * 1024 * 1024) throw new Error('Invalid or oversized JavaScript (limit 2 MiB).');
      url = URL.createObjectURL(new Blob([data.javascript], { type: 'text/javascript' }));
      const module = await import(url);
      if (typeof module.default?.main !== 'function') throw new Error('Compiled module has no main function.');
      const result = formatValue(module.default.main());
      self.postMessage({ ok: true, result });
    } catch (error) {
      self.postMessage({ ok: false, error: String(error?.message || error).slice(0, 16 * 1024) });
    } finally { if (url) URL.revokeObjectURL(url); }
  };
}
