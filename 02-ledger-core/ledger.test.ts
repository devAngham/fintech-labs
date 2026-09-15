import { describe, it, expect } from 'vitest';
import { Ledger, type Entry } from './ledger';

/**
 * Behavioural spec for the double-entry ledger core.
 *
 * Model: an Account is { id, name, type: 'asset' | 'liability' | 'revenue' }.
 * An Entry is { id, txId, accountId, amount: bigint, createdAt }. A transaction
 * is the set of entries sharing a txId. Entries are append-only: a mistake is
 * corrected by a reversal transaction, never by editing history.
 *
 * Amounts are plain bigint minor units. A single currency is assumed for the
 * whole ledger. Sign convention: liabilities and revenue positive, assets
 * negative, so every balanced transaction sums to 0n.
 *
 * Out of scope (see README): concurrency, locking, negative-balance guards.
 *
 * There is no aggregate "all entries" accessor on Ledger by design — it would
 * invite callers to bypass the account/transaction API. Tests reconstruct the
 * total from the public surface (listTransactions + getEntries) when needed.
 *
 * Every test names the one invariant it protects.
 */

const sum = (entries: readonly Entry[]): bigint => entries.reduce((acc, e) => acc + e.amount, 0n);

/** Test-only aggregate, built from the public surface — not a Ledger method. */
function totalEntryCount(ledger: Ledger): number {
  return ledger.listTransactions().reduce((n, tx) => n + ledger.getEntries(tx.id).length, 0);
}

function freshLedger(): Ledger {
  const ledger = new Ledger();
  ledger.addAccount({ id: 'cash', name: 'Cash at bank', type: 'asset' });
  ledger.addAccount({ id: 'walletA', name: 'Customer A wallet', type: 'liability' });
  ledger.addAccount({ id: 'walletB', name: 'Customer B wallet', type: 'liability' });
  ledger.addAccount({ id: 'fees', name: 'Fee revenue', type: 'revenue' });
  return ledger;
}

/** One transaction leg: { txId, accountId, amount }. */
const leg = (txId: string, accountId: string, amount: bigint) => ({ txId, accountId, amount });

describe('account registration', () => {
  // Invariant: an account must be registered before entries can reference it.
  it('registers an account and reads it back', () => {
    const ledger = new Ledger();
    ledger.addAccount({ id: 'cash', name: 'Cash at bank', type: 'asset' });
    expect(ledger.getAccount('cash')).toEqual({ id: 'cash', name: 'Cash at bank', type: 'asset' });
  });

  // Invariant: account ids are unique.
  it('rejects a duplicate account id', () => {
    const ledger = new Ledger();
    ledger.addAccount({ id: 'cash', name: 'Cash at bank', type: 'asset' });
    expect(() => ledger.addAccount({ id: 'cash', name: 'Another', type: 'liability' })).toThrow();
  });

  // Invariant: every registered account is enumerable.
  it('lists all registered accounts', () => {
    const ledger = freshLedger();
    expect(ledger.listAccounts().map((a) => a.id).sort()).toEqual(['cash', 'fees', 'walletA', 'walletB']);
  });
});

