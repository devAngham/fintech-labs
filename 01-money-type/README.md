# Money

An immutable value object for exact monetary arithmetic. `amount` is a `bigint`
count of minor units; `currency` is an ISO-4217 code. No dependencies.

## The problem

Money is decimal; binary floating point is not.

```js
0.1 + 0.2 === 0.3; // false — the left side is 0.30000000000000004
```

`0.1`, `0.2`, and `0.3` have no exact IEEE-754 representation, so the sum carries
a rounding error. Accumulated across a ledger, errors like this surface as
balances that do not reconcile.

The fix is to never hold money in a float. Store an integer count of the
currency's smallest unit — cents for USD, fils for JOD, whole yen for JPY — and
do all arithmetic in integers:

```ts
Money.of('0.10', 'USD').add(Money.of('0.20', 'USD')).toString(); // '0.30'
```

`0.10 USD` is `10n` minor units, `0.20 USD` is `20n`, the sum is `30n`, rendered
back as `'0.30'`. No rounding, because no division. `amount` is a `bigint`, not a
`number`: a ledger total can exceed `Number.MAX_SAFE_INTEGER` (2^53 − 1, roughly
$90 trillion in cents), past which `number` silently loses integer precision.

Amounts are parsed from a decimal string, split on the point. A `number`
argument is rejected outright — by the time `0.1` reaches a constructor its
precision is already gone. Precision finer than the currency exponent is an
error, never rounded: `Money.of('10.555', 'ILS')` throws rather than guess.

## The naive approach and why it fails

Integer minor units settle addition and subtraction. Division is where they
break. Splitting a charge, allocating a fee, prorating a refund — each divides
one amount into parts, and integer division leaves a remainder that has to go
somewhere.

Take `0.05 USD` (`5n` cents) split three ways. The true share is
`5 / 3 = 1.667` cents, which is not representable in minor units.

- **Round each share down:** `1 + 1 + 1 = 3` cents. Two cents have vanished. The
  parts fall short of the whole; the ledger is under.
- **Round each share up:** `2 + 2 + 2 = 6` cents. One cent has been created from
  nothing. The parts overshoot the whole; the ledger is over.

Either way the invariant that matters — `sum(parts) === whole` — is broken.
Rounding the quotient in a single direction cannot preserve it.

## The design

`Money` is immutable. Every operation returns a new frozen instance.
Cross-currency `add`, `subtract`, and `compare` throw. Construction is only
through `Money.of`; the constructor is guarded by a module-private symbol, so
`new Money(...)` throws even when the type system is bypassed.

### allocate replaces divide

There is no `divide` method. `allocate(ratios)` splits an amount into parts by
integer weights, using the largest-remainder method:

1. Give each bucket `floor(amount * weight / totalWeight)` minor units.
2. Hand the leftover out one unit at a time to the buckets with the largest
   division remainder, ties going to the earliest bucket.

`0.05 USD` split `[1, 1, 1]` yields `['0.02', '0.02', '0.01']`, sum `0.05`. Split
`[3, 1]` yields `['0.04', '0.01']`. A negative amount allocates as the negation
of the positive split. The parts sum back to the original for every ratio shape,
at every magnitude.

### multiply takes a decimal string

`multiply(factor: string)`, not `factor: number`. The module rejects `number`
for amounts because binary floats cannot hold most decimals; a numeric factor
reopens the same hole. `1.1` as a double is `1.1000000000000000888...`; a factor
computed as `0.07 * 3` stringifies to `'0.21000000000000002'`. Passing the
factor as a string keeps it exact — `'1.1'` is the rational `11/10` — and no
float enters the pipeline.

A factor with no finite decimal expansion (a literal one-third) cannot be
written as a string, but that split has to go through `allocate` regardless, so
the restriction costs nothing real.

### the rounding mode is explicit

Multiplying money by a rate — tax, interest, FX — usually lands between two minor
units. Some rule has to resolve it, and there is no universal one:

- `halfEven` (banker's rounding) sends `.5` ties to the nearest even minor unit.
  Ties split roughly half up and half down, so rounding bias cancels in
  aggregate. This is the IEEE-754 default and the common accounting choice for
  unbiased totals — but it is not universal.
- `halfUp` (ties away from zero) carries a systematic upward bias, yet several
  tax and VAT regimes mandate exactly it.
- `down` (truncate toward zero) has the largest bias; also sometimes mandated.

Because the correct rule depends on jurisdiction and context, `multiply` never
picks one. The default is `'throw'`: absent an explicit mode, a fractional
result is an error. The caller passes `'halfEven'` or `'down'` and owns that
choice. (`halfUp` is not currently implemented; `allocate` covers proportional
splits with no rounding policy at all.)

```ts
Money.of('12.34', 'USD').multiply('0.029');             // throws — 0.35786 is not a minor unit
Money.of('12.34', 'USD').multiply('0.029', 'halfEven'); // '0.36'
Money.of('12.34', 'USD').multiply('0.029', 'down');     // '0.35'
```

## API

| Member | Signature | Notes |
| --- | --- | --- |
| `Money.of` | `(major: string, currency: string): Money` | Only constructor. Rejects `number`, malformed strings, precision beyond the currency exponent, unsupported currency. |
| `amount` | `bigint` | Minor units. Read-only. |
| `currency` | `string` | ISO-4217 code. Read-only. |
| `add` / `subtract` | `(other: Money): Money` | Exact. Cross-currency throws. |
| `multiply` | `(factor: string, rounding?: 'throw' \| 'halfEven' \| 'down'): Money` | Decimal-string factor. Default `'throw'`. |
| `allocate` | `(ratios: number[]): Money[]` | Largest-remainder split. `sum(result) === this`. Ratios are non-negative integers with a positive sum. |
| `compare` | `(other: Money): -1 \| 0 \| 1` | Cross-currency throws. |
| `greaterThan` / `lessThan` | `(other: Money): boolean` | Strict. Cross-currency throws. |
| `equals` | `(other: Money): boolean` | Value equality. A currency mismatch is `false`, not a throw. |
| `isZero` / `isNegative` | `(): boolean` | Zero is not negative. |
| `toString` | `(): string` | Canonical decimal with exactly the currency's fraction digits. Round-trips through `Money.of`. |
| `toJSON` | `(): { amount: string; currency: string }` | `amount` is the decimal string; a raw `bigint` field would make `JSON.stringify` throw. |

Supported currencies: `JPY` (exponent 0); `USD`, `EUR`, `ILS` (2); `JOD`, `KWD`,
`BHD` (3).

## Tests

```
npm install
npm test
```
