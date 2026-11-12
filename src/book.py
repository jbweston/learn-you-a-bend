"""Publish a shared Markdown book through Pandoc and small HTML templates."""

from copy import deepcopy
from dataclasses import dataclass
import html
import json
from pathlib import Path
import re
from string import Template
import subprocess
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"
COMPILER_README = "https://github.com/jbweston/learn-you-a-bend/blob/main/src/compiler/README.md"


@dataclass(frozen=True)
class Chapter:
    number: int
    title: str
    slug: str
    source: str
    markdown: str
    path: Path
    part: str
    document: dict


@dataclass(frozen=True)
class Book:
    introduction: str
    chapters: tuple[Chapter, ...]
    source_dir: Path
    introduction_document: dict


def pandoc(markdown: str) -> dict:
    result = subprocess.run(
        ["pandoc", "--from=markdown-smart", "--to=json"],
        input=markdown, text=True, capture_output=True, check=True,
    )
    return json.loads(result.stdout)


def stringify(value: dict) -> str:
    if value["t"] == "MetaString":
        return value["c"]
    if value["t"] == "MetaInlines":
        return "".join(node.get("c", "") if node["t"] == "Str" else " " for node in value["c"])
    raise ValueError("Chapter metadata must be plain scalar text")


def load_book(source_dir: Path = ROOT) -> Book:
    source_dir = source_dir.resolve()
    directory = source_dir / "chapters"
    introduction = (directory / "introduction.md").read_text(encoding="utf-8")
    chapters = []
    for path in sorted(directory.glob("*.md")):
        if path.name == "introduction.md":
            continue
        raw = path.read_text(encoding="utf-8")
        front = re.match(r"\A---\r?\n.*?\r?\n---\r?\n", raw, re.DOTALL)
        if front is None:
            raise ValueError(f"{path.name}: expected YAML chapter metadata")
        document = pandoc(raw)
        meta = document["meta"]
        try:
            number = int(stringify(meta["chapter"]))
            title = stringify(meta["title"])
            slug = stringify(meta["slug"])
            source = stringify(meta["source"]) if "source" in meta else ""
            part = stringify(meta["part"]) if "part" in meta else "Chapters"
        except (KeyError, ValueError) as error:
            raise ValueError(f"{path.name}: invalid chapter metadata: {error}") from error
        if number < 0 or not title or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug):
            raise ValueError(f"{path.name}: invalid chapter number, title, or slug")
        if slug in {"index", "contents", "browser-head"}:
            raise ValueError(f"{path.name}: reserved page slug {slug}")
        if source and (not re.fullmatch(r"[0-9][0-9]-[a-z0-9-]+\.bend", source) or not (source_dir / source).is_file()):
            raise ValueError(f"{path.name}: missing or invalid Bend context source {source!r}")
        chapters.append(Chapter(number, title, slug, source, raw[front.end():].lstrip("\n"), path, part, document))
    chapters.sort(key=lambda chapter: chapter.number)
    if not chapters:
        raise ValueError("The book needs at least one chapter")
    for field in ("number", "slug"):
        values = [getattr(chapter, field) for chapter in chapters]
        if len(values) != len(set(values)):
            raise ValueError(f"Duplicate chapter {field}")
    return Book(introduction, tuple(chapters), source_dir, pandoc(introduction))


def nodes(value):
    if isinstance(value, dict):
        if "t" in value:
            yield value
        for child in value.values():
            yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def link(url: str, label: str, current: bool = False) -> str:
    selected = ' aria-current="page"' if current else ''
    return f'<a href="{html.escape(url, quote=True)}"{selected}>{html.escape(label)}</a>'


def template(name: str, **values: str) -> str:
    return Template((TEMPLATES / name).read_text(encoding="utf-8")).substitute(values)


def render_document(document: dict, path: Path, book: Book, *, full: bool = False) -> str:
    document = deepcopy(document)
    chapters = {chapter.path.resolve(): chapter for chapter in book.chapters}
    for node in nodes(document["blocks"]):
        if node["t"] not in {"Link", "Image"}:
            continue
        target = node["c"][-1]
        url = urlsplit(target[0])
        if url.scheme or url.netloc or not url.path:
            continue
        destination = (path.parent / unquote(url.path)).resolve()
        chapter = chapters.get(destination)
        if chapter:
            replacement = "index.html" if full else chapter.slug + ".html"
            fragment = url.fragment or chapter.slug
        elif destination == book.source_dir.parent / "README.md":
            replacement, fragment = "generated/workspace.html", url.fragment
        elif destination == book.source_dir / "compiler/README.md":
            replacement, fragment = COMPILER_README, url.fragment
        elif destination.is_relative_to(book.source_dir) and destination.is_file():
            replacement, fragment = destination.relative_to(book.source_dir).as_posix(), url.fragment
        else:
            continue
        target[0] = replacement + ("?" + url.query if url.query else "") + ("#" + fragment if fragment else "")
    result = subprocess.run(
        ["pandoc", "--from=json", "--to=html5", "--no-highlight"],
        input=json.dumps(document), text=True, capture_output=True, check=True,
    )
    return result.stdout


