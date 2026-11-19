---
kind: syntax
chapter: ch-groups-reordered
order: 3
---

## A loop of its own {#syn-loop}

```csharp {#syn-loop-1 group=loop spoken="Counts to three"}
var steps = 0;
while (steps < 3) steps++;
```

## A point {#syn-point}

```csharp {#point-1 group=point check="p.X == 1" spoken="Makes a point"}
using System.Text;
var p = new Point(1, 2);
var text = new StringBuilder().Append(p.X).ToString();
```

```csharp {#point-2 group=point spoken="Declares the point"}
record Point(int X, int Y);
```
