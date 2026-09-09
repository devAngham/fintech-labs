import { describe, it, expect } from 'vitest';
import { Money } from './money';

/**
 * Behavioural spec for the Money value object.
 *
 * Money holds an integer `amount` of minor units (bigint) and an ISO-4217
 * `currency`. Every test names the single invariant it defends, so a change
 * that breaks one is easy to diagnose.
 *
 * Supported currencies and exponents: JPY=0, ILS/USD/EUR=2, JOD/KWD/BHD=3.
 *
 * API under test:
 *   Money.of(major: string, currency: string): Money   // the only constructor
 *   .amount: bigint        .currency: string
 *   .add(o) .subtract(o)
 *   .multiply(factor: string, rounding?: 'throw' | 'halfEven' | 'down')  // default 'throw'
 *   .allocate(ratios: number[])
 *   .compare(o) .greaterThan(o) .lessThan(o)
 *   .equals(o) .isZero() .isNegative()
 *   .toString() .toJSON()
 */

describe('Money.of — construction', () => {
  // Invariant: whole major units scale to minor units by the currency exponent.
  it('scales whole major units to minor units', () => {
    expect(Money.of('10', 'USD').amount).toBe(1000n);
  });

  // Invariant: a fraction shorter than the exponent is right-padded to it, not rejected.
  it('pads a short fraction to the currency exponent', () => {
    expect(Money.of('10.5', 'ILS').amount).toBe(1050n);
    expect(Money.of('0.05', 'USD').amount).toBe(5n);
  });

  // Invariant: the ISO-4217 exponent, not a hard-coded 100, sets the minor-unit scale.
  it('uses the per-currency exponent (JPY=0, USD=2, JOD=3)', () => {
    expect(Money.of('1050', 'JPY').amount).toBe(1050n);
    expect(Money.of('10.00', 'USD').amount).toBe(1000n);
    expect(Money.of('1.234', 'JOD').amount).toBe(1234n);
  });

  // Invariant: precision finer than the currency exponent is rejected, never rounded.
  it('throws when the fraction has more digits than the exponent', () => {
    expect(() => Money.of('10.555', 'ILS')).toThrow();
    expect(() => Money.of('10.5', 'JPY')).toThrow();
    expect(() => Money.of('1.2345', 'JOD')).toThrow();
  });

  // Invariant: amounts are constructed from decimal strings only — `number` is never accepted.
  it('rejects number amount input at runtime', () => {
    expect(() => Money.of(10.5 as unknown as string, 'USD')).toThrow();
    expect(() => Money.of(10 as unknown as string, 'USD')).toThrow();
  });

  // Invariant: currency must be a supported ISO-4217 string (upper-case, in the table).
  it('rejects unknown or non-string currency', () => {
    expect(() => Money.of('1', 'GBP')).toThrow();
    expect(() => Money.of('1', 'usd')).toThrow();
    expect(() => Money.of('1', 123 as unknown as string)).toThrow();
  });

  // Invariant: the only valid amount literal is /^-?\d+(\.\d+)?$/.
  it('rejects malformed amount strings', () => {
    for (const bad of ['', '.', '1.', '.5', '1.2.3', 'abc', ' 1 ', '+1', '1e3', '1,000', '-']) {
      expect(() => Money.of(bad, 'USD'), bad).toThrow();
    }
  });

  // Invariant: the sign is preserved through parsing.
  it('parses negative amounts', () => {
    expect(Money.of('-10.5', 'ILS').amount).toBe(-1050n);
  });

  // Invariant: "-0" is indistinguishable from zero.
  it('normalizes "-0" to zero', () => {
    const z = Money.of('-0', 'USD');
    expect(z.isZero()).toBe(true);
    expect(z.isNegative()).toBe(false);
  });

  // Invariant: instances are frozen at construction.
  it('freezes instances', () => {
    const m = Money.of('1.00', 'USD');
    expect(Object.isFrozen(m)).toBe(true);
    expect(() => {
      (m as unknown as { amount: bigint }).amount = 999n;
    }).toThrow();
  });

  // Invariant: the constructor is unreachable at runtime, not merely `private` in the types.
  it('cannot be constructed directly, even when the type system is bypassed', () => {
    const Ctor = Money as unknown as { new (amount: bigint, currency: string): unknown };
    expect(() => new Ctor(100n, 'USD')).toThrow();
  });
});

