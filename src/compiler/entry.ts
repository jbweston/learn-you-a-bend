import * as Bend from "./bend.ts";
import * as Comp from "./comp.ts";
import { BASE } from "./base.ts";
import { byteLimit, SOURCE_LIMIT, OUTPUT_LIMIT } from "./limits.ts";

function fail(book: Bend.Book, message: string, span?: Bend.Span, name?: string): never {
  throw Bend.Err(book, Bend.ctx_nil(), message, undefined, span, name);
}

// This is the pinned loader's header grammar, not a scan of arbitrary source.
// Once the first declaration starts, Bend's parser owns strings and comments.
// Mask header characters (rather than removing lines) to retain diagnostic spans.
function load(book: Bend.Book, source: string): void {
  const al: Record<string, string> = Object.create(null);
  const file: Bend.File = { str: source, ns: "", al };
  const lines = source.split("\n");
  let base = false;
  for (let i = 0, at = 0; i < lines.length; at += lines[i].length + 1, i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!/^import(\s|$)/.test(line)) break;
    const span = { file, beg: at + lines[i].indexOf("import"), end: at + lines[i].length };
    if (!/^import\s+Base\s*(?:#.*)?$/.test(line)) {
      fail(book, "only 'import Base' is supported in the browser; module, chapter, package, URL and relative imports are forbidden", span);
    }
    base = true;
    lines[i] = lines[i].replace(/[^\r]/g, " ");
  }
  if (base) {
    Bend.parse_book(book, Bend.BEND_DIR, BASE, "", Object.create(null));
    for (const k of book.order) book.tlds[k].b = true;
  }
  Bend.parse_book(book, "/virtual/", lines.join("\n"), "", al);
}

// Walk the real AST, lowering HOAS binders through the upstream utility. Follow
// Base dependencies too: an innocuous wrapper must not smuggle a foreign effect
// into emission, even in a type, erased argument, or unreachable helper.
function restrictions(book: Bend.Book): { name: string; span?: Bend.Span } | undefined {
  const checked = new Set<string>();
  let incomplete: { name: string; span?: Bend.Span } | undefined;
  function dependency(k: string, origin: string, span?: Bend.Span): void {
    const t = book.tlds[k];
    if (t?.$ === "Def" && (t.i !== undefined || t.u)) {
      fail(book, `foreign imports and unsafe definitions (@unsafe / def f?) are forbidden: ${Bend.name_key(k)}`, span, origin);
    }
    if (!t || checked.has(k)) return;
    checked.add(k);
    walk(Bend.term_lower(t.T), origin, span);
    if (t.$ === "Def" && t.v !== null) walk(Bend.term_lower(t.v), origin, span);
    if (t.$ === "ADT") {
      for (const c of t.c) walk(Bend.term_lower(c.T), origin, span);
    }
  }
  function walk(value: unknown, origin: string, inherited?: Bend.Span): void {
    if (value === null || typeof value !== "object") return;
    const node = value as Bend.LTerm;
    const span = inherited ?? node.s;
    if (node.$ === "Hol" && node.k === "TODO" && incomplete === undefined) {
      incomplete = { name: origin, span: node.s };
    }
    if (node.$ === "Ref" || node.$ === "ADT") dependency(node.k, origin, span);
    if (node.$ === "Ctr") {
      const ctr = book.ctrs[node.k];
      if (ctr) walk(Bend.term_lower(ctr.T), origin, span);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "s") walk(child, origin, span);
    }
  }
  for (const k of book.order) {
    const t = book.tlds[k];
    if (t.b !== true) {
      if (t.$ === "Def" && t.v === null && incomplete === undefined) {
        incomplete = { name: k, span: t.T.s };
      }
      dependency(k, k, t.T.s);
    }
  }
  return incomplete;
}

export function compile(source: string): { javascript: string; type: string } {
  if (typeof source !== "string") throw new Error("Browser compiler: source must be a string");
  byteLimit(source, SOURCE_LIMIT, "source");
  // No shared Base book, symbol cache, or template instances across calls.
  const book = Bend.book_nil();
  try {
    load(book, source);
    const incomplete = restrictions(book); // Before validation/emission can touch snippets.
    Bend.book_valid(book);
    if (book.hols > 0) {
      fail(book, `${book.hols} incomplete law(s) or ?TODO hole(s); the code is not a valid proof yet`, incomplete?.span, incomplete?.name);
    }
    const main = book.tlds.main;
    if (!main || main.$ !== "Def" || main.v === null || main.x !== 0) {
      fail(book, "a filled, non-template 'def main()' is required", main?.T.s, "main");
    }
    if (Comp.io_type(book) !== null) {
      fail(book, "main must return a pure value, not IO", main.T.s, "main");
    }
    const { doms, ret } = Bend.tele_unbind(book, main.T);
    if (doms.some(([q]) => q.$ !== "None")) {
      fail(book, "main must have zero runtime arguments", main.T.s, "main");
    }
    const type = Bend.term_show(Bend.term_lower(ret));
    const javascript = Comp.js_lib(book, true);
    byteLimit(javascript, OUTPUT_LIMIT, "JavaScript output");
    return { javascript, type };
  } catch (error) {
    if ((error as Bend.Err)?.$ === "Err") {
      throw new Error(Bend.err_show(error as Bend.Err));
    }
    if (error instanceof RangeError) {
      throw new Error("Browser compiler: machine stack overflow (deep recursion or a literal too large to expand)");
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}
