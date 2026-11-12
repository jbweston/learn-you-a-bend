import Base

def array(value: U32, index: U32) -> Array<U32> & U32:
  a = [0 : U32*8n]
  a[5] <- value
  a[index]

def main() -> Array<U32> & U32:
  array(42, 5)
