import Base

def greeting(name: String) -> String:
  "Hello, " ++ name ++ "!"

def greet(name: String) -> IO(String):
  do IO<String>:
    return greeting(name)

def add_strs(a: String, b: String) -> Maybe<&2, U32>:
  do Maybe<&2, U32>:
    x : U32 <- U32.read(a)
    y : U32 <- U32.read(b)
    return (x + y : U32)

def main() -> IO(Unit):
  do IO<Unit>:
    text : String <- greet("functional adventurer")
    IO.print(text)
