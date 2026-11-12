import { compile } from './generated/compiler.mjs';

const bytes = (text) => new TextEncoder().encode(text).length;
// Base is bundled; compilation needs no network or child workers.
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'Worker', 'SharedWorker', 'importScripts']) {
  Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
}
self.onmessage = ({ data }) => {
  try {
    if (typeof data?.source !== 'string' || bytes(data.source) > 32 * 1024) throw new Error('Source must be at most 32 KiB of UTF-8.');
    const { javascript, type } = compile(data.source);
    if (typeof javascript !== 'string' || bytes(javascript) > 2 * 1024 * 1024) throw new Error('Generated JavaScript exceeds 2 MiB.');
    if (typeof type !== 'string' || bytes(type) > 64 * 1024) throw new Error('Compiler type output exceeds 64 KiB.');
    self.postMessage({ ok: true, javascript, type });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.formattedError || error?.message || error).slice(0, 16 * 1024) });
  }
};