describe('rationale — why the design is shaped this way', () => {
  // Rationale for `amount: bigint`: values past 2^53 must stay exact.
  it('bigint holds amounts beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    // 90_071_992_547_409.93 USD = 9_007_199_254_740_993 minor units = MAX_SAFE_INTEGER + 2.
    const huge = Money.of('90071992547409.93', 'USD');
    expect(huge.amount).toBe(9007199254740993n);

    // The same magnitude as a JS number silently collapses onto its even neighbour, 2^53.
    expect(Number(huge.amount)).toBe(2 ** 53);
    expect(Number.isSafeInteger(Number(huge.amount))).toBe(false);

    // bigint arithmetic stays exact where number arithmetic would not.
    expect(huge.add(Money.of('0.02', 'USD')).amount).toBe(9007199254740995n);
    expect(huge.toString()).toBe('90071992547409.93');
  });

  // Rationale for `toJSON()`: a raw bigint field makes JSON.stringify throw by default.
  it('a raw bigint field makes JSON.stringify throw TypeError', () => {
    expect(() => JSON.stringify({ raw: 1n })).toThrow(TypeError);
  });
});

describe('equality and sign predicates', () => {
  // Invariant: equality is value-based over (amount, currency).
  it('equals is true only for the same amount and currency', () => {
    const a = Money.of('1.00', 'USD');
    expect(a.equals(Money.of('1.00', 'USD'))).toBe(true);
    expect(a.equals(Money.of('1.01', 'USD'))).toBe(false);
  });

  // Invariant: equals is a total predicate — a currency mismatch is `false`, not a throw.
  it('equals returns false across currencies without throwing', () => {
    expect(Money.of('1.00', 'USD').equals(Money.of('1.00', 'EUR'))).toBe(false);
  });

  // Invariant: isZero is true iff the minor-unit amount is exactly 0.
  it('isZero reflects a zero balance only', () => {
    expect(Money.of('0', 'USD').isZero()).toBe(true);
    expect(Money.of('0.01', 'USD').isZero()).toBe(false);
  });

  // Invariant: zero is not negative.
  it('isNegative is true below zero and false at or above zero', () => {
    expect(Money.of('-0.01', 'USD').isNegative()).toBe(true);
    expect(Money.of('0', 'USD').isNegative()).toBe(false);
    expect(Money.of('0.01', 'USD').isNegative()).toBe(false);
  });
});

describe('ordering', () => {
  // Invariant: compare returns the sign of (this - other) over minor units: -1, 0, or 1.
  it('compare orders by minor-unit amount', () => {
    expect(Money.of('1.00', 'USD').compare(Money.of('2.00', 'USD'))).toBe(-1);
    expect(Money.of('2.00', 'USD').compare(Money.of('2.00', 'USD'))).toBe(0);
    expect(Money.of('2.00', 'USD').compare(Money.of('1.00', 'USD'))).toBe(1);
  });

  // Invariant: greaterThan / lessThan are strict.
  it('greaterThan and lessThan are strict', () => {
    const a = Money.of('1.00', 'USD');
    const b = Money.of('1.01', 'USD');
    expect(b.greaterThan(a)).toBe(true);
    expect(a.lessThan(b)).toBe(true);
    expect(a.greaterThan(a)).toBe(false);
    expect(a.lessThan(a)).toBe(false);
  });

  // Invariant: ordering is sign-aware.
  it('orders negatives correctly', () => {
    expect(Money.of('-1.00', 'USD').lessThan(Money.of('0', 'USD'))).toBe(true);
    expect(Money.of('-1.00', 'USD').greaterThan(Money.of('-2.00', 'USD'))).toBe(true);
  });

  // Invariant: order across currencies is undefined — every comparison throws.
  it('throws on cross-currency comparison', () => {
    const usd = Money.of('1.00', 'USD');
    const eur = Money.of('1.00', 'EUR');
    expect(() => usd.compare(eur)).toThrow();
    expect(() => usd.greaterThan(eur)).toThrow();
    expect(() => usd.lessThan(eur)).toThrow();
  });

  // Invariant: compare is a valid Array#sort comparator (transitive, sign-correct).
  it('sorts an array via compare', () => {
    const sorted = [
      Money.of('2.00', 'USD'),
      Money.of('-1.00', 'USD'),
      Money.of('0.50', 'USD'),
    ].sort((x: Money, y: Money) => x.compare(y));
    expect(sorted.map((m: Money) => m.toString())).toEqual(['-1.00', '0.50', '2.00']);
  });
});

