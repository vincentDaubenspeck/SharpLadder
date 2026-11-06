# SharpLadder

A C# study site for fundamentals, reference and practice problems, with hints for when you get stuck mid-problem.

## Status

In development; not yet live.

## Stack

React, TypeScript and Vite; ASP.NET Core on .NET 10; Playwright; WebAssembly.

## Local setup

After cloning, enable the repository's git hooks:

```sh
git config core.hooksPath tools/hooks
```

Run the repository checks with `sh tools/check.sh` (or
`powershell -File tools/check.ps1` on Windows).

## Licence

- Code: the original application code and theme CSS are licensed under the
  PolyForm Noncommercial License 1.0.0 (see `LICENSE`). It is source-available,
  not open source: use, modification and redistribution are permitted only for
  the noncommercial purposes the licence lists.
- Brand: the SharpLadder name and the ladder mark are not covered by the code
  licence; no trademark permission is granted.
- Third-party dependencies keep their own licences.

Required notice (see `NOTICE`):

Required Notice: Copyright Vincent Daubenspeck (sharpladder.com)

## Contributing

Issues are welcome. Outside code or content contributions need written terms
first, so pull requests are not accepted yet.

## Security

See `SECURITY.md` for how to report a vulnerability privately.
