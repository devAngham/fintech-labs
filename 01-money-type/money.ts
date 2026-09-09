/**
 * Money — an immutable value object for exact monetary arithmetic.
 *
 * The amount is a bigint count of minor units (cents, fils, ...). Its scale is
 * the currency's ISO-4217 exponent (below). `number` is never used for an amount
 * anywhere in this file; it appears only as `allocate` ratios, which are integer
 * weights, not money.
 *
 * Construct only through `Money.of`. The constructor is guarded at runtime, so
 * `new Money(...)` throws even when the type system is bypassed.
 *
 * No dependencies.
 */

export type RoundingMode = 'throw' | 'halfEven' | 'down';

const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  JPY: 0,
  ILS: 2,
  USD: 2,
  EUR: 2,
  JOD: 3,
  KWD: 3,
  BHD: 3,
};

/** Decimal-literal grammar shared by amounts and by multiply() factors. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Module-private token: only code that holds it may call the constructor. */
const CONSTRUCTOR_KEY = Symbol('Money.constructor');

export class Money {
  readonly amount: bigint;
  readonly currency: string;

  /** Invariant: unreachable except via Money.of — a direct `new` throws at runtime. */
  private constructor(key: symbol, amount: bigint, currency: string) {
    if (key !== CONSTRUCTOR_KEY) {
      throw new TypeError('Money is not constructable directly; use Money.of()');
    }
    this.amount = amount;
    this.currency = currency;
    Object.freeze(this);
  }

  /** Invariant: the sole constructor — parses an exact decimal string to minor units, or throws. */
  static of(major: string, currency: string): Money {
    const exponent = exponentOf(currency);
    return new Money(CONSTRUCTOR_KEY, parseMinorUnits(major, exponent), currency);
  }

  /** Invariant: sum of two same-currency amounts, exact in minor units. */
  add(other: Money): Money {
    assertSameCurrency(this, other, 'add');
    return new Money(CONSTRUCTOR_KEY, this.amount + other.amount, this.currency);
  }

  /** Invariant: difference of two same-currency amounts, exact and sign-carrying. */
  subtract(other: Money): Money {
    assertSameCurrency(this, other, 'subtract');
    return new Money(CONSTRUCTOR_KEY, this.amount - other.amount, this.currency);
  }

  /** Invariant: scales by the factor's exact decimal value; a non-minor-unit result is resolved only by `rounding`. */
  multiply(factor: string, rounding: RoundingMode = 'throw'): Money {
    if (typeof factor !== 'string' || !DECIMAL.test(factor)) {
      throw new TypeError(`multiply() factor must be a decimal string, got ${describe(factor)}`);
    }
    if (rounding !== 'throw' && rounding !== 'halfEven' && rounding !== 'down') {
      throw new RangeError(`unknown rounding mode: ${describe(rounding)}`);
    }

    const negative = factor.startsWith('-');
    const [whole, fraction = ''] = (negative ? factor.slice(1) : factor).split('.');
    const numerator = (negative ? -1n : 1n) * BigInt(whole + fraction);
    const denominator = 10n ** BigInt(fraction.length);

    const scaled = this.amount * numerator; // == result * denominator
    const quotient = scaled / denominator; // truncated toward zero
    const remainder = scaled - quotient * denominator;

    if (remainder === 0n) {
      return new Money(CONSTRUCTOR_KEY, quotient, this.currency);
    }
    if (rounding === 'throw') {
      throw new RangeError(
        `${this.toString()} * ${factor} is not a whole number of minor units; ` +
          'pass a rounding mode or use allocate()',
      );
    }
    if (rounding === 'down') {
      return new Money(CONSTRUCTOR_KEY, quotient, this.currency); // toward zero
    }
    return new Money(CONSTRUCTOR_KEY, roundHalfEven(quotient, remainder, denominator), this.currency);
  }

