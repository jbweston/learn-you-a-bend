---
chapter: 0
title: "0. Pack your compiler"
slug: 0-pack-your-compiler
source: ""
part: "Getting started"
---

From the repository root:

```sh
nix develop
bend guide
bend src/01-values.bend
```

If Nix complains that `flake.nix` is untracked, follow the development-environment instructions in the [workspace README](../../README.md). Do not silently switch to an old Bend 1 installation: Bend 1/HVM syntax is not this language.

Useful companions:

```sh
bend --help
bend base --types
bend base List
bend base Nat
```

This tutorial follows the [upstream Bend 2 guide](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md) consulted on 2026-10-17. Bend is evolving quickly; **your installed compiler's `bend guide` and `bend base` are the authority** if a syntax or library detail differs.

### Two sorts of `main`

A pure `main` can return a value:

```bend
import Base

def main() -> U32:
  42
```

`bend file.bend` checks it, normalizes its result, and prints the value. This is handy for tiny experiments, but normalization is not a performance benchmark.

A `main` returning `IO(Unit)` runs effects, such as printing, through the compiled runtime. We meet that version in chapter 7.

> **Haskell companion:** GHC's executable entry point has type `IO ()`. To explore pure Haskell expressions, you normally use GHCi. Bend's command also evaluates a pure `main`, so our early programs need no printing ceremony.

The compiler may print checking information alongside the result. When a chapter says “expect 42”, it means the program's value, not an exact transcript of every compiler message.
