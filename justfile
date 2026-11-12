# List available tasks.
default:
    @just --list

# Build the HTML, chapter programs, and pinned browser compiler.
build:
    nix run .#build

# Export a downloadable PDF without building the browser compiler.
pdf:
    nix run .#pdf

# Export a downloadable EPUB without building the browser compiler.
epub:
    nix run .#epub

# Rebuild, serve on loopback, and open Learn You a Bend. Ctrl+C stops it.
open port="8000": build
    nix run .#serve -- --port {{quote(port)}} --open

# Serve Learn You a Bend without opening a browser. Ctrl+C stops it.
serve port="8000": build
    nix run .#serve -- --port {{quote(port)}}

# Test the browser compiler, code boxes, workers, chapter programs, and static server.
test: build
    nix run .#node -- --test src/test-*.mjs
    nix run .#python -- src/test-serve.py
    nix develop --command python3 src/test-book.py
    nix develop --command python3 src/test-export.py

# Check and run every Bend chapter with the current compiler.
check:
    for file in src/[0-9][0-9]-*.bend; do nix run .#bend -- "$file" || exit 1; done
