// The emitter can read effect snippets upstream. In the browser none are
// authorized, including Base's IO implementations. Keep the whitelist exact.
import { BASE } from "./base.ts";

function immutableFile(path: string): string {
  if (path !== "/virtual/base.bend") {
    throw new Error(`Browser compiler: filesystem access denied: ${path}`);
  }
  return BASE;
}

export function realpathSync(path: string): string {
  immutableFile(path);
  return path;
}

export function readFileSync(path: string, encoding: string): string {
  if (encoding !== "utf8") {
    throw new Error("Browser compiler: only UTF-8 virtual files are supported");
  }
  return immutableFile(path);
}
