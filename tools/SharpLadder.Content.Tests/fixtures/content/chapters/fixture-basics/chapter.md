---
id: ch-fixture
slug: fixture-basics
title: Fixture Basics
order: 1
targets: { csharp: 12, dotnet: 8 }
---

This fixture chapter exercises every rule of the content compiler. It is
*test data*, not teaching material.

- Intro blocks take the reserved `intro` prefix.
- Part files sit beside this file.

## How the parts fit {#fix-parts}

Each part file compiles to its own JSON file, at the same relative path.

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
