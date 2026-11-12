# List available tasks.
default:
    @just --list

# Build the HTML, chapter programs, and pinned browser compiler.
build:
    nix run .#build

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
    nix run .#python -- src/test-book.py

# Check and run every Bend chapter with the current compiler.
check:
    for file in src/[0-9][0-9]-*.bend; do nix run .#bend -- "$file" || exit 1; done
