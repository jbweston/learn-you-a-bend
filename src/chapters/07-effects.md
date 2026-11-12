---
chapter: 7
title: "7. Effects, without pretending printing is pure"
slug: 7-effects-without-pretending-printing-is-pure
source: "07-effects.bend"
part: "Resources, effects, and proofs"
---

Run [07-effects.bend](../07-effects.bend). Expect:

```text
Hello, functional adventurer!
```

A pure function calculates a value. An `IO` computation describes effects which the runtime performs. Bend is pure, but purity does not mean we are forbidden to say hello.

```bend
def greeting(name: String) -> String:
  "Hello, " ++ name ++ "!"

def greet(name: String) -> IO(String):
  do IO<String>:
    return greeting(name)

def main() -> IO(Unit):
  do IO<Unit>:
    text : String <- greet("functional adventurer")
    IO.print(text)
```

`greeting` is the shared pure function used by both the browser panel and the IO wrapper. `++` joins strings. `return` wraps a pure result in the monad; it is not an imperative early exit. `<-` binds the result of an effect. Bend requires the bind's type annotation. `IO.print` is a `Unit` step; `Unit` is the no-interesting-result type.

> **Haskell companion:**
>
> ```haskell
> greet :: String -> IO String
> greet name = pure ("Hello, " ++ name ++ "!")
>
> main :: IO ()
> main = do
>   text <- greet "functional adventurer"
>   putStrLn text
> ```
>
> The sequencing idea is familiar, but Bend spells `Unit` rather than `()` and explicitly names the monad/result in the `do` header. Haskell usually infers the binding's type.

### The same idea works for `Maybe`

The file also defines:

```bend
def add_strs(a: String, b: String) -> Maybe<&2, U32>:
  do Maybe<&2, U32>:
    x : U32 <- U32.read(a)
    y : U32 <- U32.read(b)
    return (x + y : U32)
```

`U32.read` returns an optional result. If either parse is `None{}`, the whole block returns `None{}`. Otherwise, it returns `Some{sum}`. This is a tidy pipeline with failure, not an exception secretly hiding behind a type.

To try it, replace the file's `main` with:

```bend
def main() -> Maybe<&2, U32>:
  add_strs("40", "2")
```

Expect a `Some` containing **42**. Then try `"biscuits"` instead of `"2"`; expect `None`.

> **Haskell companion:** this resembles `do` over `Maybe`, using `readMaybe` from `Text.Read`. Bend desugars the block through named `Maybe.bind` and `Maybe.pure` definitions, including the explicit `&2` argument. It is not relying on Haskell's `Monad` type-class instance inference. The same naming convention works for custom monads.

IO handles are affine too: effects on a file or socket hand back its handle beside the result. Concurrency (`IO.fork` / `IO.join`) is a separate concern from the pure parallel calls in the next chapter.

**Try it:** print a second message after the greeting. Then run both `Maybe` experiments. Notice that the greeting function itself never prints anything.
