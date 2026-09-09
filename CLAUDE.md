# fintech-labs

Focused reference implementations of core fintech primitives.
Each folder isolates one concept with its own tests.
Modules are independent by design — no shared code, no monorepo tooling.

## Domain rules
- Money is always bigint in minor units. Never float, never number.
- Currency decimals vary: JPY=0, ILS/USD/EUR=2, JOD/KWD/BHD=3. Never assume 100.
- Rounding is never silent. It must be requested explicitly and its mode named.
- Excess precision is an error, not something to round away.
- No `divide` on Money — `allocate` replaces it. Parts always sum back to the whole.
- Ledger entries are immutable. Corrections are reversal rows, not updates.
- Every transaction's entries must sum to zero.

## Contribution style
- Tests are written first, in a step separate from implementation.
- After each step, explain which invariant the code protects and what breaks
  without it — not what the code does.
- Don't rewrite approved code. Identify the line and explain the issue.
- On review, report: incorrect invariants, missing cases, uncovered edges.

## Review discipline
- A green test suite proves the code matches the tests, not that the tests
  match the intent. Report gaps between the two.
- A test that passes under two different algorithms isn't testing the algorithm.

## Working agreement
- Discuss domain trade-offs before proposing an implementation.
- Stop for approval between steps.
- If an assumption turns out false, stop and report. Don't substitute
  a different action for the one requested.
- Never create a file or folder at a path I named but that doesn't exist.
  Stop and ask which existing path I meant.
- Never run: git push, git reset --hard, git rebase, force-push.
  Show me the command instead.

## Stack
TypeScript, Vitest. No framework in `01-money-type` or `02-ledger-core`.