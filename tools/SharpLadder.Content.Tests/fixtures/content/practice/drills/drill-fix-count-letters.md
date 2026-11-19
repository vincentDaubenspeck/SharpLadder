---
id: drill-fix-count-letters
chapter: ch-fixture
rung: warm-up
title: Count the letters of a word
type: Count with a loop and a test on each character
ideas: [term-fixture-loop]
prerequisites: []
prepares: [prob-9001]
variationOf: null
ladders: [ladder-lone-word, ladder-lone-word-alt]
tests:
  file: drill-fix-count-letters.tests.cs
  version: 1
  count: 3
reference: drill-fix-count-letters.reference.cs
---

## Statement

Given a word, count the characters in it that are letters.

## Examples

```text {spoken="a1 b gives 2"}
a1 b gives 2
```

## Constraints

- The word holds at most 100 characters.

## Starter

```csharp {#drill-fix-count-letters-starter starter spoken="The method to fill in"}
using System;

public static class Solution
{
    public static int CountLetters(string word) =>
        throw new NotImplementedException();
}
```
