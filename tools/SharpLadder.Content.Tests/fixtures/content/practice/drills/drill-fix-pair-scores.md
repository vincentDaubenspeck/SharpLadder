---
id: drill-fix-pair-scores
chapter: ch-fixture
rung: easy
title: Pair each name with its score
type: Walk two lists side by side
ideas: [term-fixture-set]
prerequisites: [drill-fix-largest]
prepares: [prob-9001]
variationOf: null
ladders: [ladder-lone-word]
tests:
  file: drill-fix-pair-scores.tests.cs
  version: 1
  count: 3
reference: drill-fix-pair-scores.reference.cs
---

## Statement

Given a list of names and a list of scores, pair the name at each place
with the score at the same place.

## Examples

```text {spoken="ann and bo with 3 and 5 give ann 3, bo 5"}
[ann, bo], [3, 5] gives ann 3, bo 5
```

## Constraints

- When one list is longer, its extra items stay unpaired.

## Starter

```csharp {#drill-fix-pair-scores-starter starter spoken="The method to fill in"}
using System;
using System.Collections.Generic;

public static class Solution
{
    public static Dictionary<string, int> Pair(string[] names, int[] scores) =>
        throw new NotImplementedException();
}
```
