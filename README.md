# Learn You a Bend

An interactive, example-first tutorial for [Bend 2](https://bend-lang.com), inspired by the approachable teaching style of *Learn You a Haskell*. Small programs, exercises, and Haskell comparisons explain both the familiar functional ideas and Bend's distinctive resource rules, parallel calls, and proofs.

No Haskell experience is required. Start with the [tutorial](src/README.md), or open the browser version to edit and run the code as you read.

## Read online

Visit **[Learn You a Bend](https://jbweston.github.io/learn-you-a-bend/)** to read the tutorial and run its editable examples without installing anything.

### Publish with GitHub Pages

The workflow in `.github/workflows/pages.yml` exports the PDF and EPUB, builds and tests the interactive tutorial with the pinned Nix toolchain, then deploys its static files on every push to `main`. You can also run it manually from the repository's **Actions** tab.

One-time repository setup:

1. Open **Settings → Pages** on GitHub.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push the workflow to `main` (or run **Deploy GitHub Pages** manually).

The site will be available at `https://jbweston.github.io/learn-you-a-bend/` after the workflow succeeds. Forks use `https://<owner>.github.io/<repository>/`; asset and worker paths are relative, so no base-path configuration is needed. The deployment includes the chapter downloads and compiler license notices, but not the development scripts. No backend or API keys are required.

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

## Choose how to read

The **By chapter / One long page** links switch reading modes. Open `contents.html` for the book's contents and individual chapter pages, with Previous/Contents/Next navigation. `index.html` retains the complete tutorial for searching, scrolling, and printing. Both modes use the same editable examples and work on GitHub Pages without a server-side router.

The color palette takes its cues from [Bend's website](https://www.bend-lang.com/): warm paper backgrounds, dark gray-brown text, and muted violet accents. Text accents use a darker violet for readable contrast. Headings retain Roboto Condensed and body text uses sans-serif; only code uses monospace. The book layout remains responsive with keyboard-friendly navigation.

## Edit, run, learn

The tutorial's **Bend code boxes are editable directly**. Each has:

- **Run** — compiles and executes the displayed code, then shows its type and result.
- **Reset** — restores the snippet and cancels an active run.
- Compiler diagnostics with source locations when a program does not check.

There are no separate editor panels or compilation buttons. Chapters can contain several runnable boxes; Haskell comparisons and shell commands remain read-only. Ctrl/Cmd+Enter also runs the current box.

Partial snippets use the original chapter's remaining definitions as context. Boxes are independent: changes in one do not alter another. Paste a complete program beginning with `import Base` to run without chapter context.

### Reader mode and printing

Every editable code box retains a semantic `<pre><code>` listing in the document. Firefox Reader View can show that listing after removing the editor controls; ordinary browsing still shows only the editor. Regular listings track edits and Reset. For the labelled pure IO variants, reader mode and print retain the original terminal-IO example rather than silently changing the lesson.

Printing hides the interactive controls and shows the code listings. Reader View is read-only; return to the normal page to run examples.

### Browser support

The browser uses an adapted version of the pinned **Bend 2 TypeScript compiler**, with `Base` embedded in the bundle. Compilation runs in a fresh Web Worker; generated JavaScript executes in a separate worker. Neither runs on the page's main JavaScript thread, and edited source is never uploaded. The local server serves static files only—there is no compilation or execution API.

Supported programs return pure data from a non-template `main` with zero runtime arguments. Other imports, foreign C/JS effects, and unsafe definitions are rejected. IO entry points have labelled pure browser variants; the downloadable chapter programs retain their CLI behavior. JavaScript executes parallel calls sequentially, without GPU execution.

Bend's normal type, affinity, termination, and proof checks apply to edits. The independent Lean `--verdict` checker is not embedded. Erased proof evidence can display as `null`; the displayed value is not itself a proof verdict.

Compilation and execution each have a five-second deadline. Source, generated JavaScript, and formatted results are size-limited. These safeguards are not a general memory or JavaScript security sandbox.

## Tutorial tasks

Recipes use the project's pinned Nix tools, so they do not depend on a refreshed interactive shell:

```sh
just         # list tasks
just build   # build the page, chapter modules, and browser compiler
just open    # build, serve, and open the tutorial
just serve   # build and serve without opening a browser
just test    # test the compiler, code boxes, workers, and static server
just check   # check and run the numbered Bend chapter programs
just pdf     # export a printable book with LuaLaTeX
just epub    # export an EPUB 3 ebook
```

Without `just` on PATH, prefix a task with `nix run .#just --`.

For the optional real-browser smoke test, provide Chromium and Python on PATH, or set the `CHROMIUM` and `PYTHON` executable overrides:

```sh
nix run .#node -- src/browser-smoke.mjs
```

This tests code edits, diagnostics, Reset recovery, worker isolation, page responsiveness during heavy work, and the absence of source uploads.

## Authoring and book exports

Edit the lessons in `src/chapters/`, not generated HTML. Each chapter has YAML front matter:

```yaml
---
chapter: 1
title: "1. Values, not a shopping list of commands"
slug: 1-values-not-a-shopping-list-of-commands
source: 01-values.bend
part: Functional foundations
---
```

`chapter` determines order; `slug` is the stable page URL and chapter anchor; `source` names the original Bend program used for partial-snippet context (omit it for standalone examples). The chapter title comes from metadata; body subsections use `###`. Keep runnable examples in fenced `bend` blocks. `src/chapters/introduction.md` is the shared introduction, and `src/README.md` is a source-reading index.

Pandoc parses metadata and Markdown into its document AST. The website renders each chapter directly and applies the shared templates in `src/templates/`; it no longer splits HTML. Chapter order, subsection contents, and navigation are generated from the sources.

`just pdf` and `just epub` export the same sources to `src/generated/learn-you-a-bend.pdf` and `.epub`. Neither needs the browser compiler build. PDF uses pinned LuaLaTeX and DejaVu fonts; the first export may fetch additional Nix dependencies. Ebooks have static code listings and links to the hosted chapter downloads, not runnable widgets. Run the exports before `just build` to include download links on the contents page. GitHub Pages does this automatically.

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

- `src/chapters/*.md` — the lessons, exercises, metadata, and Haskell comparisons.
- `src/README.md` — source-reading index.
- `src/templates/` and `src/book.py` — shared page layout and chapter publishing.
- `src/export.py` — PDF/EPUB publishing from the same sources.
- `src/01-*.bend` through `src/10-*.bend` — runnable chapter programs.
- `src/browser.mjs`, `src/editor.mjs`, and worker modules — inline code boxes and browser execution.
- `src/code-context.mjs` — assembles partial snippets with chapter definitions.
- `src/compiler/` — the browser compiler adaptation and its build/upgrade notes.
- `justfile` — build, serving, and validation tasks.
- `flake.nix` and `flake.lock` — pinned tools and Nix apps.

`build` generates `src/index.html`, `src/contents.html`, individual chapter HTML pages, and `src/generated/`; these artifacts are ignored by Git. `src/book.py` renders the ordered chapter sources through Pandoc and shared templates; `src/export.py` assembles them into PDF/EPUB without duplicating the lessons. The compiler is generated from the pinned upstream sources rather than vendored into this repository. Hash and exact-match guards deliberately fail when an unreviewed compiler pin changes; see `src/compiler/README.md` before upgrading Bend.

Once built, the tutorial can be hosted as static files. The host must serve JavaScript module MIME types and permit module workers and Blob module imports in its Content Security Policy. No CDN or remote execution service is needed. Keep `generated/compiler.LICENSE` and `generated/compiler.NOTICE` with the deployed bundle: the upstream compiler and embedded Base are Apache-2.0.
