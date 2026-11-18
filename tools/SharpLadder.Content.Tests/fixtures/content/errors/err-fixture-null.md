---
id: err-fixture-null
kind: runtime
code: NullReferenceException
wrote: Called a method on a variable that holds nothing
got: Object reference not set to an instance of an object
---

- cause: The variable holds `null`, so there is no object to call the method on.

  ```walk-it {#walk-fix-null}
  title: Lose the object
  cells: ["box"]
  sequences:
    - name: once
      intro: The variable holds an object.
      steps:
        - { dst: 0, value: "none", note: Now it holds nothing to call. }
  ```

- hint: Find where the variable was meant to get its object, and what ran instead.
