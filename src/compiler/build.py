"""Build the browser compiler from the Nix-pinned Bend 2 sources (no Nix calls)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess

# Fail closed on a changed pin. Review the loader/platform adaptation before
# updating these; the trusted checker and emitter are copied, not rewritten.
PINNED_SHA256 = {
    "bend.ts": "22b5915cd7cccd23b6aa28849b23a7f1e3549333cdd0954ab48103ddd0777e9e",
    "comp.ts": "069aa86248b326de7f4c658d278ea458fdbd644de61ac7b1266ba9bbed0643ee",
    "base.bend": "6bfcfa4f10afdd4767a4fc7a0100b6360098701b31be34ff48546a46ae7b6f41",
}


def replace_once(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f"Pinned compiler adaptation expected one match: {old!r}")
    return text.replace(old, new, 1)


def build_compiler(generated: Path, upstream: Path) -> None:
    """Write compiler-src/ and compiler.mjs; upstream is the pinned source root.

    Requires esbuild on PATH. The caller owns generated/ and supplies BEND_SOURCE
    (as a Path); this function neither invokes Nix nor reads shell configuration.
    """
    generated = Path(generated).resolve()
    upstream = Path(upstream).resolve()
    core = upstream / "bend2"
    sources = {}
    for name, digest in PINNED_SHA256.items():
        data = (core / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError(f"Unsupported Bend pin: {core / name}; review browser adaptation")
        sources[name] = data.decode("utf-8")

    bend = sources["bend.ts"]
    for module in ("fs", "os", "path", "url"):
        bend = replace_once(bend, f'import * as {module} from "node:{module}";\n', "")
    start = "export const BEND_DIR = import.meta.url.startsWith"
    end = "// Tele\n// ===="
    if bend.count(start) != 1 or bend.count(end) != 1:
        raise RuntimeError("Pinned Bend loader boundaries changed")
    left, rest = bend.split(start, 1)
    _, right = rest.split(end, 1)
    # Remove all hub/package/fs code rather than polyfilling Node globals.
    bend = left + 'export const BEND_DIR = "/virtual/";\nexport const BASE_BEND = "/virtual/base.bend";\n\n' + end + right
    comp = replace_once(sources["comp.ts"], 'import * as fs from "node:fs";', 'import * as fs from "./fs.ts";')
    # These CLI-only exports retain the Node runtime string even when unused
    # (tagged templates are not assumed pure by esbuild). No browser entry can
    # run a CLI or dynamically evaluate compiler-generated code.
    comp = replace_once(comp, '''export function io_run(book: Bend.Book, args: string[]): number {
  const src = `${js_lib(book)}\\n${RUNTIME_MAIN}\\ncli_args = ${
    JSON.stringify(args)};\\nreturn io_run(${name_id("$", "main")});`;
  return new Function("require", src)(import.meta.require);
}
''', "")
    comp = replace_once(comp, '''export function js_book(book: Bend.Book): string {
  const lib = js_lib(book);
  const show = show_main();
  return `${lib}\\n${RUNTIME_MAIN}\\ncli(process.argv.slice(1));\\nio_exit(${
    name_id("$", "main")}, ${JSON.stringify(show && show.map((c) =>
      typeof c === "string" ? [js_tag(c), Bend.name_key(c)] : c))});`;
}
''', "")
    runtime_main = "const RUNTIME_MAIN: string = String.raw`"
    if comp.count(runtime_main) != 1 or not comp.rstrip().endswith("`.slice(1);"):
        raise RuntimeError("Pinned CLI runtime boundary changed")
    comp = comp.split(runtime_main, 1)[0]

    tree = generated / "compiler-src"
    tree.mkdir(parents=True, exist_ok=True)
    (tree / "bend.ts").write_text(
        "// Browser adaptation: filesystem/package loading removed; checker unchanged.\n" + bend,
        encoding="utf-8",
    )
    (tree / "comp.ts").write_text(
        "// Browser adaptation: CLI execution removed and foreign file reads denied.\n" + comp,
        encoding="utf-8",
    )
    shutil.copyfile(core / "base.bend", tree / "base.bend")
    (tree / "base.ts").write_text("export const BASE = " + json.dumps(sources["base.bend"], ensure_ascii=True) + ";\n", encoding="utf-8")
    here = Path(__file__).resolve().parent
    for name in ("entry.ts", "fs.ts", "limits.ts"):
        shutil.copyfile(here / name, tree / name)

    license_path = upstream / "LICENSE"
    if not license_path.is_file():
        raise RuntimeError("Pinned Bend source is missing LICENSE")
    shutil.copyfile(license_path, tree / "LICENSE")
    shutil.copyfile(license_path, generated / "compiler.LICENSE")
    notice = "Browser adaptation of Bend 2 (https://github.com/bendlang/bend).\nUpstream compiler and embedded Base: Apache-2.0; see compiler.LICENSE.\nModified bend.ts platform loader and comp.ts CLI/file interfaces; the normalchecker and JavaScript emitter are retained.\n"
    if (upstream / "NOTICE").is_file():
        notice += "\n" + (upstream / "NOTICE").read_text(encoding="utf-8")
    (generated / "compiler.NOTICE").write_text(notice, encoding="utf-8")
    bundle = generated / "compiler-next.mjs"
    try:
        subprocess.run([
            "esbuild", str(tree / "entry.ts"), "--platform=browser", "--format=esm",
            "--bundle", "--target=es2022", "--charset=utf8", "--legal-comments=inline",
            "--banner:js=/*! Bend 2 compiler and Base: Apache-2.0. See compiler.LICENSE and compiler.NOTICE. */",
            f"--metafile={tree / 'bundle.json'}", f"--outfile={bundle}",
        ], check=True)
        manifest = json.loads((tree / "bundle.json").read_text(encoding="utf-8"))
        for name in manifest["inputs"]:
            if Path(name).name in {"main.ts", "safe.ts"}:
                raise RuntimeError(f"Forbidden compiler dependency: {name}")
        for output in manifest["outputs"].values():
            if output["imports"]:
                raise RuntimeError("Browser compiler must have no external runtime imports")
        bundle.replace(generated / "compiler.mjs")
    finally:
        bundle.unlink(missing_ok=True)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("generated", type=Path)
    parser.add_argument("upstream", type=Path)
    args = parser.parse_args()
    build_compiler(args.generated, args.upstream)
