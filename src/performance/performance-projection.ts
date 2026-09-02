// Ported from Pattern XI apps/platform/src/modules/performance/performance-projection.ts
// (Owner-reviewed Task 7 baseline). Changes are naming only: public_pick_id ->
// pick_id, official_at -> kickoff_utc, and the projection now shares the
// reviewed ExactDecimal from src/settlement/exact-decimal.ts. All arithmetic
// and ordering semantics are unchanged: exact decimals, chronological
// ordering with id tie-break, zero-origin maximum drawdown, and rebuild from
// authoritative settlement revisions only.

import { ExactDecimal } from "../settlement/exact-decimal.ts";

const PICK_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u;

export type PerformanceClassification =
  | "WIN"
  | "HALF_WIN"
  | "PUSH"
  | "HALF_LOSS"
  | "LOSS"
  | "VOID";

type CountedClassification = Exclude<PerformanceClassification, "VOID">;

export interface PerformanceSettlementRevision {
  settlement_id: string;
  revision: number;
  classification: PerformanceClassification;
  net_return: string;
}

export interface PerformancePick {
  pick_id: string;
  kickoff_utc: string;
  normalized_decimal_price: string;
  current_settlement_id: string | null;
  settlements: PerformanceSettlementRevision[];
}

export interface PerformanceCurvePoint {
  pick_id: string;
  kickoff_utc: string;
  net_return: string;
  cumulative_net_return: string;
}

