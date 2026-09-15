# Ledger core

An in-memory, append-only double-entry ledger. Amounts are plain `bigint`
minor units; a single currency is assumed for the whole ledger. No
dependencies.

## The problem

A ledger has to answer two questions honestly, forever: what is this account
worth, and can I prove the books balance. Both get harder, not easier, once
mistakes need correcting — a correction that edits history is indistinguishable,
after the fact, from an unexplained discrepancy.

## The naive approach and why it fails

The obvious shortcut is a stored balance: an `amount` field on each account,
updated in place — `account.balance += amount` — on every movement. Reads are
O(1) and it feels like a real system.

It fails for reasons that don't show up until something goes wrong:

- The stored number and the history it supposedly summarizes can diverge — a
  missed update, a partial failure, a manual fix in production — and now the
  balance is a claim with nothing behind it to check it against.
- There is no way to prove the ledger is internally consistent. A `trialBalance`
  invariant doesn't exist for a stored balance; you would have to replay every
  movement to verify it, at which point the cached number bought nothing.
- Correcting a mistake means mutating the stored balance and, in most systems
  built this way, editing or deleting the offending row. That destroys the one
  thing an auditor actually needs: what happened, in what order, and how it was
  corrected — not a number with the evidence removed.

## The design

Entries are the only source of truth, and they are append-only. `getBalance`
and `trialBalance` are pure functions over the entry set, recomputed on every
call — nothing is cached, so nothing can drift from the entries that define it.

A correction is `reverse(txId)`: a new transaction whose legs are the original's
legs negated, linked back via `reversesTxId`. The original is never edited or
removed.

Every transaction is validated as a whole before any of it commits: at least
two entries, all sharing one txId, every account known, every leg a nonzero
bigint, at least two distinct accounts, and the legs summing to exactly `0n`.
Structural checks run before the sum check, deliberately — an entry on an
unknown account, or a transaction touching only one account, can still sum to
zero and must be rejected for what it is, not waved through by the sum.

User-supplied txIds may not contain `:`; that character is reserved for
generated ids (a reversal's txId is `<original>:reversal`), so a caller's own
id can never collide with one the ledger generates.

## Worked example

Customer A tops up $100, transfers $30 to customer B, and pays a $2 fee on
that transfer. Accounts: `cash` (asset), `walletA` / `walletB` (liability),
`fees` (revenue). Sign convention: liabilities and revenue are positive,
assets are negative, so the accounting identity reads
`-cash + walletA + walletB + fees = 0`.

```
T1 top-up      cash -100   walletA +100
T2 transfer    walletA -30 walletB +30
T3 fee         walletA -2  fees +2
```

Resulting balances: `cash -100`, `walletA 68` (100 − 30 − 2), `walletB 30`,
`fees 2`. `trialBalance()` = `-100 + 68 + 30 + 2 = 0n`.

Reversing T3 posts a new transaction `walletA +2, fees -2`; `walletA` returns to
`70`, `fees` to `0`, and the ledger is still exactly balanced.

## Deliberate exclusions

- **Concurrency and locking.** None. Two callers posting against the same
  account can race; this lab treats posting as effectively single-threaded.
  Serializing writes is lab 04's concern, not this one's.
- **Negative-balance guards.** None. `postTransaction` will post a transfer
  that drives a liability balance below zero without complaint. Whether that's
  allowed is a policy decision layered on top of the ledger — an overdraft
  rule, a credit limit — not something the ledger primitive should decide, and
  belongs to whatever succeeds this lab.

## Two bounded decisions

**Requiring two or more distinct accounts.** A transaction touching a single
account isn't a movement of value between anything — even when the legs happen
to cancel (`-5` and `+5` on the same account), it represents no external event.
Rejecting it early also closes off a class of bugs that could otherwise hide
behind a same-account, zero-sum transaction.

**Reversals are terminal.** A reversal cannot itself be reversed. "Reversing a
reversal" is ambiguous about what it would even mean, and the operation anyone
actually wants — restore the original state — already has a name:
`postTransaction` with a fresh txId, posting the original legs again. Keeping
reversal single-shot keeps every `reversesTxId` chain exactly one hop long and
trivial to audit; multi-hop reversal chains are a feature nobody asked for and
a bug surface nobody needs.

## Tests

```
npm install
npm test
```
