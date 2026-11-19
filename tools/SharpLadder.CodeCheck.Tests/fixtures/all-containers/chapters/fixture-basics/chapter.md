---
id: ch-fixture
slug: fixture-basics
title: Fixture Basics
order: 1
targets: { csharp: 14, dotnet: 10 }
---

This fixture chapter exercises every rule of the content compiler. It is
*test data*, not teaching material.

- Intro blocks take the reserved `intro` prefix.
- Part files sit beside this file.

```walk-it {#walk-fix-intro}
title: Change one cell
cells: [1]
sequences:
  - name: once
    intro: Write a new value over the old one.
    steps:
      - { dst: 0, value: 2, note: The cell now holds two. }
```

```csharp {#fix-intro-code1 group=fix-intro-code spoken="Sets a starting count"}
var count = 1;
```

## How the parts fit {#fix-parts}

Each part file compiles to its own JSON file, at the same relative path.

```walk-it {#walk-fix-parts}
title: Fill an empty cell
cells: [null]
sequences:
  - name: once
    intro: Start with nothing in the cell.
    steps:
      - { dst: 0, value: 3, note: The cell now holds three. }
```

```csharp {#fix-parts-code1 group=fix-parts-code spoken="Names a part"}
var part = "build";
```

## Links between ids {#fix-links}

A bare link goes to [how the parts fit](#fix-parts), and an explicit one to
[the `note` block](ch-fixture#fix-note). Another chapter is reached as
[its *start*](ch-second#second-start), and link text may hold
[**strong with *em* inside**](#fix-links).

```text {#fix-note spoken="A note to link to"}
note
```

Nested-looking text stays literal: [a [b](#fix-parts)](#fix-links),
[a [b [c](#fix-parts)](#fix-links)](#fix-note),
[*a [b](#fix-parts)*](#fix-links) and [a [b][parts]](#fix-links).

[parts]: #fix-parts
