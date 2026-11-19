---
kind: build
chapter: ch-mixed-owner
order: 2
---

## Two owners {#build-mixed}

The lead comes first.

```csharp {#mix-lead group=outside-first spoken="Sets a value"}
var a = 1;
```

### One way {#way-one approach="one"}

```csharp {#mix-one group=outside-first spoken="Uses the value"}
var b = a + 1;
```

```csharp {#mix-two group=approach-first spoken="Sets another value"}
var c = 3;
```

### Another way {#way-other approach="another"}

Only a paragraph.

## After the ways {#build-after}

```csharp {#mix-after group=approach-first spoken="Comes after the ways"}
var d = 4;
```
