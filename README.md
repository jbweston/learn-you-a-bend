# Learn You a Bend

An interactive, example-first tutorial for [Bend 2](https://bend-lang.com), inspired by the approachable teaching style of *Learn You a Haskell*. Small programs, exercises, and Haskell comparisons explain both the familiar functional ideas and Bend's distinctive resource rules, parallel calls, and proofs.

No Haskell experience is required. Start with the [tutorial](src/README.md), or open the browser version to edit and run the code as you read.

## Open the tutorial

Requires Nix with flakes enabled. From the repository root:

```sh
nix run .#just -- open
```

If `just` is already available:

```sh
just open
```

The command builds the tutorial, starts a static-file server at **http://127.0.0.1:8000/**, and opens your browser. Keep the terminal running; **Ctrl+C** stops the server. Use `just open 8001` if the port is busy, or `just serve` to serve without opening a browser.

The first build may fetch Nix dependencies. You do not need to install Bend, Pandoc, or the bundler globally. Open the tutorial over HTTP rather than opening `index.html` directly: browser modules and workers require it.

## Edit, run, learn

The tutorial's **Bend code boxes are editable directly**. Each has:

- **Run** — compiles and executes the displayed code, then shows its type and result.
- **Reset** — restores the snippet and cancels an active run.
- Compiler diagnostics with source locations when a program does not check.

There are no separate editor panels or compilation buttons. Chapters can contain several runnable boxes; Haskell comparisons and shell commands remain read-only. Ctrl/Cmd+Enter also runs the current box.

Partial snippets use the original chapter's remaining definitions as context. Boxes are independent: changes in one do not alter another. Paste a complete program beginning with `import Base` to run without chapter context.

### Browser support

The browser uses an adapted version of the pinned **Bend 2 TypeScript compiler**, with `Base` embedded in the bundle. Compilation runs in a fresh Web Worker; generated JavaScript executes in a separate worker. Neither runs on the page's main JavaScript thread, and edited source is never uploaded. The local server serves static files only—there is no compilation or execution API.

Supported programs return pure data from a non-template `main` with zero runtime arguments. Other imports, foreign C/JS effects, and unsafe definitions are rejected. IO entry points have labelled pure browser variants; the downloadable chapter programs retain their CLI behavior. JavaScript executes parallel calls sequentially, without GPU execution.

Bend's normal type, affinity, termination, and proof checks apply to edits. The independent Lean `--verdict` checker is not embedded. Erased proof evidence can display as `null`; the displayed value is not itself a proof verdict.

Compilation and execution each have a five-second deadline. Source, generated JavaScript, and formatted results are size-limited. These safeguards are not a general memory or JavaScript security sandbox.

## Tutorial tasks

Recipes use `nix run` with the project's pinned tools, so they do not depend on a refreshed interactive shell:

```sh
just         # list tasks
just build   # build the page, chapter modules, and browser compiler
just open    # build, serve, and open the tutorial
just serve   # build and serve without opening a browser
just test    # test the compiler, code boxes, workers, and static server
just check   # check and run the numbered Bend chapter programs
```

Without `just` on PATH, prefix a task with `nix run .#just --`.

For the optional real-browser smoke test, provide Chromium and Python on PATH, or set the `CHROMIUM` and `PYTHON` executable overrides:

```sh
nix run .#node -- src/browser-smoke.mjs
```

This tests code edits, diagnostics, Reset recovery, worker isolation, page responsiveness during heavy work, and the absence of source uploads.

## Development environment

The Nix flake and `flake.lock` pin the tutorial's toolchain: Bend, `just`, Pandoc, Python, Node.js, esbuild, and the Linux browser opener.

```sh
nix develop
bend guide
bend src/01-values.bend
```

For fish:

```sh
nix develop --command fish
```

Optional automatic activation uses direnv. Enable its fish hook in `~/.config/fish/config.fish`:

```fish
if status is-interactive
    direnv hook fish | source
end
```

Restart fish, then run `direnv allow` from the repository root. After changing the flake, use `direnv reload` or re-enter the development shell. If Nix reports missing flake files, ensure `flake.nix` and `flake.lock` are tracked by Git.

## Structure and builds

- `src/README.md` — the lessons, exercises, and Haskell comparisons.
- `src/01-*.bend` through `src/10-*.bend` — runnable chapter programs.
- `src/browser.mjs`, `src/editor.mjs`, and worker modules — inline code boxes and browser execution.
- `src/code-context.mjs` — assembles partial snippets with chapter definitions.
- `src/compiler/` — the browser compiler adaptation and its build/upgrade notes.
- `justfile` — build, serving, and validation tasks.
- `flake.nix` and `flake.lock` — pinned tools and Nix apps.

`build` generates `src/index.html` and `src/generated/`; these artifacts are ignored by Git. The compiler is generated from the pinned upstream sources rather than vendored into this repository. Hash and exact-match guards deliberately fail when an unreviewed compiler pin changes; see `src/compiler/README.md` before upgrading Bend.

Once built, the tutorial can be hosted as static files. The host must serve JavaScript module MIME types and permit module workers and Blob module imports in its Content Security Policy. No CDN or remote execution service is needed. Keep `generated/compiler.LICENSE` and `generated/compiler.NOTICE` with the deployed bundle: the upstream compiler and embedded Base are Apache-2.0.
