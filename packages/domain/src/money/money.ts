export type Kobo = number;

export class Money {
  private constructor(readonly kobo: Kobo) {}

  static fromKobo(kobo: Kobo): Money {
    return new Money(Math.trunc(kobo));
  }

  static fromNaira(naira: number): Money {
    return new Money(Math.round(naira * 100));
  }

  static zero(): Money {
    return Money.fromKobo(0);
  }

  add(other: Money): Money {
    return new Money(this.kobo + other.kobo);
  }

  subtract(other: Money): Money {
    return new Money(this.kobo - other.kobo);
  }

  multiply(scalar: number): Money {
    return Money.fromKobo(Math.round(this.kobo * scalar));
  }

  gt(other: Money): boolean {
    return this.kobo > other.kobo;
  }

  gte(other: Money): boolean {
    return this.kobo >= other.kobo;
  }

  lt(other: Money): boolean {
    return this.kobo < other.kobo;
  }

  lte(other: Money): boolean {
    return this.kobo <= other.kobo;
  }

  eq(other: Money): boolean {
    return this.kobo === other.kobo;
  }

  isZero(): boolean {
    return this.kobo === 0;
  }

  isNegative(): boolean {
    return this.kobo < 0;
  }

  assertNonNegative(): Money {
    if (this.isNegative()) {
      throw new Error(`Money must be non-negative: ${this.kobo}`);
    }
    return this;
  }

  toNaira(): number {
    return this.kobo / 100;
  }

  toString(): string {
    return (this.kobo / 100).toFixed(2);
  }
}
