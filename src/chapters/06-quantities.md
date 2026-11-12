---
chapter: 6
title: "6. Quantities: the librarian is counting"
slug: 6-quantities-the-librarian-is-counting
source: "06-quantities.bend"
part: "Resources, effects, and proofs"
---

Run [06-quantities.bend](../06-quantities.bend). Its result contains **three copies of 7**.

```bend
def replicate(-A: Data, n: Nat, +x: A) -> List<A>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      x <> replicate(A, p, x)
```

Now we are generic: `A` is a type, not a particular number type. The call is `replicate(U32, 3n, 7)`.

| Binder | Meaning | What to remember |
| --- | --- | --- |
| `x: A` | Affine | Use zero or one times. Dropping is allowed. |
| `+x: A` | Reusable | Requires a type whose values support copying. |
| `-A: Data` | Erased | Seen by the checker, removed at runtime; usable in types/proofs and erased positions. |
| `~f: ...` | Template | Compile-time syntax substitution, not a runtime ownership quantity. |

The type argument `A` is erased. We can pass it to the recursive call's erased parameter without manufacturing a runtime type object. The value `x` appears both in the new list node and in the recursive call, so it needs `+`.

### Kinds are the rules for a whole type

A kind tells us how reusable the values of a type can be:

- `Type` is shorthand for `Kind(&1)`: affine values, such as closures and arrays.
- `Data` is shorthand for `Kind(&2)`: values that can be copied.
- `&0`, `&1`, and `&2` describe erased, affine, and reusable quantities.

Generic containers can be quantity-aware too. Base's full list type is `List<a, A>`, with `A: Kind(a)`. `List<U32>` is an affine-list shorthand; `+List<U32>` denotes the reusable quantity specialization. A `+` on a **type expression** and a `+` on a **variable binder** are related, but are not the same syntactic operation.

You do not need every kind formula to start writing programs. Remember the useful distinction: “this type *can* be copied” is not “this binding *has* permission to be used twice.”

> **Haskell companion:** `replicate :: Int -> a -> [a]` expresses genericity through a type variable, normally inferred and implicitly quantified. Bend exposes an erased type argument and its copyability requirement. `Data` here is a Bend kind, **not** Haskell's `Data.Data` class or the `data` keyword.

**Try it:** change the counter to `0n`, then to `5n`. Remove `+` from `x` to see why two uses require permission. Restore it before moving on.
