---
kind: hints
chapter: ch-fixture
order: 7
---

## Count every word first {#ladder-lone-word}

cue: You want the first word of a sentence that no other word repeats.
pattern: pat-fixture-two-pass
approach: tally first

1. {#r1} What must you know about a word before you can call it lone?
2. {#r2} Could one pass gather that, so a *second* pass can use it?
3. {#r3} A `Dictionary<string, int>` holds the counts; read the words **in order**.

## Track what came back {#ladder-lone-word-alt}

cue: You want the earliest word in a sentence that appears just once.
pattern: pat-fixture-seen-set
approach: seen set

1. {#r1} As you read, which words have you met more than once?
2. {#r2} Two sets can hold "met once" and "met again".
