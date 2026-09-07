<!--
Thanks for the pull request. Delete any section that doesn't apply.
-->

## What this changes

<!-- One or two sentences. Link the issue it closes, if there is one. -->

Closes #

## Why

<!-- What breaks without it, or what it makes possible. -->

## How it was verified

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] A test fails without this change <!-- if it's a fix -->
- [ ] Tried in a real extension via `npm run demo:sync` <!-- if it touches runtime behaviour -->

## Checks that need a deliberate answer

- [ ] **No new runtime dependencies** (this ships into other people's extensions)
- [ ] **No change to the wire format** in `src/types.ts` — or if there is, it's
      purely additive and noted in `CHANGELOG.md`
- [ ] **No additional data leaves the browser by default** — or if it does,
      it's behind an opt-in option
- [ ] **No `__crxtrace_*` storage key renamed** without a migration
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`

## Anything you're unsure about

<!-- Genuinely useful. Say so rather than guessing. -->
