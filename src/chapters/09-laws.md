---
chapter: 9
title: "9. Laws: bring a proof, not just good intentions"
slug: 9-laws-bring-a-proof-not-just-good-intentions
source: "09-laws.bend"
part: "Resources, effects, and proofs"
---

Run [09-laws.bend](../09-laws.bend):

```sh
bend src/09-laws.bend
```

The example states and proves that adding zero to any natural number changes nothing:

```bend
law add_zero:
  for x: Nat
  {Nat.add(x, 0n) == x : Nat}
```

This is a claim for **every** `x`, not a test of two or three convenient numbers. The paired `def add_zero(x)` supplies evidence of that claim.

Important punctuation alert: `{a == b : T}` is an **equality type**. It is not a Boolean comparison. To compare values at runtime, use operations such as `U32.is_eq(a, b)` or `Nat.is_eq(a, b)`.

### An induction in miniature

The proof in the file follows the shape of `Nat`:

1. For `0n`, both sides compute to the same thing. `{==}` is reflexivity evidence.
2. For `1n+p`, recursively prove the law for the smaller `p`.
3. Use `%add_zero(p) : ...` to rewrite with that evidence. The `_` marks the occurrence to rewrite in the goal.
4. Finish with `{==}` when the resulting sides compute identically.

A proof is a definition whose type is the proposition. Bend has no tactic script language here; pattern matching, recursion, and rewriting are doing the work.

> **Haskell companion:** a QuickCheck property might say `\x -> x + 0 == (x :: Integer)`. QuickCheck tests generated cases; this Bend law requires a proof covering all natural numbers. Ordinary Haskell signatures do not by themselves demand this equality proof. More advanced Haskell encodings and external verification tools exist, but the closest mental model here is a dependently typed proof assistant such as Lean, not ordinary `Eq` or a test suite.

The file's `main` asks for evidence at `2n`, but that is merely a use of the already general proof. The law is not limited to the value in `main`.

### What proofs do and do not buy you

A checker can establish the claims you actually wrote, under its trusted semantics and dependencies. It cannot guess a missing specification, fix a wrong law, or make foreign effects magically correct. `@unsafe` code is outside Bend's proof guarantees. Tests remain useful for IO behavior, integrations, and whether your laws match the intended requirements.

For this lesson, keep the law and proof together. Larger projects conventionally separate human-written `LAWS.bend` from implementation and `PROOF.bend`; the proof file must import the laws. `bend PROOF.bend` is then the proof gate. Current Bend also offers `--verdict` to recheck through its small BendTT kernel.

**Try it:** change the law's right-hand side to `1n+x` while leaving the proof alone. It must not pass. Restore the original law. Then remove a proof branch and read the reported goal or error instead of treating the checker as an obstacle to work around.
