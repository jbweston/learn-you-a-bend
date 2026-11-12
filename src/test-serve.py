"""Bounded HTTP integration tests; the server is shut down after the tests."""

from functools import partial
from http.server import ThreadingHTTPServer
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from serve import Handler, TUTORIAL


class QuietHandler(Handler):
    def log_message(self, *args):
        pass


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(QuietHandler, directory=str(TUTORIAL))
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def get(self, path):
        return urlopen(self.url + path, timeout=5)

    def test_entry_contains_browser_assets(self):
        with self.get("/") as response:
            page = response.read().decode()
            self.assertEqual(response.status, 200)
            self.assertIn('type="module" src="browser.mjs"', page)
            self.assertIn('href="browser.css"', page)
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_heading_font_is_self_hosted_and_licensed(self):
        with self.get("/browser.css") as response:
            css = response.read().decode()
            self.assertIn("url('fonts/roboto-condensed-bold.ttf')", css)
            self.assertIn("font-display: swap", css)
        with self.get("/fonts/roboto-condensed-bold.ttf") as response:
            self.assertEqual(response.read()[:4], b"\x00\x01\x00\x00")
        with self.get("/fonts/OFL.txt") as response:
            self.assertIn("SIL OPEN FONT LICENSE", response.read().decode())

    def test_workspace_reference_stays_inside_served_tutorial(self):
        with self.get("/") as response:
            self.assertIn('href="generated/workspace.html"', response.read().decode())
        with self.get("/generated/workspace.html") as response:
            page = response.read().decode()
            self.assertIn("Learn You a Bend", page)
            self.assertIn('href="../index.html"', page)

    def test_module_mime_types(self):
        for path in [
                    "/browser.mjs", "/browser-worker.mjs", "/editor.mjs",
                    "/editor-compiler-worker.mjs", "/editor-execution-worker.mjs",
                    "/generated/examples.mjs", "/generated/compiler.mjs",
                ]:
            with self.get(path) as response:
                self.assertEqual(response.headers.get_content_type(), "text/javascript")
                self.assertTrue(response.read())

    def test_compiler_license_and_notice_are_distributed(self):
        with self.get("/generated/compiler.LICENSE") as response:
            self.assertIn("Apache License", response.read().decode())
        with self.get("/generated/compiler.NOTICE") as response:
            self.assertIn("Browser adaptation of Bend 2", response.read().decode())

    def test_no_compilation_or_execution_endpoint(self):
        for path in ["/compile", "/run"]:
            request = Request(self.url + path, data=b'{"source":"unsubmitted example"}', method="POST")
            with self.assertRaises(HTTPError) as error:
                urlopen(request, timeout=5)
            self.addCleanup(error.exception.close)
            self.assertEqual(error.exception.code, 501)

    def test_original_sources_are_served_unchanged(self):
        for source in TUTORIAL.glob("[0-9][0-9]-*.bend"):
            with self.get("/" + source.name) as response:
                self.assertEqual(response.read(), source.read_bytes())
            copy = TUTORIAL / "generated/chapters" / source.name.split("-", 1)[1]
            self.assertEqual(copy.read_bytes(), source.read_bytes())

    def test_repository_private_files_and_traversal_are_not_served(self):
        for path in ["/.envrc", "/%2e%2e/.envrc", "/../flake.nix", "/generated/../.envrc"]:
            with self.assertRaises(HTTPError) as error:
                self.get(path)
            self.addCleanup(error.exception.close)
            self.assertEqual(error.exception.code, 403)

    def test_no_directory_listings(self):
        for path in ["/generated/", "/generated/chapters/"]:
            with self.assertRaises(HTTPError) as error:
                self.get(path)
            self.addCleanup(error.exception.close)
            self.assertEqual(error.exception.code, 403)


if __name__ == "__main__":
    unittest.main()
