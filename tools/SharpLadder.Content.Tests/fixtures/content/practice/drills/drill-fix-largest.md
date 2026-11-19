---
id: drill-fix-largest
chapter: ch-fixture
rung: warm-up
title: Keep the largest of three
type: Keep the best value seen so far
ideas: []
prerequisites: []
prepares: [prob-9001]
variationOf: null
ladders: [ladder-lone-word]
tests:
  file: drill-fix-largest.tests.cs
  version: 1
  count: 3
reference: drill-fix-largest.reference.cs
---

## Statement

Given three whole numbers, return the largest of them.

## Examples

```text {spoken="1, 2 and 8 give 8"}
1, 2, 8 gives 8
```

## Constraints

- Any of the numbers may be below zero.

## Starter

```csharp {#drill-fix-largest-starter starter spoken="The method to fill in"}
using System;

public static class Solution
{
    public static int Largest(int a, int b, int c) =>
        throw new NotImplementedException();
}
```
