---
chapter: 4
title: "4. Lists: one biscuit and the rest of the tin"
slug: 4-lists-one-biscuit-and-the-rest-of-the-tin
source: "04-lists.bend"
part: "Functional foundations"
---

Run [04-lists.bend](../04-lists.bend). Expect **10**.

A list is empty, or it contains a head and another list:

- `Nil{}` is empty.
- `Con{h, t}` contains head `h` and tail `t`.
- `[1, 2, 3]` is list-literal sugar.
- `h <> t` constructs a list by putting `h` before `t`.

Our sum carries an accumulator:

```bend
def sum(xs: List<U32>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case Con{h, t}:
      sum(t, (acc + h : U32))
```

Walk through `sum([1, 2], 0)`: consume `1`, continue with `[2]` and accumulator `1`, consume `2`, then reach the empty list and answer `3`.

Each variable in a branch is used at most once. Different branches are alternatives, not two executions that both consume the same value.

> **Haskell companion:**
>
> ```haskell
> sumAcc :: [Word32] -> Word32 -> Word32
> sumAcc [] acc = acc
> sumAcc (h:t) acc = sumAcc t (acc + h)
> ```
>
> This is the same accumulator pattern. Haskell writes `[]` and `(:)` where Bend patterns use `Nil{}` and `Con{h, t}`. Haskell's `<>` usually means semigroup combination; Bend's `<>` here means **cons**, not list concatenation.

### Why the shrinking argument goes first

Bend checks termination. In the recursive call, `t` is a smaller structural part of `xs`, obtained by pattern matching. That is the compiler's evidence that we eventually run out of biscuits.

Recursive arguments are checked left to right: arguments stay unchanged until one becomes a smaller part of its parameter; arguments after that may change. Putting `xs` first lets the accumulator change after the shrinking argument.

Tail calls compile to loops. You do not need a mutable loop counter to repeat work.

> **Haskell contrast:** Haskell permits nontermination, mutual recursion, and infinite lazy lists. Ordinary safe Bend recursion must terminate, and mutual recursion is currently disallowed. Do not translate `repeat 7` into a supposedly infinite Bend list. `@unsafe` can relax recursion restrictions, but sacrifices proof guarantees; it is not our tutorial escape hatch.

**Try it:** sum the empty list; expect **0**. Then sum `[4, 5, 6]`; expect **15**. For a stretch exercise, write a function over `Nat` using `0n` and `1n+p` patterns instead of attempting to convince the checker that arbitrary `U32` subtraction is structural recursion.
