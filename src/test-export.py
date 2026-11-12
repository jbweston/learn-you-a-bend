"""Exporter tests; Pandoc integration is optional, PDF opt-in via EXPORT_TEST_PDF=1."""

from copy import deepcopy
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile


export = importlib.import_module("export")


def link(target):
    return {"t": "Link", "c": [["", [], []], [{"t": "Str", "c": "read"}], [target, "tooltip"]]}


def document(*blocks):
    return {"pandoc-api-version": [1, 23, 1], "meta": {}, "blocks": list(blocks)}


def heading(identifier="details"):
    return {"t": "Header", "c": [3, [identifier, [], []], [{"t": "Str", "c": "Details"}]]}


def fixture(source):
    return SimpleNamespace(
        introduction="Welcome",
        chapters=[
            SimpleNamespace(number=1, title="1. Values", slug="1-values", source="01-values.bend",
                            markdown="Values", path=source / "chapters" / "01-values.md"),
            SimpleNamespace(number=0, title="0. Setup", slug="0-setup", source="",
                            markdown="Setup", path=source / "chapters" / "00-setup.md"),
        ],
    )


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.source = Path("/tmp/export-fixture/src")
        self.book = fixture(self.source)
        self.anchors = {
            chapter.path.resolve(): chapter.slug for chapter in self.book.chapters
        }
        self.sections = {path: {"details": slug + "--details"} for path, slug in self.anchors.items()}
        self.path = self.book.chapters[0].path

    def rewrite(self, target):
        return export.rewrite_link(target, self.path, self.anchors, self.sections, {"details": "1-values--details"})

    def test_formats(self):
        for format in ("pdf", "epub"):
            self.assertEqual(export.validate_format(format), format)
        for format in ("html", "PDF", "", "../pdf", "epub3"):
            with self.subTest(format=format), self.assertRaises(ValueError):
                export.export_book(format)
        with patch("sys.stderr"), self.assertRaises(SystemExit) as error:
            export.main(["html"])
        self.assertEqual(error.exception.code, 2)

    def test_published_links(self):
        self.assertEqual(self.rewrite("../01-values.bend?download=1#example"),
                         export.SITE + "01-values.bend?download=1#example")
        self.assertEqual(self.rewrite("../../README.md"), export.SITE + "generated/workspace.html")
        self.assertEqual(self.rewrite("../compiler/README.md#pin-upgrades"), export.COMPILER_README + "#pin-upgrades")

    def test_chapter_links_and_fragments(self):
        self.assertEqual(self.rewrite("00-setup.md"), "#0-setup")
        self.assertEqual(self.rewrite("./00-setup.md#details"), "#0-setup--details")
        self.assertEqual(self.rewrite("../chapters/00-setup.md?view=1#details"), "?view=1#0-setup--details")
        self.assertEqual(self.rewrite("#details"), "#1-values--details")
        self.assertEqual(self.rewrite("#external-anchor"), "#external-anchor")

    def test_unrelated_links_unchanged(self):
        for target in (
            "https://example.org/00-setup.md", "//example.org/00-setup.md",
            "mailto:reader@example.org", "../other.bend", "../nested/01-values.bend",
            "../README.md", "unknown.md", "https://example.org/../01-values.bend",
        ):
            with self.subTest(target=target):
                self.assertEqual(self.rewrite(target), target)

    def test_assembly_orders_and_namespaces_without_mutation(self):
        code = {"t": "CodeBlock", "c": [["", ["bend"], []], "[code](../01-values.bend)"]}
        inline_code = {"t": "Code", "c": [["", [], []], "[inline](../01-values.bend)"]}
        raw = {"t": "RawBlock", "c": ["html", '<a href="../01-values.bend">raw</a>']}
        image = {"t": "Image", "c": [["", [], []], [], ["../01-values.bend", ""]]}
        sources = {
            "Welcome": document({"t": "Para", "c": [link("01-values.md")]}),
            "Setup": document(heading(), {"t": "Para", "c": [link("#details")]}),
            "Values": document(heading(), code, raw, {"t": "Para", "c": [inline_code, image,
                {"t": "Emph", "c": [link("../01-values.bend")]}, link("00-setup.md#details")]}),
        }
        originals = deepcopy(sources)
        result = export.assemble_book(self.book, self.source, parse=sources.__getitem__)
        headers = [node for node in export.nodes(result) if node["t"] == "Header"]
        self.assertEqual([(h["c"][0], h["c"][1][0]) for h in headers], [
            (2, "0-setup"), (3, "0-setup--details"), (2, "1-values"), (3, "1-values--details"),
        ])
        targets = [node["c"][-1][0] for node in export.nodes(result) if node["t"] == "Link"]
        self.assertEqual(targets, ["#1-values", "#0-setup--details", export.SITE + "01-values.bend", "#0-setup--details"])
        self.assertIn(code, result["blocks"])
        self.assertIn(raw, result["blocks"])
        self.assertIn(inline_code, list(export.nodes(result)))
        self.assertIn(image, list(export.nodes(result)))
        self.assertEqual(sources, originals)

    def test_invalid_metadata(self):
        for attribute, value in (("slug", "1-values"), ("slug", "../../bad"),
                                 ("slug", "introduction"), ("number", 1)):
            book = deepcopy(self.book)
            setattr(book.chapters[1], attribute, value)
            with self.subTest(attribute=attribute, value=value), self.assertRaises(ValueError):
                export.assemble_book(book, self.source, parse=lambda _: document())

    def test_export_commands(self):
        for format in export.FORMATS:
            with self.subTest(format=format), tempfile.TemporaryDirectory() as directory:
                destination = Path(directory) / "output"
                loader = SimpleNamespace(load_book=lambda source: self.book)
                with patch.dict(sys.modules, {"book": loader}), \
                     patch.object(export, "assemble_book", return_value=document()), \
                     patch.object(export.subprocess, "run") as run:
                    output = export.export_book(format, self.source, destination)
                self.assertEqual(output, destination / f"learn-you-a-bend.{format}")
                command = run.call_args.args[0]
                self.assertEqual(command[0], "pandoc")
                self.assertIn("--output=" + str(output), command)
                self.assertEqual(json.loads(run.call_args.kwargs["input"]), document())
                self.assertEqual("--pdf-engine=lualatex" in command, format == "pdf")
                self.assertEqual("--to=epub3" in command, format == "epub")
                self.assertFalse(any("build.py" in item or "bend" == item for item in command))


