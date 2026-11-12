---
id: err-fixture-null
kind: runtime
code: NullReferenceException
wrote: Called a method on a variable that holds nothing
got: Object reference not set to an instance of an object
---

- cause: The variable holds `null`, so there is no object to call the method on.
- hint: Find where the variable was meant to get its object, and what ran instead.
