---
kind: build
chapter: ch-groups-reordered
order: 2
---

## Two ways to total {#build-total}

Both ways add the same numbers.

```csharp {#lead-1 group=lead spoken="Lists the numbers"}
var numbers = new[] { 3, 4 };
```

### A broken way {#way-broken approach="first of all"}

```csharp {#broken-1 group=broken spoken="Leaves out its value"}
var missing = ;
```

### Ask the library {#way-sum approach="one call"}

```csharp {#sum-1 group=sum check="total == 7" spoken="Sums in one call"}
var total = new[] { 3, 4 }.Sum();
```

```csharp {#sum-2 group=sum-lead spoken="Doubles the numbers of the lead"}
var doubled = numbers.Select(n => n * 2).ToList();
```

### Add them in a loop {#way-loop approach="by hand"}

```csharp {#loop-1 group=loop spoken="Starts the total"}
var total = 0;
```

```csharp {#loop-2 group=loop-note spoken="Prints a note"}
Console.WriteLine("between");
```

```csharp {#loop-3 group=loop check="total == 7" spoken="Adds each number"}
foreach (var n in new[] { 3, 4 }) total += n;
```
