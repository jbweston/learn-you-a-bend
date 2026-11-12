import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { compile } from "./generated/compiler.mjs";

const program = (body, type = "U32") => `import Base\ndef main() -> ${type}:\n  ${body}\n`;
async function evaluate(source) {
  const result = compile(source);
  assert.equal(typeof result.type, "string");
  assert.ok(result.type.length > 0);
  assert.ok(result.javascript.includes("export default"));
  assert.doesNotMatch(result.javascript, /\b(?:require|fetch|eval)\s*\(|\bprocess\.|\bBun\b|node:|import\.meta/);
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.javascript).toString("base64")}`);
  assert.equal(typeof module.default.main, "function");
  return module.default.main();
}
function rejects(source, pattern = /Error|forbidden|supported/) {
  assert.throws(() => compile(source), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, pattern);
    return true;
  });
}

test("arithmetic edits compile and execute different modules", async () => {
  const source = program("(6 * 7 : U32)");
  assert.equal(compile(source).type, "U32");
  assert.equal(await evaluate(source), 42);
  assert.equal(await evaluate(source.replace("6 * 7", "6 * 8")), 48);
});

test("custom functions and datatypes", async () => {
  assert.equal(await evaluate(`import Base
 type Shape is Data:
   Rect{width: U32, height: U32}
   Square{side: U32}
 def area(s: Shape) -> U32:
   match s:
     case Rect{w, h}:
       (w * h : U32)
     case Square{+x}:
       (x * x : U32)
 def main() -> U32:
   area(Rect{6, 7})
`), 42);
});

test("lists and structural recursion", async () => {
  assert.equal(await evaluate(`import Base
 def sum(xs: List<U32>, acc: U32) -> U32:
   match xs:
     case Nil{}:
       acc
     case Con{h, t}:
       sum(t, (acc + h : U32))
 def main() -> U32:
   sum([1, 2, 3, 4], 0)
`), 10);
  assert.deepEqual(await evaluate(program("[1, 2, 3]", "List<U32>")), {
    $: "Con", head: 1, tail: { $: "Con", head: 2, tail: { $: "Con", head: 3, tail: { $: "Nil" } } },
  });
});

test("templates and closures", async () => {
  const source = await readFile(new URL("./05-functions-as-values.bend", import.meta.url), "utf8");
  assert.equal(await evaluate(source), 44);
});

test("Nat recursion and F32", async () => {
  assert.equal(await evaluate(program("Nat.add(20n, 22n)", "Nat")), 42);
  assert.equal(await evaluate(program("(1.5 * 2.0 : F32)", "F32")), 3);
});

test("strings, Bool, pairs, Unit, and proof evidence", async () => {
  assert.equal(await evaluate(program('"hello λ"', "String")), "hello λ");
  assert.equal(await evaluate(program("True{}", "Bool")), true);
  assert.deepEqual(await evaluate(program("(42, True{})", "U32 & Bool")), { $: "Tuple", fst: 42, snd: true });
  assert.deepEqual(await evaluate(program("Unit{}", "Unit")), { $: "Unit" });
  assert.equal(await evaluate(program("{==}", "{42 == 42 : U32}")), null);
});

test("arrays update and return plain JS arrays", async () => {
  const source = await readFile(new URL("./10-arrays.bend", import.meta.url), "utf8");
  assert.deepEqual(await evaluate(source), { $: "Tuple", fst: [0, 0, 0, 0, 0, 42, 0, 0], snd: 42 });
});

test("normalchecker accepts a valid recursive law", async () => {
  const source = await readFile(new URL("./09-laws.bend", import.meta.url), "utf8");
  assert.equal(await evaluate(source), null);
});

test("invalid laws retain proof diagnostics and location", () => {
  rejects(`import Base
law wrong:
  {1 == 2 : U32}
def wrong():
  {==}
def main() -> U32:
  0
`, /expected[\s\S]*observed[\s\S]*Location:/);
});

test("unfilled laws, named holes and TODO are not proofs", () => {
  rejects(`import Base\nlaw unfinished:\n  {1 == 1 : U32}\ndef main() -> U32:\n  0\n`, /incomplete|valid proof/);
  rejects(program("?TODO"), /valid proof[\s\S]*Location:[\s\S]*\^/);
  rejects(program("?missing"), /missing|goal|expected/);
});

test("type errors and syntax errors retain source locations", () => {
  rejects(program('"not a number"'), /expected[\s\S]*observed[\s\S]*Location:[\s\S]*3>\|/);
  rejects("import Base\ndef main( -> U32:\n  1\n", /Location:[\s\S]*\^/);
});

test("quantity and termination checks remain active", () => {
  rejects(`import Base
 def duplicate(f: U32 -> U32) -> U32:
   (f(1) + f(2) : U32)
 def main() -> U32:
   duplicate(x => x)
`, /once|quantity|uses|occurrence|affin|expected/);
  rejects(`import Base
 def loop(n: Nat) -> Nat:
   loop(n)
 def main() -> Nat:
   loop(1n)
`, /descend|decreas|subterm|expected/);
});

test("main is required, filled, and has no runtime args", () => {
  rejects("import Base\ndef other() -> U32:\n  1\n", /main/);
  rejects("import Base\ntype main is Data:\n  Main{}\n", /main/);
  rejects("import Base\ndef main(x: U32) -> U32:\n  x\n", /zero runtime arguments/);
  rejects("import Base\ndef main(~x: U32) -> U32:\n  x\n", /non-template/);
});

test("erased main arguments need no JS runtime argument", async () => {
  assert.equal(await evaluate("import Base\ndef main(-x: U32) -> U32:\n  42\n"), 42);
});

test("IO main (including aliases) is forbidden", () => {
  rejects(program("IO.pure(Unit, Unit{})", "IO(Unit)"), /pure value, not IO/);
  rejects(`import Base
 def Effect() -> Type:
   IO(Unit)
 def main() -> Effect():
   IO.pure(Unit, Unit{})
