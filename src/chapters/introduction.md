# Learn You a Bend (and Keep Your Haskell Hat On)

A friendly, example-first tour of **Bend 2**: little programs, slightly silly metaphors, and a Haskell travelling companion. This is an original tutorial inspired by the approachable teaching format of *Learn You a Haskell*, not a translation of that book.

Bend wears Python-shaped clothes, carries a functional heart, and counts how often you use its belongings. If you know Haskell, some doors will look familiar. Do not assume they all open the same way.

No Haskell experience is required. The Haskell boxes are comparisons, not prerequisites; skip them on your first trip if you like.

## Run this tutorial in your browser

From the repository root:

```sh
just open
```

This builds the page, its example modules, and a browser-adapted Bend compiler, starts a **localhost-only static-file server**, and opens the tutorial. Keep the terminal running; **Ctrl+C** stops the server. Use `just open 8001` if the default port is busy, or `just serve` to serve without opening a browser. Do not open `index.html` directly: browser modules and workers need HTTP.

The **Bend code boxes in the tutorial are editable directly**. Change the code and click **Run** (or Ctrl/Cmd+Enter): it compiles and executes that box, then displays the type and result. **Reset** restores the snippet and cancels any active run. There is no separate editor or compilation button, and a chapter can have several runnable boxes. Haskell comparisons and shell commands remain read-only.

Partial snippets run with the original chapter's remaining definitions, so a function, datatype, or indented statement can be tried on its own. Each box is independent; edits do not alter another box's context. Paste a complete program beginning with `import Base` to run without chapter context.

Compilation happens entirely in a fresh **compiler Web Worker**, using the pinned Bend 2 TypeScript normalchecker and JavaScript emitter with embedded `Base`. A **separate execution worker** runs the generated program. Neither compiler work nor edited program execution runs on the page's main JavaScript thread. Each phase is limited to five seconds; source is limited to 32 KiB UTF-8, generated JavaScript to 2 MiB, and formatted results to 64 KiB. These limits are not a general memory or JavaScript security sandbox.

The editor supports standalone **pure programs**: only `import Base`, a non-template `main` with zero runtime arguments, and returned data rather than terminal effects. Foreign C/JS, other module/package imports, and unsafe definitions are rejected, including indirect effects in unused helpers. Chapters 7 and 8 replace their IO entry points with labelled pure starters; the original downloads and CLI files are unchanged. JavaScript runs parallel calls sequentially.

Bend's normal type, affinity, termination, and proof checks apply to edits. Try changing chapter 9's law without fixing its proof: the browser compiler reports an error with a source location. Erased evidence displays `null`; that value is not itself proof validation. The independent Lean `--verdict` checker is **not** embedded.

Edited source is sent only between browser workers, never uploaded. There is **no compilation or execution server**, no compiler CLI in the browser, and no Node/Bun runtime dependency. Once built, the tutorial can be served by any static host with JavaScript module MIME types. The compiler's Apache-2.0 attribution is distributed in `generated/compiler.LICENSE` and `generated/compiler.NOTICE`; see `compiler/README.md` for the adaptation and pin-upgrade notes.

Without `just` installed globally, use `nix run .#just -- open`. All build, serving, and test tools come from the project flake; there are no CDN dependencies or remote execution services.

Each numbered `.bend` file is a complete program. Run it from the repository root. Read a chapter, run its program, then change one thing. This is a tutorial, not a spectator sport.