@unittest.skipUnless(shutil.which("pandoc"), "Pandoc is not on PATH")
class PandocTests(unittest.TestCase):
    def test_real_markdown_links_not_code(self):
        source = Path("/tmp/export-fixture/src")
        book = fixture(source)
        book.introduction = "Welcome: [values](01-values.md)."
        book.chapters[0].markdown = '''### Details
[setup][reference] and [source](../01-values.bend "Run this").

[reference]: 00-setup.md#details

`[inline](../01-values.bend)`

```bend
[code](../01-values.bend)
```
'''
        book.chapters[1].markdown = "### Details\n[local](#details)"
        result = export.assemble_book(book, source)
        links = [node["c"][-1] for node in export.nodes(result) if node["t"] == "Link"]
        self.assertIn(["#0-setup--details", ""], links)
        self.assertIn([export.SITE + "01-values.bend", "Run this"], links)
        code = [node for node in export.nodes(result) if node["t"] in ("Code", "CodeBlock")]
        self.assertTrue(all("../01-values.bend" in node["c"][-1] for node in code))

    def render(self, format):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            book = fixture(source)
            book.introduction = "# Welcome\nLearn Bend 2 — λ, →, and parallel magic."
            book.chapters[0].markdown = "### Details\n[Setup](00-setup.md#details)\n\n```bend\nmain = 42\n```"
            book.chapters[1].markdown = "### Details\nStart here."
            with patch.dict(sys.modules, {"book": SimpleNamespace(load_book=lambda _: book)}):
                output = export.export_book(format, source)
            if format == "epub":
                with zipfile.ZipFile(output) as archive:
                    self.assertEqual(archive.read("mimetype"), b"application/epub+zip")
                    html = "\n".join(archive.read(name).decode() for name in archive.namelist() if name.endswith(".xhtml"))
                    # EPUB requires XML identifiers: Pandoc prefixes numeric
                    # slugs with id_ and updates cross-file links consistently.
                    self.assertIn('id="id_0-setup--details"', html)
                    self.assertIn('id="id_1-values"', html)
                    self.assertIn("ch002.xhtml#id_0-setup--details", html)
                    self.assertNotIn('href="00-setup.md', html)
            else:
                self.assertTrue(output.read_bytes().startswith(b"%PDF-"))
                self.assertGreater(output.stat().st_size, 1000)

    def test_epub_render(self):
        self.render("epub")

    @unittest.skipUnless(os.environ.get("EXPORT_TEST_PDF") == "1" and shutil.which("lualatex"),
                         "PDF smoke test requires EXPORT_TEST_PDF=1 and lualatex")
    def test_pdf_render(self):
        self.render("pdf")

    def test_project_book_api(self):
        import book
        if not hasattr(book, "load_book") or not (export.SOURCE_DIR / "chapters").is_dir():
            self.skipTest("Shared load_book API/chapter migration is not available yet")
        loaded = book.load_book(export.SOURCE_DIR)
        self.assertEqual(sorted(chapter.number for chapter in loaded.chapters), list(range(12)))
        result = export.assemble_book(loaded, export.SOURCE_DIR)
        # Introduction headings live inside its Div and may also be level 2.
        # Chapter headings are the top-level level-2 headers we assemble.
        chapter_ids = [node["c"][1][0] for node in result["blocks"]
                       if node["t"] == "Header" and node["c"][0] == 2]
        self.assertEqual(chapter_ids, [chapter.slug for chapter in sorted(loaded.chapters, key=lambda c: c.number)])


if __name__ == "__main__":
    unittest.main()
