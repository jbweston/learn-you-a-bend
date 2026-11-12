---
chapter: 1
title: "1. Values, not a shopping list of commands"
slug: 1-values-not-a-shopping-list-of-commands
source: "01-values.bend"
part: "Functional foundations"
---

Run [01-values.bend](../01-values.bend):

```sh
bend src/01-values.bend
```

Its entire computation is:

```bend
def main() -> U32:
  (6 * 7 : U32)
```

Expect **42**. The body produces a value; there is no ordinary statement-level `return` here. We will use `return` later inside monadic `do` blocks.

`U32` is an unsigned 32-bit numeric type. The `: U32` on the arithmetic expression tells Bend which operations to use: multiplication here is `U32.mul`. Keep the spaces around operators. Bend does very little type inference, so even a typed function often needs an annotation on an operator expression.

Other literal families include `1.5` for `F32`, `3n` for `Nat`, `'c'` for `Char`, and `"hello"` for `String`. `Nat` represents natural numbers and will also give us a structurally shrinking counter.

> **Haskell companion:** `(6 * 7 :: Word32)` is a close comparison, using `Word32` from `Data.Word`. Haskell's numeric literals and operators use type classes and inference; `(6 * 7 :: Integer)` chooses a different, arbitrary-precision type. Bend's `(a * b : U32)` explicitly selects operations for `U32`. Do not bring `Integer` assumptions to a `U32` party.

**Try it:** replace multiplication with addition, then add parentheses to compute `((6 + 1 : U32) * 7 : U32)`. Predict the result before running it.