def page(content: str, *, title: str, mode: str = "", anchor: str = "", prefix: str = ".") -> str:
    reading_mode = ""
    if mode:
        reading_mode = '<nav class="reading-mode" aria-label="Reading mode">' + (
            link("contents.html", "By chapter", mode == "chapters")
            + link("index.html" + ("#" + anchor if anchor else ""), "One long page", mode == "full")
        ) + '</nav>'
    return template(
        "page.html", title=html.escape(title), prefix="" if prefix == "." else prefix + "/",
        scripts='<script type="module" src="browser.mjs"></script>' if mode != "contents" and prefix == "." else "",
        body_class="book-contents" if mode == "contents" else "", reading_mode=reading_mode, content=content,
    )


def chapter_content(chapter: Chapter, book: Book, *, full: bool = False) -> str:
    heading = f'<h2 id="{chapter.slug}" data-chapter-source="{chapter.source}">{html.escape(chapter.title)}</h2>\n'
    return heading + render_document(chapter.document, chapter.path, book, full=full)


def contents_list(book: Book) -> str:
    groups = []
    part = None
    for chapter in book.chapters:
        if chapter.part != part:
            if part is not None:
                groups.append("</ol>")
            part = chapter.part
            groups.append(f'<h3>{html.escape(part)}</h3><ol class="chapter-list" start="{chapter.number}">')
        sections = []
        for node in nodes(chapter.document["blocks"]):
            if node["t"] == "Header" and node["c"][0] == 3:

                # Let Pandoc stringify formatted subsection titles without HTML parsing.
                label = subprocess.run(["pandoc", "--from=json", "--to=plain"], input=json.dumps({**chapter.document, "blocks": [{"t": "Plain", "c": node["c"][2]}]}), text=True, capture_output=True, check=True).stdout.strip()
                sections.append("<li>" + link(chapter.slug + ".html#" + node["c"][1][0], label) + "</li>")
        subsections = '<ul>' + "".join(sections) + '</ul>' if sections else ''
        groups.append("<li>" + link(chapter.slug + ".html", chapter.title) + subsections + "</li>")
    groups.append("</ol>")
    return "\n".join(groups)


def build_pages(book: Book) -> dict[str, str]:
    introduction = render_document(book.introduction_document, book.source_dir / "chapters/introduction.md", book, full=True)
    full = '<article class="book-tutorial">' + introduction
    full += '<nav aria-label="Book contents"><h2>Your map</h2><ol start="0">' + "".join('<li>' + link('#' + chapter.slug, re.sub(r'^\d+\.\s*', '', chapter.title)) + '</li>' for chapter in book.chapters) + '</ol></nav>'
    full += "".join(chapter_content(chapter, book, full=True) for chapter in book.chapters) + '</article>'
    pages = {"index.html": page(full, title="Learn You a Bend", mode="full")}
    downloads = " · ".join(
        link(f"generated/learn-you-a-bend.{format}", format.upper())
        for format in ("pdf", "epub") if (book.source_dir / f"generated/learn-you-a-bend.{format}").is_file()
    )
    contents = template("contents.html", start=link(book.chapters[0].slug + '.html', 'Start reading →'), chapters=contents_list(book), downloads=downloads or 'Prefer an ebook? Build PDF and EPUB with just pdf and just epub.')
    pages["contents.html"] = page(contents, title="Contents — Learn You a Bend", mode="contents")
    for index, chapter in enumerate(book.chapters):
        links = []
        if index:
            previous = book.chapters[index - 1]
            links.append(link(previous.slug + ".html", "← " + previous.title))
        links.append(link("contents.html", "Contents"))
        if index + 1 < len(book.chapters):
            following = book.chapters[index + 1]
            links.append(link(following.slug + ".html", following.title + " →"))
        navigation = '<nav class="chapter-navigation" aria-label="Chapter navigation">' + "".join(links) + '</nav>'
        content = template("chapter.html", navigation=navigation, source=chapter.source, content=chapter_content(chapter, book))
        pages[chapter.slug + ".html"] = page(content, title=chapter.title + " — Learn You a Bend", mode="chapters", anchor=chapter.slug)
    return pages


def write_pages(book: Book, destination: Path) -> None:
    for filename, content in build_pages(book).items():
        (destination / filename).write_text(content, encoding="utf-8")
