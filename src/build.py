"""Build the static tutorial and its real Bend JavaScript runtime."""

from pathlib import Path
import os
import shutil
import subprocess
import sys

from compiler.build import build_compiler
from book import load_book, page, write_pages


TUTORIAL = Path(__file__).resolve().parent
ROOT = TUTORIAL.parent
GENERATED = TUTORIAL / "generated"


def run(app: str, *args: str) -> None:
    subprocess.run([app, *args], cwd=ROOT, check=True)


def build() -> None:
    upstream = os.environ.get("BEND_SOURCE")
    if upstream is None:
        raise RuntimeError("BEND_SOURCE is missing; use just build or nix run .#build")
    build_compiler(GENERATED, Path(upstream))
    chapters = GENERATED / "chapters"
    chapters.mkdir(parents=True, exist_ok=True)
    sources = sorted(TUTORIAL.glob("[0-9][0-9]-*.bend"))
    if len(sources) != 10:
        raise RuntimeError("Expected exactly ten numbered tutorial chapters.")
    # Bend 2.0.37 accepts these files as entry points, but not digit-leading imports.
    # Copies preserve the original examples byte-for-byte, with import-safe filenames.
    for source in sources:
        shutil.copyfile(source, chapters / source.name.split("-", 1)[1])

    book = load_book(TUTORIAL)
    workspace_source = GENERATED / "workspace.md"
    workspace_source.write_text(
        (ROOT / "README.md").read_text(encoding="utf-8").replace(
            "](src/README.md)", "](../index.html)"
        ), encoding="utf-8",
    )
    runtime = GENERATED / "examples-next.mjs"

    workspace = GENERATED / "workspace-next.html"
    try:
        run("bend", "src/browser-examples.bend", "-o", str(runtime))
        run(
            "pandoc", "--from=gfm", "--to=html5",
            str(workspace_source), "--output", str(workspace),
        )
        workspace.write_text(
            page('<article>' + workspace.read_text(encoding="utf-8") + '</article>',
                 title="Project setup — Learn You a Bend", prefix=".."),
            encoding="utf-8",
        )
        runtime.replace(GENERATED / "examples.mjs")
        workspace.replace(GENERATED / "workspace.html")
        write_pages(book, TUTORIAL)
    finally:
        runtime.unlink(missing_ok=True)

        workspace.unlink(missing_ok=True)
    print("Built the full tutorial, contents, chapter pages, browser compiler, and chapter demos")


if __name__ == "__main__":
    try:
        build()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", None)
        print(f"Tutorial build failed: {error}" + (f"\n{detail.strip()}" if detail else ""), file=sys.stderr)
        sys.exit(1)
