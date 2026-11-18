---
id: err-fixture-cs0165
kind: compiler
code: CS0165
wrote: Read a local variable before giving it a value
got: "Use of unassigned local variable 'total'"
see: [syn-fix-sum, term-fixture-set]
---

- cause: The compiler cannot find a value for `total` on **every** path to the read.
- hint:

  Give the variable a starting value where you declare it.

  ```text {#fix-shape label=Shape spoken="A declaration with a starting value"}
  type name = start;
  ```

  ```walk-it {#walk-fix-shape}
  title: Give a starting value
  cells: [null]
  sequences:
    - name: once
      intro: The variable has no value yet.
      steps:
        - { dst: 0, value: 0, note: It starts at zero. }
  ```
