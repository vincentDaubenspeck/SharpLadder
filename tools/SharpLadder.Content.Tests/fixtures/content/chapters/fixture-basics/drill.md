---
kind: drill
chapter: ch-fixture
order: 8
---

## Start with the language {#ramp-fix-start rung=foundations}

Each drill here practises one feature of the language, such as a
[loop](#term-fixture-loop), and no algorithm.

1. [Read words until a stop word](#drill-fix-stop-word)

## One idea at a time {#ramp-fix-warm rung=warm-up}

These drills each use one idea from the chapter.

A second paragraph keeps its own place, with `code` in it and a
[set](#term-fixture-set) of words.

1. [Count the letters of a word](#drill-fix-count-letters)
2. [Keep the largest of three](#drill-fix-largest)

## Two ideas together {#ramp-fix-easy rung=easy}

Each drill here joins two ideas.

| Idea  | Joined with |
| ----- | ----------- |
| count | compare     |

```walk-it {#walk-fix-easy}
title: Count one more
cells: [0]
sequences:
  - name: once
    intro: The count starts at zero.
    steps:
      - { dst: 0, value: 1, note: One item is counted. }
```

1. [Pair each name with its score](#drill-fix-pair-scores)
