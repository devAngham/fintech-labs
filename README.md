# fintech-labs

Standalone TypeScript labs, each implementing one fintech concept. Labs are
independent — no shared code, no monorepo tooling. Each folder stands on its own.

## Labs

| Folder | Concept | Status |
| --- | --- | --- |
| [01-money-type](./01-money-type) | Money as a value type — integer minor units, currency safety, rounding | Done |
| [ledger-core](./ledger-core) | Double-entry ledger — accounts, postings, balanced transactions | Planned |
| [idempotency](./idempotency) | Idempotency keys — safe retries for at-most-once side effects | Planned |
| [concurrency](./concurrency) | Concurrency control — locking, serialization, race-free balance updates | Planned |
| [transaction-states](./transaction-states) | Transaction lifecycle — state machine for authorize / capture / settle / refund | Planned |
| [reconciliation](./reconciliation) | Reconciliation — matching internal ledger against external statements | Planned |

## Status legend

- **Planned** — folder scaffolded, not yet implemented
- **In progress** — implementation started
- **Done** — implemented with tests

## Running a lab

Each lab is self-contained and carries its own dependencies. Requires Node 20+.

```
cd 01-money-type
npm install
npm test
```

## License

MIT — see [LICENSE](./LICENSE).
