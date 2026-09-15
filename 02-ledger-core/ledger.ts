/**
 * Ledger — an in-memory, append-only double-entry ledger core.
 *
 * Amounts are plain bigint minor units; a single currency is assumed for the
 * whole ledger (no Money import — labs share no code). Sign convention:
 * liabilities and revenue are positive, assets are negative, so every
 * balanced transaction's entries sum to exactly 0n.
 *
 * Entries are never updated or deleted. A correction is a reversal
 * transaction (see `reverse`), never an edit to history.
 *
 * Out of scope by design: concurrency/locking and any negative-balance guard.
 * See README for why.
 *
 * No dependencies.
 */

export type AccountType = 'asset' | 'liability' | 'revenue';

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
}

export interface Entry {
  readonly id: string;
  readonly txId: string;
  readonly accountId: string;
  readonly amount: bigint;
  readonly createdAt: Date;
}

export interface Transaction {
  readonly id: string;
  readonly reversesTxId: string | null;
  readonly createdAt: Date;
}

export interface EntryInput {
  readonly txId: string;
  readonly accountId: string;
  readonly amount: bigint;
}

export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly transactions = new Map<string, Transaction>();
  private readonly entriesByTx = new Map<string, readonly Entry[]>();
  private readonly reversedTxIds = new Set<string>();

  /** Invariant: account ids are unique — an entry can only ever reference a registered account. */
  addAccount(account: Account): void {
    if (this.accounts.has(account.id)) {
      throw new RangeError(`account already exists: ${account.id}`);
    }
    this.accounts.set(account.id, Object.freeze({ ...account }));
  }

  /** Invariant: only a registered account can be looked up. */
  getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  /** Invariant: every registered account is enumerable. */
  listAccounts(): readonly Account[] {
    return [...this.accounts.values()];
  }

  /** Invariant: a transaction is 2+ entries across 2+ distinct known accounts, each a nonzero bigint, summing to exactly 0n, under a fresh txId. */
  postTransaction(entries: readonly EntryInput[]): Transaction {
    return this.commit(entries, null);
  }

  /** Invariant: a reversal is a brand-new transaction with every leg negated and linked via reversesTxId; a transaction reverses at most once and a reversal is terminal. */
  reverse(txId: string): Transaction {
    const original = this.transactions.get(txId);
    if (!original) {
      throw new RangeError(`unknown transaction: ${txId}`);
    }
    if (original.reversesTxId !== null) {
      throw new RangeError(`cannot reverse a reversal: ${txId}`);
    }
    if (this.reversedTxIds.has(txId)) {
      throw new RangeError(`transaction already reversed: ${txId}`);
    }

    const originalEntries = this.mustEntries(txId);
    const reversalTxId = `${txId}:reversal`;
    const reversal = this.commit(
      originalEntries.map((entry) => ({
        txId: reversalTxId,
        accountId: entry.accountId,
        amount: -entry.amount,
      })),
      txId,
    );
    this.reversedTxIds.add(txId);
    return reversal;
  }

  /** Invariant: a balance is the signed sum of a known account's entries, derived on every call — never stored. */
  getBalance(accountId: string): bigint {
    if (!this.accounts.has(accountId)) {
      throw new RangeError(`unknown account: ${accountId}`);
    }
    let total = 0n;
    for (const entries of this.entriesByTx.values()) {
      for (const entry of entries) {
        if (entry.accountId === accountId) {
          total += entry.amount;
        }
      }
    }
    return total;
  }

  /** Invariant: the sum of every entry ever posted, across every account, is always exactly 0n. */
  trialBalance(): bigint {
    let total = 0n;
    for (const entries of this.entriesByTx.values()) {
      for (const entry of entries) {
        total += entry.amount;
      }
    }
    return total;
  }

  /** Invariant: transaction metadata is visible only for a txId that was actually posted. */
  getTransaction(txId: string): Transaction | undefined {
    return this.transactions.get(txId);
  }

  /** Invariant: transactions are listed in the order they were posted. */
  listTransactions(): readonly Transaction[] {
    return [...this.transactions.values()];
  }

  /** Invariant: a known transaction's entries are returned, immutable and in append order; an unknown txId throws. */
  getEntries(txId: string): readonly Entry[] {
    return [...this.mustEntries(txId)];
  }

  private mustEntries(txId: string): readonly Entry[] {
    const entries = this.entriesByTx.get(txId);
    if (!entries) {
      throw new RangeError(`unknown transaction: ${txId}`);
    }
    return entries;
  }

  /**
   * Validate structure first (shape, identity, references), then — only once
   * the transaction is well-formed — check that it balances to zero. This
   * ordering matters: e.g. an entry on an unknown account can still sum to
   * 0n, and must be rejected for what it is, not waved through by the sum.
   */
  private commit(entries: readonly EntryInput[], reversesTxId: string | null): Transaction {
    if (entries.length < 2) {
      throw new RangeError('a transaction requires at least 2 entries');
    }

    const txId = entries[0].txId;
    if (entries.some((entry) => entry.txId !== txId)) {
      throw new RangeError('all entries in one postTransaction call must share one txId');
    }
    if (reversesTxId === null && txId.includes(':')) {
      throw new RangeError(
        `txId must not contain ":" — that character is reserved for generated ids (e.g. reversals): ${txId}`,
      );
    }
    if (this.transactions.has(txId)) {
      throw new RangeError(`txId already exists: ${txId}`);
    }

    for (const entry of entries) {
      if (!this.accounts.has(entry.accountId)) {
        throw new RangeError(`unknown account: ${entry.accountId}`);
      }
      if (typeof entry.amount !== 'bigint') {
        throw new TypeError(`entry amount must be a bigint, got ${typeof entry.amount}`);
      }
      if (entry.amount === 0n) {
        throw new RangeError('entry amount must not be zero');
      }
    }

    const distinctAccounts = new Set(entries.map((entry) => entry.accountId));
    if (distinctAccounts.size < 2) {
      throw new RangeError('a transaction must span at least 2 distinct accounts');
    }

    const total = entries.reduce((sum, entry) => sum + entry.amount, 0n);
    if (total !== 0n) {
      throw new RangeError(`entries must sum to 0n, got ${total}`);
    }

    const createdAt = new Date();
    const posted: Entry[] = entries.map((entry, index) =>
      Object.freeze({
        id: `${txId}#${index}`,
        txId,
        accountId: entry.accountId,
        amount: entry.amount,
        createdAt,
      }),
    );
    this.entriesByTx.set(txId, posted);

    const transaction: Transaction = Object.freeze({ id: txId, reversesTxId, createdAt });
    this.transactions.set(txId, transaction);
    return transaction;
  }
}
