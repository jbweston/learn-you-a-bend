"""Check generated book pages and links, including project-site subpaths."""

from html.parser import HTMLParser
from pathlib import Path
import unittest
from urllib.parse import urlsplit

from book import build_pages


ROOT = Path(__file__).resolve().parent


class Elements(HTMLParser):
    def __init__(self, document):
        super().__init__()
        self.elements = []
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class BookTests(unittest.TestCase):
    def setUp(self):
        self.document = (ROOT / "index.html").read_text(encoding="utf-8")
        self.pages = {
            filename: (ROOT / filename).read_text(encoding="utf-8")
            for filename in build_pages(self.document)
        }

    def test_all_views_generated(self):
        self.assertEqual(len(self.pages), 14)
        for filename in self.pages:
            self.assertTrue((ROOT / filename).is_file(), filename)

    def test_chapter_context_and_editable_fences_are_preserved(self):
        full = Elements(self.document)
        chapter_fences = 0
        for filename, document in self.pages.items():
            if filename in {"index.html", "contents.html"}:
                continue
            elements = Elements(document).elements
            headings = [attrs for tag, attrs in elements if tag == "h2"]
            self.assertEqual(len(headings), 1, filename)
            self.assertEqual(headings[0]["id"] + ".html", filename)
            self.assertIn('<script type="module" src="browser.mjs">', document)
            chapter_fences += sum(tag == "pre" and "bend" in attrs.get("class", "").split() for tag, attrs in elements)
            self.assertEqual(document.count('aria-label="Chapter navigation"'), 2)
        full_fences = sum(tag == "pre" and "bend" in attrs.get("class", "").split() for tag, attrs in full.elements)
        self.assertEqual(chapter_fences, full_fences)
        self.assertGreater(chapter_fences, 0)

    def test_links_and_assets_exist_and_are_relative(self):
        for filename, document in self.pages.items():
            for tag, attrs in Elements(document).elements:
                for name in ("href", "src"):
                    url = attrs.get(name, "")
                    parts = urlsplit(url)
                    if parts.scheme or parts.netloc or not parts.path:
                        continue
                    self.assertFalse(parts.path.startswith("/"), (filename, url))
                    target = ROOT / parts.path
                    self.assertTrue(target.is_file(), (filename, url))
                    if parts.fragment and target.suffix == ".html":
                        ids = {attrs.get("id") for _, attrs in Elements(target.read_text(encoding="utf-8")).elements}
                        self.assertIn(parts.fragment, ids, (filename, url))

    def test_contents_and_reading_modes(self):
        contents = self.pages["contents.html"]
        self.assertIn('class="chapter-list"', contents)
        self.assertIn('href="index.html"', contents)
        self.assertNotIn('<pre', contents)
        chapter = self.pages["1-values-not-a-shopping-list-of-commands.html"]
        self.assertIn('href="index.html#1-values-not-a-shopping-list-of-commands"', chapter)
        self.assertIn('href="contents.html" aria-current="page"', chapter)
        self.assertNotIn('<style>', chapter)

    def test_invalid_input_is_rejected(self):
        with self.assertRaises(RuntimeError):
            build_pages("<html></html>")
        with self.assertRaises(RuntimeError):
            build_pages("<html><body><h2>No chapters</h2></body></html>")


if __name__ == "__main__":
    unittest.main()
