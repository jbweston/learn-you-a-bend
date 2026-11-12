"""Export the shared Markdown book as PDF or EPUB, without building the website."""

import argparse
from copy import deepcopy
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit, urlunsplit


SITE = "https://jbweston.github.io/learn-you-a-bend/"
COMPILER_README = "https://github.com/jbweston/learn-you-a-bend/blob/main/src/compiler/README.md"
FORMATS = ("pdf", "epub")
SOURCE_DIR = Path(__file__).resolve().parent


def validate_format(format: str) -> str:
    if format not in FORMATS:
        raise ValueError(f"Unsupported export format {format!r}; expected pdf or epub")
    return format


def pandoc_json(markdown: str) -> dict:
    result = subprocess.run(
        ["pandoc", "--from=markdown", "--to=json"],
        input=markdown, text=True, capture_output=True, check=True,
    )
    return json.loads(result.stdout)


def nodes(value):
    """Walk Pandoc nodes, including nodes inside tables and inline formatting."""
    if isinstance(value, dict):
        if "t" in value:
            yield value
        for child in value.values():
            yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def rewrite_link(target: str, path: Path, anchors: dict, sections: dict, local: dict) -> str:
    url = urlsplit(target)
    if url.scheme or url.netloc:
        return target
    if not url.path:
        if url.fragment in local:
            return urlunsplit(("", "", "", url.query, local[url.fragment]))
        return target

    decoded = unquote(url.path)
    if re.fullmatch(r"\.\./[0-9][^/]*\.bend", decoded):
        base = SITE + url.path[3:]
    elif decoded == "../../README.md":
        base = SITE + "generated/workspace.html"
    elif decoded == "../compiler/README.md":
        base = COMPILER_README
    else:
        destination = (path.parent / decoded).resolve()
        if destination not in anchors:
            return target
        anchor = anchors[destination]
        if url.fragment:
            anchor = sections[destination].get(url.fragment, anchor + "--" + url.fragment)
        return urlunsplit(("", "", "", url.query, anchor))
    published = urlsplit(base)
    return urlunsplit((published.scheme, published.netloc, published.path, url.query, url.fragment))


def assemble_book(book, source_dir: Path, *, parse=pandoc_json) -> dict:
    """Combine Book bodies using Pandoc ASTs; only Link nodes are rewritten."""
    chapters = sorted(book.chapters, key=lambda chapter: chapter.number)
    slugs = [chapter.slug for chapter in chapters]
    if len(slugs) != len(set(slugs)) or "introduction" in slugs:
        raise ValueError("Chapter slugs must be unique and distinct from 'introduction'")
    if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", slug) for slug in slugs):
        raise ValueError("Chapter slugs must be safe HTML basenames (without .html)")
    if len({chapter.number for chapter in chapters}) != len(chapters):
        raise ValueError("Chapter numbers must be unique")

    introduction_path = (source_dir / "chapters" / "introduction.md").resolve()
    parts = [(introduction_path, "introduction", parse(book.introduction), None)]
    parts.extend(
        (chapter.path.resolve(), chapter.slug, parse(chapter.markdown), chapter)
        for chapter in chapters
    )
    # Do not mutate parser results: callers/tests can reuse them safely.
    parts = [(path, slug, deepcopy(document), chapter) for path, slug, document, chapter in parts]
    anchors = {path: slug for path, slug, _, _ in parts}
    sections = {}
    for path, slug, document, _ in parts:
        local = {}
        for node in nodes(document["blocks"]):
            if node["t"] == "Header":
                attrs = node["c"][1]
                if attrs[0]:
                    original = attrs[0]
                    attrs[0] = slug + "--" + original
                    local[original] = attrs[0]
        sections[path] = local

    document = parts[0][2]
    blocks = []
    for path, slug, part, chapter in parts:
        if part["pandoc-api-version"] != document["pandoc-api-version"]:
            raise ValueError("Pandoc API versions differ between chapters")
        for node in nodes(part["blocks"]):
            if node["t"] == "Link":
                target = node["c"][-1]
                target[0] = rewrite_link(target[0], path, anchors, sections, sections[path])
        if chapter is None:
            blocks.append({"t": "Div", "c": [[slug, [], []], part["blocks"]]})
        else:
            # Titles are plain metadata, not Markdown to be interpreted as links/markup.
            title = [{"t": "Str", "c": chapter.title}]
            blocks.append({"t": "Header", "c": [2, [slug, [], []], title]})
            blocks.extend(part["blocks"])
    document["blocks"] = blocks
    document["meta"] = {
        "title": {"t": "MetaString", "c": "Learn You a Bend"},
        "lang": {"t": "MetaString", "c": "en"},
    }
    return document


def export_book(format: str, source_dir: Path = SOURCE_DIR, output_dir: Path | None = None) -> Path:
    validate_format(format)
    # The HTML builder and exporter share this API; importing lazily also lets the
    # transformation tests run while book.py is being developed independently.
    from book import load_book

    document = assemble_book(load_book(source_dir), source_dir)
    destination = (output_dir if output_dir is not None else source_dir / "generated").resolve()
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / f"learn-you-a-bend.{format}"
    command = [
        "pandoc", "--from=json", "--standalone", "--table-of-contents", "--toc-depth=3",
        "--resource-path=" + str(source_dir / "chapters") + ":" + str(source_dir),
        "--output=" + str(output),
    ]
    if format == "pdf":
        command.extend([
            "--pdf-engine=lualatex", "--variable=mainfont:DejaVu Serif",
            "--variable=sansfont:DejaVu Sans", "--variable=monofont:DejaVu Sans Mono",
            "--variable=geometry:margin=25mm", "--variable=fontsize:11pt",
            "--variable=colorlinks:true",
        ])
    else:
        command.extend(["--to=epub3", "--split-level=2"])
    subprocess.run(command, input=json.dumps(document), text=True, check=True)
    return output


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("format", choices=FORMATS)
    parser.add_argument("--source-dir", type=Path, default=SOURCE_DIR)
    parser.add_argument("--output-dir", type=Path)
    arguments = parser.parse_args(argv)
    try:
        output = export_book(arguments.format, arguments.source_dir, arguments.output_dir)
    except (OSError, ValueError, subprocess.CalledProcessError, ImportError) as error:
        print(f"Export failed: {error}", file=sys.stderr)
        return 1
    print(output)
    print(f"Published download: {SITE}generated/{output.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
