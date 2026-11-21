---
kind: syntax
chapter: ch-fixture
order: 1
---

## Sum with `foreach` {#syn-fix-sum}

To add up the readings, visit each one in turn with a [*loop*](#term-fixture-loop)
and keep a **running total**.

```csharp {#syn-fix-sum1 group=fix-sum label="Over an array" spoken="Sums it"}
int[] temps = { 18, 25, 31 };
int sum = 0;
foreach (int t in temps)
    sum += t;
```

```csharp {#syn-fix-sum2 group=fix-sum check="sum == 74" spoken='Shows it'}
Console.WriteLine(sum);
```

```text {#syn-fix-out label=Output spoken="Prints seventy-four"}
74
```

1. Start the total at zero.
2. Add each reading on each turn of the [loop](#term-fixture-loop).

Back to [the first sum](ch-fixture#syn-fix-sum1) or [this section](#syn-fix-sum).

## Sizes in a table {#syn-fix-sizes}

Each type takes a fixed number of bytes.

| Type   | Size    |
| ------ | ------- |
| `int`  | 4 bytes |
| `long` |         |

|          | Meaning                      |
| -------- | ---------------------------- |
| a \| b   | *either* one                 |
| repeat   | a [loop](#term-fixture-loop) |

Reading a variable before it has a value gives [an unassigned variable error](#err-fixture-cs0165).

```walk-it {#walk-fix-shift}
title: Shift a value with a [*loop*](#term-fixture-loop)
cells: [4, "ab", null]
sequences:
  - name: safe
    intro: Copy first, as [the sizes](#syn-fix-sizes) allow.
    steps:
      - { dst: 2, src: 1, note: Copy the text to the spare cell. }
      - { dst: 1, value: 7, note: Write over the text., lost: true }
  - name: risky
    intro: Write first.
    steps:
      - { dst: 1, value: 8, note: The text is gone., lost: true }
      - { dst: 0, value: 5, note: Change the first cell. }
  - name: spare
    intro: Copy the spare.
    steps:
      - { dst: 0, src: 2, note: Copy the empty cell. }
```