describe('add / subtract', () => {
  // Invariant: addition is exact on minor units.
  it('adds minor units', () => {
    const sum = Money.of('0.10', 'USD').add(Money.of('0.20', 'USD'));
    expect(sum.equals(Money.of('0.30', 'USD'))).toBe(true);
  });

  // Invariant: subtraction is exact and may cross zero.
  it('subtracts minor units', () => {
    const diff = Money.of('0.30', 'USD').subtract(Money.of('0.50', 'USD'));
    expect(diff.equals(Money.of('-0.20', 'USD'))).toBe(true);
  });

  // Invariant: arithmetic never mutates its operands and returns a frozen instance.
  it('returns a new instance and leaves operands unchanged', () => {
    const a = Money.of('1.00', 'USD');
    const b = Money.of('0.25', 'USD');
    const sum = a.add(b);
    expect(a.amount).toBe(100n);
    expect(b.amount).toBe(25n);
    expect(sum).not.toBe(a);
    expect(Object.isFrozen(sum)).toBe(true);
  });

  // Invariant: mixing currencies in arithmetic is a hard error.
  it('throws on cross-currency add or subtract', () => {
    expect(() => Money.of('1.00', 'USD').add(Money.of('1.00', 'EUR'))).toThrow();
    expect(() => Money.of('1.00', 'USD').subtract(Money.of('1.00', 'EUR'))).toThrow();
  });
});

describe("multiply(factor: string, rounding?: 'throw' | 'halfEven' | 'down')", () => {
  // Invariant: scaling by an integer-valued factor string is exact.
  it('multiplies by an integer factor', () => {
    expect(Money.of('10.50', 'USD').multiply('3').equals(Money.of('31.50', 'USD'))).toBe(true);
  });

  // Invariant: the factor is an exact decimal — '1.1' is 11/10, not the binary float 1.10000000000000009.
  it('applies a non-integer factor at exact decimal precision', () => {
    expect(Money.of('10.50', 'USD').multiply('1.1').equals(Money.of('11.55', 'USD'))).toBe(true);
  });

  // Invariant: factor '-1' negates; factor '0' zeroes.
  it('negates on -1 and zeroes on 0', () => {
    expect(Money.of('10.50', 'USD').multiply('-1').equals(Money.of('-10.50', 'USD'))).toBe(true);
    expect(Money.of('10.50', 'USD').multiply('0').isZero()).toBe(true);
  });

  // Invariant: `number` is refused here too — the whole reason the factor is a string.
  it('rejects a number factor', () => {
    expect(() => Money.of('10.00', 'USD').multiply(1.1 as unknown as string)).toThrow();
    expect(() => Money.of('10.00', 'USD').multiply(2 as unknown as string)).toThrow();
  });

  // Invariant: the factor string obeys the same grammar as an amount.
  it('rejects a malformed factor string', () => {
    for (const bad of ['', '1e3', 'abc', '1,5', ' 1.1 ', '.5', '1.', 'NaN', 'Infinity']) {
      expect(() => Money.of('10.00', 'USD').multiply(bad), bad).toThrow();
    }
  });

  // Invariant: currency is carried through scaling.
  it('preserves currency', () => {
    expect(Money.of('2.000', 'JOD').multiply('2').currency).toBe('JOD');
  });
});

/**
 * Rounding modes for multiply(), exercised with a 2.9% processing fee.
 *
 * Rounding is an explicit parameter because there is no universal rule:
 *  - 'halfEven' (banker's rounding) sends .5 ties to the nearest even minor unit,
 *    so ties split ~half up / half down and the bias cancels in aggregate. It is
 *    the IEEE-754 default and a common accounting choice -- but not universal.
 *  - Several tax and VAT regimes mandate half-up (ties away from zero) instead, so
 *    a Money type cannot bake one rule in; the caller has to choose.
 *  - 'down' (truncate toward zero) has the largest bias; also sometimes mandated.
 *  - The default is 'throw': absent an explicit choice, a fractional result is an
 *    error, not a silent rounding decision.
 */
