import Base
# The build copies original chapters here: the pinned compiler rejects digit-leading imports.
import ./generated/chapters/values.bend as Chapter1
import ./generated/chapters/functions.bend as Chapter2
import ./generated/chapters/shapes.bend as Chapter3
import ./generated/chapters/lists.bend as Chapter4
import ./generated/chapters/functions-as-values.bend as Chapter5
import ./generated/chapters/quantities.bend as Chapter6
import ./generated/chapters/effects.bend as Chapter7
import ./generated/chapters/parallelism.bend as Chapter8
import ./generated/chapters/laws.bend as Chapter9
import ./generated/chapters/arrays.bend as Chapter10

def values() -> U32:
  Chapter1.main()

def square(x: U32) -> U32:
  Chapter2.square(x)

def area(shape: U32, +size: U32) -> U32:
  Chapter3.area(Bool.pick(Chapter3.Shape, U32.is_eq(shape, 0),
    Chapter3.Square{size}, Chapter3.Circle{size}))

def sum(xs: List<U32>) -> U32:
  Chapter4.sum(xs, 0)

def functions(x: U32, k: U32) -> U32:
  add = Chapter5.adder(k)
  Chapter5.twice(~(y => (y + 1 : U32)), add(x))

def replicate(n: Nat, x: U32) -> List<U32>:
  Chapter6.replicate(U32, n, x)

def parse(a: String, b: String) -> Maybe<&2, U32>:
  Chapter7.add_strs(a, b)

def greeting(name: String) -> String:
  Chapter7.greeting(name)

def pow2(n: Nat) -> U32:
  Chapter8.pow2(n)

# A concrete sample of the law's two sides, not a runtime proof.
def law_sample(+n: Nat) -> String:
  Nat.show(Nat.add(n, 0n)) ++ " = " ++ Nat.show(n)

def array(value: U32, index: U32) -> Array<U32> & U32:
  Chapter10.array(value, index)
