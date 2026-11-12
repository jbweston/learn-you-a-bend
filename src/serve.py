"""Serve only the tutorial on loopback; optionally open its browser page."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote, urlsplit


TUTORIAL = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".bend": "text/plain; charset=utf-8",
    }

    def send_head(self):
        parts = unquote(urlsplit(self.path).path).split("/")
        if any(part.startswith(".") for part in parts if part):
            self.send_error(403, "Hidden paths and traversal are not served")
            return None
        resolved = Path(self.translate_path(self.path)).resolve()
        if not resolved.is_relative_to(TUTORIAL):
            self.send_error(403, "Paths outside the tutorial are not served")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, "Directory listings are disabled")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve(port: int, open_browser: bool = False) -> None:
    required = ["index.html", "generated/examples.mjs", "generated/compiler.mjs"]
    if not all((TUTORIAL / name).is_file() for name in required):
        raise RuntimeError("Build the tutorial first: just build")
    handler = partial(Handler, directory=str(TUTORIAL))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Tutorial: {url}\nPress Ctrl+C to stop the server.", flush=True)
        if open_browser:
            if sys.platform == "darwin":
                command = ["open", url]
            else:
                command = ["xdg-open", url]
            subprocess.Popen(command, cwd=TUTORIAL.parent)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--open", action="store_true", dest="open_browser")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535 (0 chooses an available port)")
    try:
        serve(args.port, args.open_browser)
    except (OSError, RuntimeError) as error:
        print(f"Cannot serve tutorial: {error}. Try another port with just open 8001.", file=sys.stderr)
        sys.exit(1)
