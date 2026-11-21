---
kind: cards
chapter: ch-fixture
order: 6
---

## Cards with every field {#cards-fix-all}

### Tally words by key {#card-fix-tally}

- reach: A `Dictionary<string, int>` read with `GetValueOrDefault`.
- build:

  ```csharp {#tally-fix-code1 group=fix-tally spoken="Adds one to the count of a word"}
  counts[word] = counts.GetValueOrDefault(word) + 1;
  ```

- why: An array needs every key known *before* the first count.

  - The keys arrive in any order.
  - A missing key reads as zero.

  ```csharp {#tally-fix-why1 group=fix-tally-why spoken="Reads a missing key as zero"}
  var none = new Dictionary<string, int>().GetValueOrDefault("none");
  ```

  | Word                     | Count |
  | ------------------------ | ----- |
  | [set](#term-fixture-set) | 2     |

- traps:
  - Reading a missing key with the indexer throws.
  - A key differs by case unless a comparer says otherwise.
- also:
  - Counting characters works the same way.

### Is the note kept? {#card-fix-note}

- reach: A plain **note** beside the code.
- build:

  ```text {#note-fix-text1 spoken="One line of plain text"}
  kept: yes
  ```

- why: The note is read back later; compare [the first card](#card-fix-tally).
- traps:
  - A note without an id cannot be linked.
- also:
  - A note may carry a label.
  - A note may stand alone.

## Cards with the required fields {#cards-fix-plain}

### Keep it short {#card-fix-short}

- reach: One sentence.
- build: One more sentence, written on the label line.
- why: Nothing else is needed here.

  ```walk-it {#walk-fix-short}
  title: Raise one number
  cells: [5]
  sequences:
    - name: once
      intro: One cell holds a number.
      steps:
        - { dst: 0, value: 6, note: The number goes up by one. }
  ```
