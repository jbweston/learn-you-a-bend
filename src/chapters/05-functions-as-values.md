---
chapter: 5
title: "5. Functions in your backpack"
slug: 5-functions-in-your-backpack
source: "05-functions-as-values.bend"
part: "Functional foundations"
---

Run [05-functions-as-values.bend](../05-functions-as-values.bend). Expect **44**.

Functions can be returned as values:

```bend
def adder(k: U32) -> U32 -> U32:
  x => (x + k : U32)
```

`x => ...` is a lambda. The returned closure remembers `k`; `adder(2)` gives us a function that adds two.

> **Haskell companion:** `adder k = \x -> x + k`. Haskell often writes the equivalent `adder k x = x + k`. Both languages can make functions that capture a local value.

But Bend has a surprise: **a runtime closure is affine**. It can be called at most once, even if everything it captures is copyable. Partial applications, such as `U32.add(2)`, are closures too. You cannot fix that by putting `+` on a closure binding: its type does not permit copying.

Top-level definitions can be called freely. For reusable higher-order code, Bend also has compile-time templates:

```bend
def twice(~f: U32 -> U32, x: U32) -> U32:
  f(f(x))
```

`~f` is substituted as syntax at compile time rather than passed as a runtime closure. That is why it can appear twice.

```bend
def main() -> U32:
  add2 = adder(2)
  twice(~(x => (x + 1 : U32)), add2(40))
```

`add2` is called once. The template adds one twice. Result: 44.

Template arguments must be **closed**: they can mention top-level definitions, but not a caller's local variable. Template parameters go first. Each distinct set of template arguments specializes the template, so this flexibility can cost compiled code size. Templates may call only templates declared above them.

> **Haskell contrast:** ordinary Haskell's `twice f x = f (f x)` freely reuses the runtime function `f`. Bend's `~f` is not just a different spelling of that argument: it changes when and how the function is supplied. Base's `List.map` uses templates for this reason; inspect `bend base List` before guessing its call signature.

**Try it:** replace the incrementing template with `~square`, after adding the top-level `square` definition from chapter 2 above `twice`. Use a small input! Separately, try calling `add2` twice and examine the rejection.
