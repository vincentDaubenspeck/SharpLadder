---
id: err-fixture-off-by-one
kind: wrong-output
code:
wrote: Counted the items of a list with a loop
got: A count that is one too small
see: [err-fixture-cs0165]
---

- cause: The loop stops one step early.

  1. Check where the loop starts.
  2. Check the comparison that ends it.
- hint: Walk the loop by hand for a list of one item. Compare with
  [the compiler entry](#err-fixture-cs0165).
