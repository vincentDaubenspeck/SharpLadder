---
kind: build
chapter: ch-fixture
order: 3
---

## Nested emphasis {#build-fix-nest}

Spans nest: *outer **middle *inner* middle** outer*.

## Two ways to total {#build-fix-total}

Both ways add the same numbers; pick one to read.

### Add them in a loop {#build-fix-loop approach="a loop"}

Walk the numbers and keep a running total.

```csharp {#build-fix-loop1 group=fix-loop spoken="Adds each number to the total"}
foreach (var n in numbers) total += n;
```

### Ask the library {#build-fix-sum approach="the library"}

- One call does the walk.
- The result is the same.

| Call | Result                         |
| ---- | ------------------------------ |
| Sum  | 74                             |
| Each | one [loop](#term-fixture-loop) |

## Three ways with no lead {#build-fix-three}

### First {#build-fix-first approach="first"}

Only a paragraph, with [a link](#build-fix-nest).

### Second {#build-fix-second approach="second, with a comma"}

```text {#build-fix-second1 spoken="A note for the second way"}
second
```

### Third? {#build-fix-third approach="third"}

The last one.