describe('multiply — rounding modes (2.9% processing fee)', () => {
  const fee = '0.029';

  // Invariant: default mode is 'throw' — a fractional-minor-unit fee is refused.
  it("'throw' (default) rejects a fee that is not a whole number of minor units", () => {
    // 12.34 USD * 2.9% = 0.35786 USD -> 35.786 minor units.
    expect(() => Money.of('12.34', 'USD').multiply(fee)).toThrow();
    expect(() => Money.of('12.34', 'USD').multiply(fee, 'throw')).toThrow();
  });

  // Invariant: 'halfEven' rounds to the nearest minor unit (0.35786 -> 0.36; not a tie).
  it("'halfEven' rounds 12.34 * 2.9% to 0.36", () => {
    expect(Money.of('12.34', 'USD').multiply(fee, 'halfEven').equals(Money.of('0.36', 'USD'))).toBe(true);
  });

  // Invariant: 'halfEven' breaks an exact .5 tie toward the even neighbour, not always up.
  it("'halfEven' sends 5.00 * 2.9% = 0.145 -> 0.14 and 15.00 * 2.9% = 0.435 -> 0.44", () => {
    expect(Money.of('5.00', 'USD').multiply(fee, 'halfEven').equals(Money.of('0.14', 'USD'))).toBe(true);
    expect(Money.of('15.00', 'USD').multiply(fee, 'halfEven').equals(Money.of('0.44', 'USD'))).toBe(true);
  });

  // Invariant: 'down' truncates toward zero (0.35786 -> 0.35).
  it("'down' truncates 12.34 * 2.9% to 0.35", () => {
    expect(Money.of('12.34', 'USD').multiply(fee, 'down').equals(Money.of('0.35', 'USD'))).toBe(true);
  });

  // Invariant: 'down' is toward zero for negatives too (-0.35786 -> -0.35, not -0.36).
  it("'down' truncates a negative product toward zero", () => {
    expect(Money.of('-12.34', 'USD').multiply(fee, 'down').equals(Money.of('-0.35', 'USD'))).toBe(true);
  });

  // Invariant: an exact product is identical under every mode (10.00 * 2.9% = 0.29 exactly).
  it('leaves an exact product alone under every mode', () => {
    for (const mode of ['throw', 'halfEven', 'down'] as const) {
      expect(Money.of('10.00', 'USD').multiply(fee, mode).equals(Money.of('0.29', 'USD'))).toBe(true);
    }
  });

  // Invariant: an unknown rounding mode is rejected.
  it('rejects an unknown rounding mode', () => {
    expect(() => Money.of('12.34', 'USD').multiply(fee, 'up' as never)).toThrow();
  });
});

describe('allocate(ratios: number[])', () => {
  // Invariant: leftover minor units go to the earliest buckets, deterministically.
  it('splits 0.05 USD three ways as [0.02, 0.02, 0.01]', () => {
    const parts = Money.of('0.05', 'USD').allocate([1, 1, 1]);
    expect(parts.map((p: Money) => p.toString())).toEqual(['0.02', '0.02', '0.01']);
  });

  // Invariant: allocation is proportional to the ratio weights.
  it('splits by unequal weights [3, 1]', () => {
    const parts = Money.of('0.05', 'USD').allocate([3, 1]);
    expect(parts.map((p: Money) => p.toString())).toEqual(['0.04', '0.01']);
  });

  // Invariant: a zero weight receives nothing.
  it('gives a zero-weight bucket zero', () => {
    const parts = Money.of('0.03', 'USD').allocate([1, 0, 1]);
    expect(parts.map((p: Money) => p.toString())).toEqual(['0.02', '0.00', '0.01']);
  });

  // Invariant: sign is mirrored — allocate(-x) is the negation of allocate(x).
  it('mirrors a negative amount', () => {
    const parts = Money.of('-0.05', 'USD').allocate([1, 1, 1]);
    expect(parts.map((p: Money) => p.toString())).toEqual(['-0.02', '-0.02', '-0.01']);
  });

  // Invariant: allocating zero yields all zeros.
  it('allocates zero to zeros', () => {
    const parts = Money.of('0', 'USD').allocate([1, 2, 3]);
    expect(parts.every((p: Money) => p.isZero())).toBe(true);
    expect(parts).toHaveLength(3);
  });

  // Invariant: one part per ratio, every part in the source currency.
  it('returns one part per ratio, all in the source currency', () => {
    const parts = Money.of('1.000', 'JOD').allocate([1, 1, 1, 1]);
    expect(parts).toHaveLength(4);
    expect(parts.every((p: Money) => p.currency === 'JOD')).toBe(true);
  });

  // Invariant (the reason allocate exists): the parts always sum back to the original.
  it('conserves the total for every shape of input', () => {
    const cases: Array<[string, string, number[]]> = [
      ['0.05', 'USD', [1, 1, 1]],
      ['0.05', 'USD', [3, 1]],
      ['100.00', 'USD', [1, 1, 1, 1, 1, 1, 1]],
      ['-100.00', 'USD', [1, 2, 3]],
      ['0.03', 'USD', [1, 0, 1]],
      ['10', 'JPY', [1, 1, 1]],
      ['1.234', 'JOD', [5, 3, 2]],
      ['0.01', 'USD', [1, 1, 1, 1]],
    ];
    for (const [major, ccy, ratios] of cases) {
      const whole = Money.of(major, ccy);
      const parts = whole.allocate(ratios);
      const summed = parts.reduce((acc: Money, p: Money) => acc.add(p), Money.of('0', ccy));
      expect(summed.equals(whole), `${major} ${ccy} ${JSON.stringify(ratios)}`).toBe(true);
    }
  });

  // Invariant: conservation holds at int64 scale, not just small amounts.
  it('conserves the total for an int64-scale amount', () => {
    const huge = Money.of('92233720368547758.07', 'USD'); // 9_223_372_036_854_775_807 minor units
    const parts = huge.allocate([1, 1, 1]);
    const summed = parts.reduce((acc: Money, p: Money) => acc.add(p), Money.of('0', 'USD'));
    expect(summed.equals(huge)).toBe(true);
  });

  // Invariant: an empty ratio list has no meaning.
  it('throws on an empty ratios array', () => {
    expect(() => Money.of('1.00', 'USD').allocate([])).toThrow();
  });

  // Invariant: negative weights are undefined.
  it('throws on a negative ratio', () => {
    expect(() => Money.of('1.00', 'USD').allocate([2, -1])).toThrow();
  });

  // Invariant: the weights must have a positive sum.
  it('throws when all ratios are zero', () => {
    expect(() => Money.of('1.00', 'USD').allocate([0, 0])).toThrow();
  });

  // Invariant: ratios are integer weights.
  it('throws on a non-integer or non-finite ratio', () => {
    expect(() => Money.of('1.00', 'USD').allocate([0.5, 0.5])).toThrow();
    expect(() => Money.of('1.00', 'USD').allocate([1, Number.NaN])).toThrow();
    expect(() => Money.of('1.00', 'USD').allocate([1, Number.POSITIVE_INFINITY])).toThrow();
  });
});

