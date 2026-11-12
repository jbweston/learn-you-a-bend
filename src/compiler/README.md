# Pinned browser compiler

`build.py` adapts the exact Nix-pinned Bend 2 core at build time. No upstream
compiler copies are committed here. SHA-256 checks and exact-match transformations
fail closed when the pin changes; a new pin requires reviewing this adaptation.

## Building and upgrading

From the repository root:

```sh
just build
nix run .#node -- --test src/test-compiler.mjs
```

The flake's `build` app supplies Python, esbuild, the CLI used for the
original examples, and the pinned upstream source root through `BEND_SOURCE`.
`src/build.py` calls `build_compiler(generated, upstream)` with `Path`
arguments. The helper itself never invokes Nix. Node is needed only for tests,
not building or browser execution.

Updating the Bend flake input is not enough to upgrade this browser adaptation:
review the changed loader/emitter boundaries and import-policy behavior, update
`PINNED_SHA256` and any asserted transformations, then run the compiler/editor
suite and real-browser smoke test. A changed source pin deliberately fails the
build instead of silently bundling unreviewed platform code.

Outputs:

- `generated/compiler.mjs`: self-contained browser ESM bundle with embedded Base.
- `generated/compiler-src/`: adapted TypeScript, exact `base.bend`, license, and
  esbuild dependency manifest. Build products only; covered by generated's ignore.
- `generated/compiler.LICENSE` and `generated/compiler.NOTICE`: retain these when
  distributing the bundle. The upstream compiler and Base are Apache-2.0. The
  bundle also carries an attribution banner and adapted source files carry change
  notices. Keep the restricted, pinned adaptation's attribution when deploying.

## Browser API and boundary

```js
import { compile } from "./generated/compiler.mjs";
const { javascript, type } = compile(source);
// javascript is an ES module; import it from a Blob in the execution worker.
// The imported module's default.main() returns a plain JS value.
```

`compile` is synchronous. Each call parses Base and the program into a fresh book,
then runs the unchanged upstream `book_valid` and `Comp.js_lib(book, true)`.
Diagnostics become JavaScript `Error` objects with Bend's formatted expected /
observed terms, context, source location and caret when supplied by the checker.
`?TODO` and unfilled laws fail rather than returning an incomplete proof.

The ordinary **Bend normalchecker is included**: types, affinity/quantity,
structural termination, and proof checking remain enabled. **Lean `--verdict`
is not included**; this bundle is not an independent Lean verification service.

Only standalone programs and `import Base` are supported. Module/chapter,
package, URL, absolute and relative imports are rejected by the header loader
and parser. Foreign C/JS and `@unsafe` / `def f?` are rejected using parsed book
metadata and AST dependencies, including unused helpers and indirect references
to Base effects. Base retains its exact upstream declarations, but its effect
implementations are never bundled or allowed to load. The emitter's filesystem
stub permits only the immutable virtual Base file; every snippet read is denied.
The hub/package loader, CLI entry, CLI runtime, `main.ts`, and `safe.ts` are absent.
There are no runtime Node/Bun/polyfill dependencies, compiler-initiated network
requests, compilation servers, or external bundle imports. Static hosting must
serve module MIME types and permit module workers and Blob ES-module imports in
its Content Security Policy; `unsafe-eval` is not needed.

`main` must be filled, non-template, take no runtime arguments, and not return
IO (including return aliases). Erased parameters are allowed. Data results such
as U32, Nat, F32, String, Bool, lists, pairs, arrays, Unit, and erased proof evidence
use the upstream JS library ABI; formatting belongs to the parent worker/UI.

Source is limited to **32 KiB UTF-8** and emitted JavaScript to **2 MiB UTF-8**.
`limits.ts` rejects oversize strings with explicit limit errors. These limits do
not bound checker time, compiler expansion, or runtime allocations. The editor
uses separate disposable compilation and execution workers with five-second timeouts. Output
length is checked after generation, not by altering emitter semantics.

The test suite executes actual data-URL modules and also runs the compiler bundle
in an isolated realm without Node/Bun/network globals. The output-limit boundary
is tested directly through the bundled helper to avoid manufacturing pathological
compiler expansion just for a size test.
