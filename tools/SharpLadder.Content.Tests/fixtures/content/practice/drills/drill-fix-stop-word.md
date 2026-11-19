---
id: drill-fix-stop-word
chapter: ch-fixture
rung: foundations
title: Read words until a stop word
type: Repeat while a condition holds
ideas: [term-fixture-loop]
prerequisites: []
prepares: []
variationOf: null
ladders: [ladder-lone-word]
tests:
  file: drill-fix-stop-word.tests.cs
  version: 1
  count: 3
reference: drill-fix-stop-word.reference.cs
---

## Statement

Given a list of words and a stop word, use a
[loop](#term-fixture-loop) to count the words that come before the stop word.

## Examples

```text {spoken="red, blue, stop and green give 2"}
[red, blue, stop, green] gives 2
```

## Constraints

- Without the stop word, every word counts.

## Starter

```csharp {#drill-fix-stop-word-starter starter spoken="The method to fill in"}
using System;

public static class Solution
{
    public static int WordsBeforeStop(string[] words, string stop) =>
        throw new NotImplementedException();
}
```
