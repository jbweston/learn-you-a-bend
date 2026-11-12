---
chapter: 3
title: "3. Shapes in tiny labelled boxes"
slug: 3-shapes-in-tiny-labelled-boxes
source: "03-shapes.bend"
part: "Functional foundations"
---

Run [03-shapes.bend](../03-shapes.bend). Expect **25**.

```bend
type Shape is Data:
  Circle{r: U32}
  Square{s: U32}
```

This is an algebraic datatype: a `Shape` is either a circle carrying a radius or a square carrying a side length. `Circle` and `Square` are constructors, not subclasses. `Square{5}` constructs a value.

`is Data` says values of this type may be copied. It does **not** make every binding automatically reusable.

To inspect a shape, use pattern matching:

```bend
def area(x: Shape) -> U32:
  match x:
    case Circle{+r}:
      (3 * r * r : U32)
    case Square{+s}:
      (s * s : U32)
```

Each pattern opens one kind of box and names its contents. `+r` and `+s` let the selected numeric field be reused. The circle formula deliberately uses a crude approximation of pi: this is a datatype lesson, not a geometry certification.

> **Haskell companion:**
>
> ```haskell
> data Shape = Circle Word32 | Square Word32
>
> area :: Shape -> Word32
> area (Circle r) = 3 * r * r
> area (Square s) = s * s
> ```
>
> Both languages describe alternatives with constructors and handle them with patterns. Bend adds a kind (`Data` here) and explicit reuse annotations. Constructor braces in Bend are construction/pattern syntax, not Haskell record-update syntax.

### A small but important matching fence

Current Bend has no `if` syntax: branch by matching `True{}` and `False{}`. It also restricts the thing you match on: use a parameter or a pattern-bound variable, in binder order. You cannot directly write `match area(shape):`, nor introduce a local computation before matching a parameter.

For a computed decision, pass the computed value to a helper that matches its parameter. Haskell's unrestricted `case expression of` is not a safe syntax guide here.

**Try it:** change `main` to `area(Circle{4})`. Expect **48**. Then add a `Rectangle{w: U32, h: U32}` constructor and its matching branch.
