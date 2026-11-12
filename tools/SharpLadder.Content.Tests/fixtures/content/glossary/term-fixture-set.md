---
id: term-fixture-set
term: HashSet<T>
short: A collection of unique values with fast "is it here?" checks.
see: [term-fixture-loop, card-fix-tally, syn-fix-sum, err-fixture-cs0165, ch-fixture]
---

A set keeps each value *once*. Adding a value it already holds changes nothing.

- `Add` returns `false` for a value the set already holds.
- `Contains` answers without a scan.

```csharp {#fix-set1 group=term-fixture-set spoken="Adds seven twice and keeps one"}
var seen = new HashSet<int>();
seen.Add(7);
seen.Add(7);
```

| Call       | Result  |
| ---------- | ------- |
| first Add  | `true`  |
| second Add | `false` |

A missing value is one cause of [a wrong count](#err-fixture-off-by-one).
