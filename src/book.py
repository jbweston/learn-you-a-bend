"""Add a shared book layout and chapter views to Pandoc's tutorial HTML."""

import html
from pathlib import Path
import re


BODY = re.compile(r"(<body[^>]*>)(.*?)(</body>)", re.DOTALL)
HEADING = re.compile(r'<h2 id="([^"]+)">(.*?)</h2>', re.DOTALL)


def link(url: str, label: str, current: bool = False) -> str:
    selected = ' aria-current="page"' if current else ''
    return f'<a href="{html.escape(url, quote=True)}"{selected}>{html.escape(label)}</a>'


def layout(document: str, content: str, *, title: str, mode: str, anchor: str = "") -> str:
    modes = (
        link("contents.html", "By chapter", mode == "chapters")
        + link("index.html" + (f"#{anchor}" if anchor else ""), "One long page", mode == "full")
    )
    shell = f'''<body class="bend-book{' book-contents' if mode == 'contents' else ''}">
<header class="book-header">
  <a class="book-brand" href="contents.html">Learn You a Bend</a>
  <nav class="book-nav" aria-label="Main navigation">
    {link('contents.html', 'Contents', mode == 'contents')}
    {link('generated/workspace.html', 'Project setup')}
  </nav>
</header>
<main class="book-content" id="content">
<nav class="reading-mode" aria-label="Reading mode">{modes}</nav>
{content}
</main>
<footer class="book-footer">Learn You a Bend · An interactive guide to Bend 2</footer>
</body>'''
    result, count = BODY.subn(lambda _: shell, document, count=1)
    if count != 1:
        raise RuntimeError("Pandoc output has no HTML body")
    result = re.sub(r"<title>.*?</title>", lambda _: f"<title>{html.escape(title)}</title>", result, count=1, flags=re.DOTALL)
    # Own the layout rather than inheriting Pandoc's standalone default styles.
    return re.sub(r"<style>.*?</style>", "", result, flags=re.DOTALL)


def build_pages(document: str) -> dict[str, str]:
    body_match = BODY.search(document)
    if body_match is None:
        raise RuntimeError("Pandoc output has no HTML body")
    body = body_match.group(2)
    headings = list(HEADING.finditer(body))
    chapters = []
    for index, heading in enumerate(headings):
        title = html.unescape(re.sub(r"<[^>]+>", "", heading.group(2)))
        if not (re.match(r"^\d+\.", title) or heading.group(1) == "where-to-wander-next"):
            continue
        end = headings[index + 1].start() if index + 1 < len(headings) else len(body)
        chapters.append((heading.group(1), title, body[heading.start():end]))
    if len(chapters) != 12:
        raise RuntimeError(f"Expected introduction, ten chapters, and next steps; found {len(chapters)}")

    pages = {"index.html": layout(document, body, title="Learn You a Bend", mode="full")}
    items = "\n".join(f"<li>{link(anchor + '.html', title)}</li>" for anchor, title, _ in chapters)
    contents = f'''<section class="book-intro">
<h1>Learn You a Bend</h1>
<p>A little functional programming. A little parallel magic. A lot of runnable examples.</p>
<p>An approachable, interactive guide to <strong>Bend 2</strong>, inspired by
<a href="https://learnyouahaskell.github.io/">Learn You a Haskell</a>.
No Haskell experience required. Edit the code as you read and run it right in your browser.</p>
<p>{link(chapters[0][0] + '.html', 'Start reading →')} · {link('index.html', 'Read it all on one page')}</p>
</section>
<h2>Contents</h2>
<ol class="chapter-list" start="0">{items}</ol>'''
    pages["contents.html"] = layout(document, contents, title="Contents — Learn You a Bend", mode="contents")
    for index, (anchor, title, content) in enumerate(chapters):
        navigation = []
        if index:
            previous = chapters[index - 1]
            navigation.append(link(previous[0] + ".html", "← " + previous[1]))
        navigation.append(link("contents.html", "Contents"))
        if index + 1 < len(chapters):
            following = chapters[index + 1]
            navigation.append(link(following[0] + ".html", following[1] + " →"))
        nav = '<nav class="chapter-navigation" aria-label="Chapter navigation">' + "".join(navigation) + "</nav>"
        pages[anchor + ".html"] = layout(
            document, nav + '<article class="book-chapter">' + content + '</article>' + nav,
            title=title + " — Learn You a Bend", mode="chapters", anchor=anchor,
        )
    return pages


def write_pages(document: str, destination: Path) -> None:
    for filename, content in build_pages(document).items():
        (destination / filename).write_text(content, encoding="utf-8")