export interface PerformanceProjection {
  pick_count: number;
  settled_count: number;
  pending_count: number;
  void_count: number;
  n: number;
  classification_counts: Record<CountedClassification, number>;
  average_decimal_price: string | null;
  total_net_return: string;
  roi_percent: string | null;
  maximum_drawdown: string;
  cumulative_return_curve: PerformanceCurvePoint[];
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function formatRatioHalfUp(
  numerator: ExactDecimal,
  denominator: bigint,
  multiplier: bigint,
): string {
  if (denominator <= 0n) {
    throw new Error("RATIO_DENOMINATOR_INVALID");
  }
  const divisor = powerOfTen(numerator.scale) * denominator;
  const scaled = absolute(numerator.coefficient) * multiplier * 1_000n;
  let rounded = scaled / divisor;
  if ((scaled % divisor) * 2n >= divisor) {
    rounded += 1n;
  }
  const negative = numerator.coefficient < 0n && rounded !== 0n;
  const digits = rounded.toString().padStart(4, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -3)}.${digits.slice(-3)}`;
}

function parseUtcTimestamp(value: string): number {
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    throw new Error("KICKOFF_TIME_INVALID");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0"));
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const date = new Date(epoch);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
    || date.getUTCMilliseconds() !== millisecond
  ) {
    throw new Error("KICKOFF_TIME_INVALID");
  }
  return epoch;
}

function isPerformanceClassification(value: string): value is PerformanceClassification {
  return value === "WIN"
    || value === "HALF_WIN"
    || value === "PUSH"
    || value === "HALF_LOSS"
    || value === "LOSS"
    || value === "VOID";
}

interface CountedPick {
  pick: PerformancePick;
  kickoffEpoch: number;
  netReturn: ExactDecimal;
}

function resolveCurrentSettlement(
  pick: PerformancePick,
  globalSettlementIds: Set<string>,
): { settlement: PerformanceSettlementRevision; netReturn: ExactDecimal } | null {
  const revisionNumbers = new Set<number>();
  let maximumRevision = 0;
  for (const settlement of pick.settlements) {
    if (settlement.settlement_id.length === 0 || globalSettlementIds.has(settlement.settlement_id)) {
      throw new Error("DUPLICATE_SETTLEMENT_ID");
    }
    globalSettlementIds.add(settlement.settlement_id);
    if (!Number.isSafeInteger(settlement.revision) || settlement.revision < 1
      || revisionNumbers.has(settlement.revision)) {
      throw new Error("SETTLEMENT_REVISION_INVALID");
    }
    revisionNumbers.add(settlement.revision);
    maximumRevision = Math.max(maximumRevision, settlement.revision);
    if (!isPerformanceClassification(settlement.classification)) {
      throw new Error("CLASSIFICATION_INVALID");
    }
    ExactDecimal.parse(settlement.net_return);
  }

  if (pick.current_settlement_id === null) {
    if (pick.settlements.length !== 0) {
      throw new Error("CURRENT_SETTLEMENT_MISSING");
    }
    return null;
  }
  const current = pick.settlements.find(
    (settlement) => settlement.settlement_id === pick.current_settlement_id,
  );
  if (current === undefined) {
    throw new Error("CURRENT_SETTLEMENT_NOT_FOUND");
  }
  if (current.revision !== maximumRevision) {
    throw new Error("CURRENT_SETTLEMENT_STALE");
  }
  return { settlement: current, netReturn: ExactDecimal.parse(current.net_return) };
}

export function buildPerformanceProjection(picks: readonly PerformancePick[]): PerformanceProjection {
  const pickIds = new Set<string>();
  const settlementIds = new Set<string>();
  const counted: CountedPick[] = [];
  const classificationCounts: Record<CountedClassification, number> = {
    WIN: 0,
    HALF_WIN: 0,
    PUSH: 0,
    HALF_LOSS: 0,
    LOSS: 0,
  };
  let pendingCount = 0;
  let voidCount = 0;
  let settledCount = 0;
  let priceSum = ExactDecimal.zero();

  for (const pick of picks) {
    if (!PICK_ID_PATTERN.test(pick.pick_id)) {
      throw new Error("PICK_ID_INVALID");
    }
    if (pickIds.has(pick.pick_id)) {
      throw new Error("DUPLICATE_PICK_ID");
    }
    pickIds.add(pick.pick_id);
    const kickoffEpoch = parseUtcTimestamp(pick.kickoff_utc);
    const price = ExactDecimal.parse(pick.normalized_decimal_price);
    if (price.compare(ExactDecimal.zero()) <= 0) {
      throw new Error("DECIMAL_PRICE_INVALID");
    }
    const current = resolveCurrentSettlement(pick, settlementIds);
    if (current === null) {
      pendingCount += 1;
      continue;
    }
    settledCount += 1;
    if (current.settlement.classification === "VOID") {
      voidCount += 1;
      continue;
    }
    classificationCounts[current.settlement.classification] += 1;
    priceSum = priceSum.add(price);
    counted.push({
      pick,
      kickoffEpoch,
      netReturn: current.netReturn,
    });
  }

  counted.sort((left, right) =>
    left.kickoffEpoch - right.kickoffEpoch
      || left.pick.pick_id.localeCompare(right.pick.pick_id));

  let cumulative = ExactDecimal.zero();
  let peak = ExactDecimal.zero();
  let maximumDrawdown = ExactDecimal.zero();
  const curve: PerformanceCurvePoint[] = [];
  for (const item of counted) {
    cumulative = cumulative.add(item.netReturn);
    if (cumulative.compare(peak) > 0) {
      peak = cumulative;
    }
    const drawdown = peak.subtract(cumulative);
    if (drawdown.compare(maximumDrawdown) > 0) {
      maximumDrawdown = drawdown;
    }
    curve.push({
      pick_id: item.pick.pick_id,
      kickoff_utc: item.pick.kickoff_utc,
      net_return: item.netReturn.toString(),
      cumulative_net_return: cumulative.toString(),
    });
  }

  const n = counted.length;
  return {
    pick_count: picks.length,
    settled_count: settledCount,
    pending_count: pendingCount,
    void_count: voidCount,
    n,
    classification_counts: classificationCounts,
    average_decimal_price: n === 0 ? null : formatRatioHalfUp(priceSum, BigInt(n), 1n),
    total_net_return: cumulative.toString(),
    roi_percent: n === 0 ? null : formatRatioHalfUp(cumulative, BigInt(n), 100n),
    maximum_drawdown: maximumDrawdown.toString(),
    cumulative_return_curve: curve,
  };
}
