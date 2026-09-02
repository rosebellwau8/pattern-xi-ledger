// Ported verbatim from Pattern XI apps/platform/src/modules/settlement/exact-decimal.ts
// (Owner-reviewed Task 6 baseline). The only change: constructor parameter
// properties became explicit fields, because Node's native TypeScript type
// stripping only accepts erasable syntax.

const DECIMAL = /^([+-]?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

function power10(value: number): bigint {
  return 10n ** BigInt(value);
}

export class ExactDecimal {
  // Read-only representation is public because the performance projection
  // needs exact numerator/scale access for ratio formatting without converting
  // through IEEE-754. Mutation remains impossible.
  readonly coefficient: bigint;
  readonly scale: number;

  private constructor(coefficient: bigint, scale: number) {
    let normalizedCoefficient = coefficient;
    let normalizedScale = scale;
    while (normalizedScale > 0 && normalizedCoefficient % 10n === 0n) {
      normalizedCoefficient /= 10n;
      normalizedScale -= 1;
    }
    this.coefficient = normalizedCoefficient;
    this.scale = normalizedScale;
  }

  static parse(value: string): ExactDecimal {
    const match = DECIMAL.exec(value);
    if (match === null) throw new Error("DECIMAL_INVALID");
    const fraction = match[3] ?? "";
    const sign = match[1] === "-" ? -1n : 1n;
    return new ExactDecimal(
      sign * BigInt(`${match[2]}${fraction}`),
      fraction.length,
    );
  }

  static zero(): ExactDecimal {
    return new ExactDecimal(0n, 0);
  }

  compare(other: ExactDecimal): number {
    const scale = Math.max(this.scale, other.scale);
    const left = this.coefficient * power10(scale - this.scale);
    const right = other.coefficient * power10(scale - other.scale);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  add(other: ExactDecimal): ExactDecimal {
    const scale = Math.max(this.scale, other.scale);
    return new ExactDecimal(
      this.coefficient * power10(scale - this.scale) +
        other.coefficient * power10(scale - other.scale),
      scale,
    );
  }

  subtract(other: ExactDecimal): ExactDecimal {
    return this.add(new ExactDecimal(-other.coefficient, other.scale));
  }

  divideByTwo(): ExactDecimal {
    if (this.coefficient % 2n === 0n) {
      return new ExactDecimal(this.coefficient / 2n, this.scale);
    }
    return new ExactDecimal(this.coefficient * 5n, this.scale + 1);
  }

  toString(): string {
    if (this.coefficient === 0n) return "0";
    const negative = this.coefficient < 0n;
    const digits = (negative ? -this.coefficient : this.coefficient).toString();
    if (this.scale === 0) return `${negative ? "-" : ""}${digits}`;
    const padded = digits.padStart(this.scale + 1, "0");
    const split = padded.length - this.scale;
    return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
  }

  formatFixedThreeHalfUp(): string {
    const negative = this.coefficient < 0n;
    const absolute = negative ? -this.coefficient : this.coefficient;
    let thousandths: bigint;
    if (this.scale <= 3) {
      thousandths = absolute * power10(3 - this.scale);
    } else {
      const divisor = power10(this.scale - 3);
      thousandths = absolute / divisor;
      if ((absolute % divisor) * 2n >= divisor) thousandths += 1n;
    }
    if (thousandths === 0n) return "0.000";
    const digits = thousandths.toString().padStart(4, "0");
    return `${negative ? "-" : ""}${digits.slice(0, -3)}.${digits.slice(-3)}`;
  }
}

export function sumExactDecimalStrings(values: readonly string[]): string {
  return values.reduce(
    (sum, value) => sum.add(ExactDecimal.parse(value)),
    ExactDecimal.parse("0"),
  ).toString();
}
