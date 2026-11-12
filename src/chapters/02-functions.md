---
chapter: 2
title: "2. Functions and the suspicious little plus"
slug: 2-functions-and-the-suspicious-little-plus
source: "02-functions.bend"
part: "Functional foundations"
---

Run [02-functions.bend](../02-functions.bend). Expect **49**.

```bend
def square(+x: U32) -> U32:
  (x * x : U32)

def main() -> U32:
  square(7)
```

Read the signature aloud: “`square` receives a reusable `U32` named `x` and produces a `U32`.” A call uses parentheses: `square(7)`.

Why `+x`, rather than `x`? Bend variables are **affine by default**: they may be used at most once. We use `x` twice in multiplication, so we explicitly request reuse. `U32` supports copying; chapter 6 explains how types tell us that.

The `+` in a binder is not addition, and it is not a sign on the number. It is permission to use that binding more than once.

> **Haskell companion:**
>
> ```haskell
> square :: Word32 -> Word32
> square x = x * x
> ```
>
> Ordinary Haskell lets you use `x` zero, one, or many times without an annotation. Bend makes that resource choice explicit. Haskell's optional `LinearTypes` extension is related territory, but linear “exactly once” and Bend's affine “at most once” are not identical rules.

A local binding looks like this:

```bend
def main() -> U32:
  answer = square(7)
  (answer + 1 : U32)
```

Think of `answer = ...` as a `let`, not an update to a global mutable variable. Its final expression gives the result.

**Try it:** remove `+` from `square` and read the compiler's complaint. Restore it afterwards. Then define a `cube` function; how often does its argument appear?