describe('toString and toJSON', () => {
  // Invariant: toString renders exactly `exponent` fraction digits.
  it('renders the currency exponent as fixed decimal places', () => {
    expect(Money.of('0.05', 'USD').toString()).toBe('0.05');
    expect(Money.of('10', 'USD').toString()).toBe('10.00');
  });

  // Invariant: a zero-exponent currency renders with no decimal point.
  it('renders JPY with no fraction', () => {
    expect(Money.of('1050', 'JPY').toString()).toBe('1050');
  });

  // Invariant: a three-exponent currency renders three fraction digits.
  it('renders JOD with three fraction digits', () => {
    expect(Money.of('1.234', 'JOD').toString()).toBe('1.234');
    expect(Money.of('0.05', 'JOD').toString()).toBe('0.050');
  });

  // Invariant: the minus sign survives rendering.
  it('keeps the minus sign', () => {
    expect(Money.of('-10.5', 'ILS').toString()).toBe('-10.50');
  });

  // Invariant: Money.of(m.toString(), ccy) reconstructs an equal value at every exponent.
  it('round-trips through toString', () => {
    for (const [major, ccy] of [
      ['1050', 'JPY'],
      ['10.50', 'ILS'],
      ['1.234', 'JOD'],
      ['-0.07', 'USD'],
    ] as const) {
      const m = Money.of(major, ccy);
      expect(Money.of(m.toString(), ccy).equals(m)).toBe(true);
    }
  });

  // Invariant: toJSON returns serializable primitives: the decimal string and the currency.
  it('exposes toJSON as { amount, currency } strings', () => {
    expect(Money.of('1.234', 'JOD').toJSON()).toEqual({ amount: '1.234', currency: 'JOD' });
  });

  // Invariant: a Money survives JSON.stringify and reconstructs via Money.of.
  it('round-trips through JSON.stringify', () => {
    const m = Money.of('10.50', 'USD');
    const json = JSON.stringify(m);
    expect(json).toBe('{"amount":"10.50","currency":"USD"}');
    const back = JSON.parse(json) as { amount: string; currency: string };
    expect(Money.of(back.amount, back.currency).equals(m)).toBe(true);
  });

  // Invariant: toJSON also works when nested inside a larger object.
  it('serializes when nested', () => {
    const json = JSON.stringify({ price: Money.of('9.99', 'EUR'), qty: 2 });
    expect(json).toBe('{"price":{"amount":"9.99","currency":"EUR"},"qty":2}');
  });
});
