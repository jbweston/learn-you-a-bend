import Base

def adder(k: U32) -> U32 -> U32:
  x => (x + k : U32)

def twice(~f: U32 -> U32, x: U32) -> U32:
  f(f(x))

def main() -> U32:
  add2 = adder(2)
  twice(~(x => (x + 1 : U32)), add2(40))
