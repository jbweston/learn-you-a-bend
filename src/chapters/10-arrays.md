---
chapter: 10
title: "10. Bonus: a mutable array with one owner"
slug: 10-bonus-a-mutable-array-with-one-owner
source: "10-arrays.bend"
part: "Resources, effects, and proofs"
---

Run [10-arrays.bend](../10-arrays.bend):

```bend
def array(value: U32, index: U32) -> Array<U32> & U32:
  a = [0 : U32*8n]
  a[5] <- value
  a[index]

def main() -> Array<U32> & U32:
  array(42, 5)
```

This creates eight zero-filled slots, writes slot five, then reads it. The result is a **pair containing the array and 42**, not just 42. The checker may display the array structurally rather than as a friendly literal.

`A & B` is a pair type. An array read returns ownership of the array along with the element, so the array has not vanished after you inspect it.

`Array<T>` is affine, with one owner. That ownership lets a write update storage in place without observable shared mutation. A write on its own line rebinds the array; this syntax does not grant arbitrary mutation to every binding in Bend.

> **Haskell companion:** ordinary immutable arrays and `Data.Vector` values can be shared freely; mutable structures can be managed through `ST` or `IO`. Bend uses affine ownership to make this array update compatible with purity. It is neither “all Haskell updates copy” nor “Bend is secretly imperative Python”. The resource rules are the key difference.

There are sharp edges: the slot count after `*` must be a power of two, indexes wrap around, and current `a[i]` sugar assumes `Array<U32>`. For other element types or an explicit copy, inspect `Array.get`, `Array.swap`, `Array.set`, and `Array.clone` with `bend base Array`. Do not assume Haskell-style bounds errors or automatic copying.

**Try it:** change the written value to 99; expect the returned element to be **99**. Then move the read to a different, unwritten slot and expect **0**.
