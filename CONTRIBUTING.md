# Contributing

Thanks for taking the time. This package is small on purpose, and the bar for adding to it is
the same one it was built with.

## Getting set up

```bash
make init
make test
```

Node 22 or newer. Tests run straight over the TypeScript sources with `node --test`.

## Before you open a pull request

```bash
make verify-format
make typecheck
make test
```

`make typecheck` is not only a type check: `tests/types.test.ts` states the type-level
contract with `@ts-expect-error`, so a change that quietly loosens the types fails there.

## What a good change looks like

- **A test that would fail without it.** Especially for anything touching the grammar, the
  merge law, or what gets dropped.
- **A reason in the code.** Exported symbols carry a JSDoc block saying why the thing is the
  way it is; a comment that repeats the signature is noise.
- **One spelling.** If a new helper produces a shape the engine does not already read, it
  does not belong here.
- **No dependencies.** The core runs in a browser, in React Native and in Node, and it stays
  that way by having nothing to install.

## Versions

Versions are set by the release pipeline, never by hand in a pull request.

## Reporting a problem

Open an issue with the criteria that misbehaves — `pack()` of it is enough — what you
expected, and what came back.
