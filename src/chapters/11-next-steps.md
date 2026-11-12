---
chapter: 11
title: "Where to wander next"
slug: where-to-wander-next
source: ""
part: "Next steps"
---

You have met values, functions, algebraic data, structural recursion, closures, quantities, monads, parallel calls, proofs, and ownership-aware arrays. That is a respectable backpack for a first walk.

A few small next projects:

- Extend the shape datatype and check several concrete areas.
- Write `Nat`-recursive list helpers before reaching for unsafe recursion.
- Parse two inputs with `Maybe`, then keep printing confined to `IO`.
- State a law for a tiny function and prove it by matching its input.
- Inspect Base's quantity-aware container signatures rather than guessing their Haskell equivalents.

### Pocket translation guide

| Haskell idea | Bend 2 neighbour | Important difference |
| --- | --- | --- |
| `f x` | `f(x)` | Python-shaped calls do not imply Python semantics. |
| `let x = ...` | `x = ...` | Bindings are affine by default. |
| `data` and constructors | `type ... is Data/Type` and `K{...}` | The kind determines copyability. |
| `[]`, `h:t` | `Nil{}`, `Con{h, t}`, `h <> t` | `<>` is cons here, not semigroup append. |
| `\x -> ...` | `x => ...` | Runtime closures may be called at most once. |
| Polymorphic functions | Erased type/kind parameters | More explicit arguments and fewer inferred types. |
| Reusing a function argument | A `~` template argument | Compile-time substitution, with closed arguments. |
| `IO ()` and `do` | `IO(Unit)` and `do IO<Unit>:` | Explicit result annotations and affine handles. |
| `Maybe` pipelines | `do Maybe<&2, T>:` | Named `bind`/`pure` conventions rather than instance inference. |
| Recursive definitions | Structural recursion | Termination required; no ordinary mutual recursion. |
| QuickCheck properties | Laws plus proof definitions | Sampling examples is not proving a universal claim. |
| Parallel strategies | Binary parallel calls | Balanced work and target/runtime choices matter. |
| `ST`/mutable arrays | Affine `Array<T>` | Ownership is returned alongside reads. |

Keep the [official guide](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md), `bend guide`, and `bend base` nearby. When an analogy and the compiler disagree, the analogy loses. Even a charming analogy.

### Running the whole shelf

After entering the development shell, run all chapter files from the repository root:

```sh
for file in src/*.bend; do
  bend "$file" || break
done
```

For the browser build and its regression tests, use `just test`. For the original CLI programs, use `just check`. The browser build copies the numbered chapters unchanged into `generated/chapters/` with import-safe names, because the pinned Bend 2.0.37 compiler rejects digit-leading module imports; the source filenames remain unchanged. `browser-examples.bend` delegates to those chapter functions and compiles to `generated/examples.mjs`. Build artifacts are ignored by Git.