describe('postTransaction — validation', () => {
  // Invariant: a balanced 2-leg transaction posts and both balances move.
  it('accepts a balanced 2-leg transaction', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    expect(ledger.getBalance('cash')).toBe(-100n);
    expect(ledger.getBalance('walletA')).toBe(100n);
  });

  // Invariant: posting returns a Transaction identified by its txId, not a reversal.
  it('returns a Transaction with id = txId and reversesTxId = null', () => {
    const ledger = freshLedger();
    const tx = ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    expect(tx.id).toBe('t1');
    expect(tx.reversesTxId).toBeNull();
  });

  // Invariant: a transaction needs at least two legs.
  it('rejects fewer than 2 entries', () => {
    const ledger = freshLedger();
    expect(() => ledger.postTransaction([leg('t1', 'cash', -100n)])).toThrow();
  });

  // Invariant: an empty entry set is not a transaction.
  it('rejects an empty entries array', () => {
    const ledger = freshLedger();
    expect(() => ledger.postTransaction([])).toThrow();
  });

  // Invariant: every transaction's entries sum to exactly 0n.
  it('rejects entries that do not sum to zero', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 99n)]),
    ).toThrow();
  });

  // Invariant: an entry carries a real movement of value.
  it('rejects a zero-amount entry', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.postTransaction([
        leg('t1', 'cash', -100n),
        leg('t1', 'walletA', 100n),
        leg('t1', 'walletB', 0n),
      ]),
    ).toThrow();
  });

  // Invariant: amounts are bigint minor units — number is not accepted.
  it('rejects a non-bigint amount', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.postTransaction([
        leg('t1', 'cash', -100n),
        { txId: 't1', accountId: 'walletA', amount: 100 as unknown as bigint },
      ]),
    ).toThrow();
  });

  // Invariant: entries reference registered accounts only.
  it('rejects an unknown accountId', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'ghost', 100n)]),
    ).toThrow();
  });

  // Invariant: txIds are unique; re-posting a txId is an error, not a retry.
  it('rejects a txId that already exists', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    expect(() =>
      ledger.postTransaction([leg('t1', 'cash', -1n), leg('t1', 'walletA', 1n)]),
    ).toThrow();
  });

  // Invariant: a transaction moves value between accounts, so at least two distinct accounts appear.
  it('rejects when every entry is on the same account', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.postTransaction([leg('t1', 'walletA', 5n), leg('t1', 'walletA', -5n)]),
    ).toThrow();
  });

  // Invariant: one postTransaction call is exactly one transaction.
  it('rejects entries that carry different txIds in one call', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.postTransaction([leg('t1', 'cash', -100n), leg('t2', 'walletA', 100n)]),
    ).toThrow();
  });

  // Invariant: ':' is reserved for generated ids (e.g. reversals) — a user-supplied txId can never collide with one.
  it('rejects a user-supplied txId containing the reserved ":" delimiter', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.postTransaction([leg('t1:reversal', 'cash', -100n), leg('t1:reversal', 'walletA', 100n)]),
    ).toThrow();
  });

  // Invariant: a repeated account is fine as long as 2+ distinct accounts are involved.
  it('accepts repeated accounts when the transaction still spans multiple accounts', () => {
    const ledger = freshLedger();
    ledger.postTransaction([
      leg('t1', 'walletA', -10n),
      leg('t1', 'walletA', -20n),
      leg('t1', 'walletB', 30n),
    ]);
    expect(ledger.getBalance('walletA')).toBe(-30n);
    expect(ledger.getBalance('walletB')).toBe(30n);
  });
});

describe('postTransaction — multi-leg', () => {
  // Invariant: a transaction may have any number of legs >= 2 provided they sum to 0n.
  it('posts a 3-leg transfer-plus-fee that sums to zero', () => {
    const ledger = freshLedger();
    const entries = [
      leg('t1', 'walletA', -32n), // A pays 30 + 2 fee
      leg('t1', 'walletB', 30n), // B receives 30
      leg('t1', 'fees', 2n), // platform earns 2
    ];
    expect(sum(entries)).toBe(0n);
    ledger.postTransaction(entries);
    expect(ledger.getBalance('walletA')).toBe(-32n);
    expect(ledger.getBalance('walletB')).toBe(30n);
    expect(ledger.getBalance('fees')).toBe(2n);
  });
});

describe('getBalance', () => {
  // Invariant: a balance is the signed sum of the account's entries, derived on read — never stored.
  it('derives balance as the signed sum of entries', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    ledger.postTransaction([leg('t2', 'walletA', -30n), leg('t2', 'walletB', 30n)]);
    expect(ledger.getBalance('walletA')).toBe(70n);
  });

  // Invariant: an account with no entries has balance 0n — absence is not an error.
  it('returns 0n for a registered account with no entries', () => {
    expect(freshLedger().getBalance('walletB')).toBe(0n);
  });

  // Invariant: only registered accounts can be queried.
  it('throws on an unknown account', () => {
    expect(() => freshLedger().getBalance('ghost')).toThrow();
  });

  // Invariant: sign convention — asset negative, liability and revenue positive.
  it('follows the sign convention', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    ledger.postTransaction([leg('t2', 'walletA', -2n), leg('t2', 'fees', 2n)]);
    expect(ledger.getBalance('cash')).toBe(-100n); // a real +100 asset, recorded negative
    expect(ledger.getBalance('walletA')).toBe(98n);
    expect(ledger.getBalance('fees')).toBe(2n);
  });

  // Invariant: balances are exact past Number.MAX_SAFE_INTEGER — bigint, no float rounding.
  it('sums amounts beyond Number.MAX_SAFE_INTEGER exactly', () => {
    const ledger = freshLedger();
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    ledger.postTransaction([leg('b1', 'walletA', big), leg('b1', 'cash', -big)]);
    ledger.postTransaction([leg('b2', 'walletA', 1n), leg('b2', 'walletB', -1n)]);
    expect(ledger.getBalance('walletA')).toBe(9_007_199_254_740_994n);
    expect(ledger.getBalance('cash')).toBe(-big);
  });
});

