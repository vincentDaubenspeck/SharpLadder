---
kind: gotchas
chapter: ch-fixture
order: 2
---

## A missing key throws {#gotcha-fix-key}

Reading a key that is not there throws _at run time_.

```csharp {#gotcha-fix-key1 group=fix-key throws=KeyNotFoundException spoken="Reads a missing key"}
var stock = new Dictionary<string, int>();
int n = stock["bolt"];
```

## `out` needs its keyword {#gotcha-fix-out}

```csharp {#gotcha-fix-out1 group=fix-out fail=CS1620 spoken="TryParse without out"}
string text = "42";
int value;
bool ok = int.TryParse(text, value);
```

```text {spoken="The compiler reports the error"}
error CS1620
```