`, /pure value, not IO/);
  rejects(program('IO.print("hello")', "IO(Unit)"), /foreign.*forbidden/);
});

for (const path of ["./chapter.bend", "../relative.bend", "/absolute.bend", "demo@1.0.0.0/Main.bend", "https://example.com/Main.bend", "0x1234/Main.bend", "Base"]) {
  test(`module import forbidden: ${path}`, () => {
    rejects(`import ${path} as Other\ndef main() -> Type:\n  Type\n`, /only 'import Base'/);
  });
}

test("foreign JS/C imports rejected even in unused helpers", () => {
  for (const ext of ["js", "c"]) {
    rejects(`import Base
 def external() -> IO(Unit):
   import "./evil.${ext}"
 def main() -> U32:
   42
`, /foreign.*forbidden/);
  }
  rejects(`import Base
 def helper() -> IO(Unit):
   IO.print("unused")
 def main() -> U32:
   42
`, /foreign.*forbidden/);
  rejects(program("IO.random_u32", "Unit"), /foreign.*forbidden/);
});

test("unsafe decorators and question-mark defs rejected, even unused", () => {
  for (const declaration of ["@unsafe\ndef dubious()", "def dubious?()"]) {
    rejects(`import Base\n${declaration} -> U32:\n  42\ndef main() -> U32:\n  0\n`, /unsafe.*forbidden/);
  }
});

test("import-looking strings and comments are not imports", async () => {
  const text = 'import https://example.com/evil.bend as Evil; @unsafe; def f?; import "evil.js"';
  const source = `# import ./evil.bend as Evil\nimport Base # import ./more.bend as More\n# @unsafe\ndef main() -> String:\n  ${JSON.stringify(text)} # import "evil.js"\n`;
  assert.equal(await evaluate(source), text);
  assert.equal(await evaluate(program('"import Base\\nimport ./fake.bend as Fake"', "String")), "import Base\nimport ./fake.bend as Fake");
  rejects(`import Base\ndef main() -> U32:\n  1\nimport ./late.bend as Late\n`, /Location:/);
});

test("every compile has a fresh book, including after failure", async () => {
  const source = `import Base\ndef local() -> U32:\n  42\ndef main() -> U32:\n  local()\n`;
  assert.equal(await evaluate(source), 42);
  assert.equal(await evaluate(source.replace("42", "48")), 48);
  assert.equal(await evaluate(source), 42);
  rejects(source.replace("42", '"bad"'));
  assert.equal(await evaluate(source), 42);
  rejects(program("local()"), /unknown|declared|scope|expected/);
  rejects(source + "def local() -> U32:\n  99\n", /fresh|earlier|declared|name/);
  const template = await readFile(new URL("./05-functions-as-values.bend", import.meta.url), "utf8");
  assert.equal(await evaluate(template), 44);
  assert.equal(await evaluate(template), 44);
});

test("source byte limits and API argument errors", () => {
  rejects(null, /source must be a string/);
  rejects("#" + "x".repeat(32 * 1024), /source.*32768-byte limit/);
  rejects("#" + "λ".repeat(20 * 1024), /source.*32768-byte limit/);
  assert.equal(compile(program("42") + "#" + "x".repeat(32000)).type, "U32");
});

test("browser bundle runs with no Node/Bun/network/filesystem globals", async () => {
  const javascript = await readFile(new URL("./generated/compiler.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(javascript, /node:(?:fs|os|path|url)|\bprocess\.|\bBun\b|\bfetch\s*\(|\brequire\s*\(|new Function|import\.meta/);
  // This bundle has one ESM export footer; execute the same bundled code in a
  // browser-like realm on ordinary node --test, without experimental VM modules.
  const footer = /export\s*\{\s*compile\s*\};\s*$/;
  assert.match(javascript, footer);
  const context = vm.createContext({ TextEncoder });
  vm.runInContext(javascript.replace(footer, "globalThis.browserCompile = compile; globalThis.browserByteLimit = byteLimit; globalThis.browserRead = readFileSync; globalThis.browserRealpath = realpathSync;"), context);
  const result = context.browserCompile(program("(6 * 8 : U32)"));
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.javascript).toString("base64")}`);
  assert.equal(module.default.main(), 48);
  // Exercise the actual bundled output limiter without generating a deliberately
  // explosive Bend specialization. compile calls this helper after js_lib.
  assert.ok(context.browserRead("/virtual/base.bend", "utf8").startsWith("# Types"));
  for (const path of ["/virtual/effs/print.js", "/virtual/base.bend/../effs/print.js", "/etc/passwd", "https://example.com/evil.js"]) {
    assert.throws(() => context.browserRead(path, "utf8"), /filesystem access denied/);
    assert.throws(() => context.browserRealpath(path), /filesystem access denied/);
  }
  assert.throws(() => context.browserRead("/virtual/base.bend", "hex"), /only UTF-8/);
  const outputLimit = 2 * 1024 * 1024;
  assert.doesNotThrow(() => context.browserByteLimit("x".repeat(outputLimit), outputLimit, "JavaScript output"));
  assert.throws(() => context.browserByteLimit("x".repeat(outputLimit + 1), outputLimit, "JavaScript output"), /JavaScript output.*2097152-byte limit/);
  assert.throws(() => context.browserByteLimit("λ".repeat(outputLimit / 2 + 1), outputLimit, "JavaScript output"), /JavaScript output.*2097152-byte limit/);
});