describe('rationale — why amounts are bigint', () => {
  // Invariant: two genuinely distinct amounts can collide under Number; bigint is the reason the ledger tells them apart.
  it('shows Number() colliding two distinct amounts that bigint keeps apart', () => {
    const a = 9_007_199_254_740_992n; // 2^53 — exactly representable as a double
    const b = 9_007_199_254_740_993n; // 2^53 + 1 — not representable; rounds to 2^53
    expect(a).not.toBe(b);
    expect(Number(a)).toBe(2 ** 53);
    expect(Number(b)).toBe(2 ** 53); // collides with Number(a) despite b !== a
  });
});

describe('trialBalance', () => {
  // Invariant: an empty ledger is balanced.
  it('is 0n for an empty ledger', () => {
    expect(new Ledger().trialBalance()).toBe(0n);
  });

  // Invariant: the ledger is globally balanced after any number of transactions.
  it('stays 0n across many transactions', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    ledger.postTransaction([leg('t2', 'walletA', -30n), leg('t2', 'walletB', 30n)]);
    ledger.postTransaction([leg('t3', 'walletA', -2n), leg('t3', 'fees', 2n)]);
    expect(ledger.trialBalance()).toBe(0n);
  });

  // Invariant: each transaction balances on its own — a zero global sum must not hide two offsetting bugs.
  it('holds per transaction, not only globally', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    ledger.postTransaction([leg('t2', 'walletA', -30n), leg('t2', 'walletB', 30n)]);
    ledger.reverse('t1');
    for (const tx of ledger.listTransactions()) {
      expect(sum(ledger.getEntries(tx.id)), tx.id).toBe(0n);
    }
    expect(ledger.trialBalance()).toBe(0n);
  });

  // Invariant: a reversal keeps the ledger balanced.
  it('is still 0n after a reversal', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    ledger.reverse('t1');
    expect(ledger.trialBalance()).toBe(0n);
  });
});

