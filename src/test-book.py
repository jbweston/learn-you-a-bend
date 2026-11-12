"""Check Markdown metadata, generated book views, and project-site links."""

from dataclasses import replace
from html.parser import HTMLParser
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit

from book import build_pages, load_book, pandoc, render_document


ROOT = Path(__file__).resolve().parent


class Elements(HTMLParser):
    def __init__(self, document):
        super().__init__()
        self.elements = []
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class BookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book = load_book(ROOT)
        cls.document = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.pages = {
            filename: (ROOT / filename).read_text(encoding="utf-8")
            for filename in ["index.html", "contents.html"] + [chapter.slug + ".html" for chapter in cls.book.chapters]
        }

    def test_all_views_generated(self):
        self.assertEqual(len(self.pages), 14)
        self.assertEqual([chapter.number for chapter in self.book.chapters], list(range(12)))
        for chapter in self.book.chapters:
            self.assertNotIn("chapter:", chapter.markdown)
            self.assertEqual(pandoc(chapter.markdown)["blocks"], chapter.document["blocks"])

    def test_chapter_context_and_editable_fences_are_preserved(self):
        full = Elements(self.document)
        chapter_fences = 0
        for chapter in self.book.chapters:
            document = self.pages[chapter.slug + ".html"]
            elements = Elements(document).elements
            headings = [attrs for tag, attrs in elements if tag == "h2"]
            self.assertEqual(len(headings), 1, chapter.slug)
            self.assertEqual(headings[0]["id"], chapter.slug)
            self.assertEqual(headings[0]["data-chapter-source"], chapter.source)
            self.assertIn('<script type="module" src="browser.mjs">', document)
            self.assertIn('<article class="book-chapter"', document)
            chapter_fences += sum(tag == "pre" and "bend" in attrs.get("class", "").split() for tag, attrs in elements)
            self.assertEqual(document.count('aria-label="Chapter navigation"'), 2)
        full_fences = sum(tag == "pre" and "bend" in attrs.get("class", "").split() for tag, attrs in full.elements)
        self.assertEqual(chapter_fences, full_fences)
        self.assertEqual(chapter_fences, 18)
        self.assertIn('<article class="book-tutorial">', self.document)

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
        self.assertIn('href="3-shapes-in-tiny-labelled-boxes.html#a-small-but-important-matching-fence"', contents)
        self.assertNotIn('<pre', contents)
        chapter = self.pages["1-values-not-a-shopping-list-of-commands.html"]
        self.assertIn('href="index.html#1-values-not-a-shopping-list-of-commands"', chapter)
        self.assertIn('href="contents.html" aria-current="page"', chapter)

    def test_missing_and_duplicate_metadata_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            chapters = source / "chapters"
            chapters.mkdir()
            (chapters / "introduction.md").write_text("# Introduction\n")
            file = chapters / "00-test.md"
            file.write_text("No metadata")
            with self.assertRaisesRegex(ValueError, "metadata"):
                load_book(source)
            file.write_text("---\nchapter: 0\ntitle: Test\nslug: test\n---\n\nLesson\n")
            (chapters / "01-test.md").write_text(file.read_text())
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                load_book(source)

    def test_link_transformation_leaves_code_untouched(self):
        chapter = self.book.chapters[1]
        markdown = '[Next](02-functions.md)\n\n```bend\n"../01-values.bend"\n```\n'
        document = pandoc(markdown)
        rendered = render_document(document, chapter.path, self.book)
        self.assertIn('href="2-functions-and-the-suspicious-little-plus.html#2-functions-and-the-suspicious-little-plus"', rendered)
        self.assertIn('../01-values.bend', rendered)
        self.assertEqual(document, pandoc(markdown))

    def test_download_links_only_appear_when_built(self):
        with tempfile.TemporaryDirectory() as temporary:
            book = replace(self.book, source_dir=Path(temporary))
            contents = build_pages(book)["contents.html"]
            self.assertNotIn('href="generated/learn-you-a-bend.pdf"', contents)
            generated = book.source_dir / "generated"
            generated.mkdir()
            (generated / "learn-you-a-bend.pdf").write_bytes(b"fixture")
            contents = build_pages(book)["contents.html"]
            self.assertIn('href="generated/learn-you-a-bend.pdf"', contents)


if __name__ == "__main__":
    unittest.main()