  /** Invariant: the parts sum back to the whole; leftover minor units go to the largest remainders, ties to the earliest bucket. */
  allocate(ratios: number[]): Money[] {
    if (!Array.isArray(ratios) || ratios.length === 0) {
      throw new RangeError('allocate() requires at least one ratio');
    }
    const weights = ratios.map((r) => {
      if (typeof r !== 'number' || !Number.isInteger(r) || r < 0) {
        throw new RangeError(`allocate() ratios must be non-negative integers, got ${describe(r)}`);
      }
      return BigInt(r);
    });
    const totalWeight = weights.reduce((sum, w) => sum + w, 0n);
    if (totalWeight === 0n) {
      throw new RangeError('allocate() ratios must sum to more than zero');
    }

    const sign = this.amount < 0n ? -1n : 1n;
    const magnitude = this.amount * sign;

    const parts: bigint[] = [];
    const remainders: bigint[] = [];
    let assigned = 0n;
    for (const weight of weights) {
      const share = (magnitude * weight) / totalWeight;
      parts.push(share);
      remainders.push(magnitude * weight - share * totalWeight);
      assigned += share;
    }

    const order = parts
      .map((_, i) => i)
      .sort((a, b) =>
        remainders[a] === remainders[b] ? a - b : remainders[a] > remainders[b] ? -1 : 1,
      );
    for (let leftover = magnitude - assigned, k = 0; leftover > 0n; leftover -= 1n, k += 1) {
      parts[order[k]] += 1n;
    }

    return parts.map((minor) => new Money(CONSTRUCTOR_KEY, minor * sign, this.currency));
  }

  /** Invariant: orders same-currency amounts by minor units; result is exactly -1, 0, or 1. */
  compare(other: Money): -1 | 0 | 1 {
    assertSameCurrency(this, other, 'compare');
    if (this.amount < other.amount) return -1;
    if (this.amount > other.amount) return 1;
    return 0;
  }

  /** Invariant: strict greater-than within one currency. */
  greaterThan(other: Money): boolean {
    return this.compare(other) === 1;
  }

  /** Invariant: strict less-than within one currency. */
  lessThan(other: Money): boolean {
    return this.compare(other) === -1;
  }

  /** Invariant: value equality over (amount, currency); a currency mismatch is false, never a throw. */
  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  /** Invariant: true iff the balance is exactly zero. */
  isZero(): boolean {
    return this.amount === 0n;
  }

  /** Invariant: true iff the balance is below zero — zero is not negative. */
  isNegative(): boolean {
    return this.amount < 0n;
  }

  /** Invariant: canonical decimal string with exactly `exponent` fraction digits; round-trips through Money.of. */
  toString(): string {
    const exponent = MINOR_UNIT_EXPONENTS[this.currency];
    const negative = this.amount < 0n;
    const digits = (negative ? -this.amount : this.amount).toString();
    if (exponent === 0) {
      return (negative ? '-' : '') + digits;
    }
    const padded = digits.padStart(exponent + 1, '0');
    const cut = padded.length - exponent;
    return `${negative ? '-' : ''}${padded.slice(0, cut)}.${padded.slice(cut)}`;
  }

  /** Invariant: JSON form is serializable primitives only — { amount: decimal string, currency }. */
  toJSON(): { amount: string; currency: string } {
    return { amount: this.toString(), currency: this.currency };
  }
}

function exponentOf(currency: string): number {
  if (
    typeof currency !== 'string' ||
    !Object.prototype.hasOwnProperty.call(MINOR_UNIT_EXPONENTS, currency)
  ) {
    throw new RangeError(`unsupported currency: ${describe(currency)}`);
  }
  return MINOR_UNIT_EXPONENTS[currency];
}

function parseMinorUnits(literal: string, exponent: number): bigint {
  if (typeof literal !== 'string' || !DECIMAL.test(literal)) {
    throw new TypeError(`amount must be a decimal string, got ${describe(literal)}`);
  }
  const negative = literal.startsWith('-');
  const [whole, fraction = ''] = (negative ? literal.slice(1) : literal).split('.');
  if (fraction.length > exponent) {
    throw new RangeError(
      `amount ${literal} carries ${fraction.length} fraction digits; this currency allows ${exponent}`,
    );
  }
  const magnitude = BigInt(whole + fraction.padEnd(exponent, '0'));
  return negative ? -magnitude : magnitude;
}

function assertSameCurrency(a: Money, b: Money, op: string): void {
  if (a.currency !== b.currency) {
    throw new RangeError(`cannot ${op} across currencies: ${a.currency} and ${b.currency}`);
  }
}

/** Round `quotient + remainder/denominator` to the nearest integer, ties to even. */
function roundHalfEven(quotient: bigint, remainder: bigint, denominator: bigint): bigint {
  const sign = remainder < 0n ? -1n : 1n;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twiceRemainder < denominator) return quotient;
  if (twiceRemainder > denominator) return quotient + sign;
  return quotient % 2n === 0n ? quotient : quotient + sign;
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}