describe('reverse', () => {
  // Invariant: a reversal is a new append-only transaction; the original txId is untouched.
  it('creates a new transaction and leaves the original in place', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    const rev = ledger.reverse('t1');
    expect(rev.id).not.toBe('t1');
    expect(ledger.getTransaction('t1')).toBeDefined();
    expect(ledger.getTransaction(rev.id)).toBeDefined();
  });

  // Invariant: the reversal negates every leg of the original, same accounts, same leg count.
  it('negates every amount of the original transaction', () => {
    const ledger = freshLedger();
    ledger.postTransaction([
      leg('t1', 'walletA', -32n),
      leg('t1', 'walletB', 30n),
      leg('t1', 'fees', 2n),
    ]);
    const original = ledger.getEntries('t1');
    const rev = ledger.reverse('t1');
    const reversed = ledger.getEntries(rev.id);
    expect(reversed.map((e) => [e.accountId, e.amount])).toEqual(
      original.map((e) => [e.accountId, -e.amount]),
    );
  });

  // Invariant: reversal provenance is recorded via reversesTxId.
  it('links the reversal to the original', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    const rev = ledger.reverse('t1');
    expect(rev.reversesTxId).toBe('t1');
  });

  // Invariant: original + reversal net to zero on every affected account.
  it('restores every affected balance to its pre-transaction value', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t0', 'cash', -100n), leg('t0', 'walletA', 100n)]); // pre-existing state
    ledger.postTransaction([
      leg('t1', 'walletA', -32n),
      leg('t1', 'walletB', 30n),
      leg('t1', 'fees', 2n),
    ]);
    ledger.reverse('t1');
    expect(ledger.getBalance('walletA')).toBe(100n);
    expect(ledger.getBalance('walletB')).toBe(0n);
    expect(ledger.getBalance('fees')).toBe(0n);
  });

  // Invariant: a transaction is reversed at most once.
  it('throws when reversing the same txId twice', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    ledger.reverse('t1');
    expect(() => ledger.reverse('t1')).toThrow();
  });

  // Invariant: reversals are terminal — a reversal cannot itself be reversed.
  it('throws when reversing a reversal', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    const rev = ledger.reverse('t1');
    expect(() => ledger.reverse(rev.id)).toThrow();
  });

  // Invariant: only a real transaction can be reversed.
  it('throws when reversing an unknown txId', () => {
    expect(() => freshLedger().reverse('nope')).toThrow();
  });

  // Invariant: a reversal appends new entries; it never deletes or rewrites the original's entries.
  // (An implementation that deletes the original and writes fresh legs could still show correct
  // balances and a zero trial balance — this is the test that specifically catches that.)
  it('preserves the original entries and grows total entry count by exactly the reversal size', () => {
    const ledger = freshLedger();
    ledger.postTransaction([
      leg('t1', 'walletA', -32n),
      leg('t1', 'walletB', 30n),
      leg('t1', 'fees', 2n),
    ]);
    const originalEntries = ledger.getEntries('t1');
    const countBefore = totalEntryCount(ledger);
    const rev = ledger.reverse('t1');
    expect(ledger.getEntries('t1')).toEqual(originalEntries);
    expect(totalEntryCount(ledger)).toBe(countBefore + ledger.getEntries(rev.id).length);
  });

  // Invariant: leg count is preserved — a 3-leg transaction reverses to 3 legs.
  it('reverses a 3-leg transaction to a 3-leg transaction', () => {
    const ledger = freshLedger();
    ledger.postTransaction([
      leg('t1', 'walletA', -32n),
      leg('t1', 'walletB', 30n),
      leg('t1', 'fees', 2n),
    ]);
    const rev = ledger.reverse('t1');
    expect(ledger.getEntries(rev.id)).toHaveLength(3);
  });
});

describe('append-only guarantees', () => {
  // Invariant: only a real transaction's entries can be queried — consistent with getBalance's unknown-account behavior.
  it('getEntries throws on an unknown txId', () => {
    expect(() => freshLedger().getEntries('nope')).toThrow();
  });

  // Invariant: a transaction's entries are readable in the order they were appended.
  it("returns a transaction's entries in append order", () => {
    const ledger = freshLedger();
    ledger.postTransaction([
      leg('t1', 'walletA', -32n),
      leg('t1', 'walletB', 30n),
      leg('t1', 'fees', 2n),
    ]);
    expect(ledger.getEntries('t1').map((e) => e.accountId)).toEqual(['walletA', 'walletB', 'fees']);
  });

  // Invariant: transactions are listed in the order they were posted.
  it('lists transactions in post order', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    ledger.postTransaction([leg('t2', 'walletA', -30n), leg('t2', 'walletB', 30n)]);
    expect(ledger.listTransactions().map((tx) => tx.id)).toEqual(['t1', 't2']);
  });

  // Invariant: the entry store is encapsulated — mutating returned data cannot change ledger state.
  it('is not mutable through returned data', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    const entries = ledger.getEntries('t1');
    entries.push({} as Entry);
    expect(ledger.getEntries('t1')).toHaveLength(2);
    expect(Object.isFrozen(ledger.getEntries('t1')[0])).toBe(true);
    expect(() => {
      (ledger.getEntries('t1')[0] as { amount: bigint }).amount = 0n;
    }).toThrow();
  });

  // Invariant: an entry exposes { id, txId, accountId, amount, createdAt }.
  it('exposes the entry shape', () => {
    const ledger = freshLedger();
    ledger.postTransaction([leg('t1', 'cash', -100n), leg('t1', 'walletA', 100n)]);
    const [entry] = ledger.getEntries('t1');
    expect(typeof entry.id).toBe('string');
    expect(entry.txId).toBe('t1');
    expect(entry.accountId).toBe('cash');
    expect(entry.amount).toBe(-100n);
    expect(entry.createdAt).toBeInstanceOf(Date);
  });
});
