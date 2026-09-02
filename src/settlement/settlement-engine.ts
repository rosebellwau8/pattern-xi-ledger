import { ExactDecimal, sumExactDecimalStrings } from "./exact-decimal.ts";

export type Selection = "HOME" | "AWAY";
export type ComponentResult = "WIN" | "PUSH" | "LOSS";
export type SettlementClassification =
  | "WIN"
  | "HALF_WIN"
  | "PUSH"
  | "HALF_LOSS"
  | "LOSS"
  | "VOID";

export interface FrozenAsianHandicap {
  selection: Selection;
  line: string;
  normalized_decimal_price: string;
  frozen_scheduled_kickoff_at?: string;
}

export type InterruptionDisposition =
  | "RESUMED_SAME_FIXTURE"
  | "REPLAYED_FROM_ZERO"
  | "ABANDONED_FINAL"
  | "UNKNOWN";

export interface SettlementFacts {
  match_status: "FINISHED" | "POSTPONED" | "CANCELLED" | "ABANDONED";
  final_status?: "FINISHED";
  home_score?: number;
  away_score?: number;
  actual_kickoff_at?: string;
  regulation_completed_at?: string | null;
  status_determined_at?: string;
  interruption_disposition?: InterruptionDisposition;
  official_evidence_refs?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SettlementComponent {
  line: string;
  result: ComponentResult;
}

export interface SettlementResult {
  components: SettlementComponent[];
  classification: SettlementClassification | null;
  net_return: string | null;
  record_state: "SETTLED" | "PENDING";
}

const LINE = /^([+-]?)([0-9]+)\.([0-9]{2})$/u;
const HOURS_48 = 48 * 60 * 60 * 1000;
const HOURS_168 = 168 * 60 * 60 * 1000;

function timestamp(value: string | undefined, code: string): number {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  if (value === undefined || !value.endsWith("Z") || !Number.isFinite(parsed)) {
    throw new Error(code);
  }
  return parsed;
}

function lineCents(value: string): bigint {
  const match = LINE.exec(value);
  if (match === null) throw new Error("HANDICAP_LINE_INVALID");
  const sign = match[1] === "-" ? -1n : 1n;
  const cents = sign * (BigInt(match[2]!) * 100n + BigInt(match[3]!));
  if (cents % 25n !== 0n) throw new Error("HANDICAP_LINE_NOT_QUARTER");
  return cents;
}

function formatLine(cents: bigint): string {
  if (cents === 0n) return "0.00";
  const sign = cents > 0n ? "+" : "-";
  const absolute = cents > 0n ? cents : -cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function componentLines(cents: bigint): bigint[] {
  if ((cents < 0n ? -cents : cents) % 50n !== 25n) return [cents];
  return cents < 0n ? [cents + 25n, cents - 25n] : [cents - 25n, cents + 25n];
}

function componentResult(
  official: FrozenAsianHandicap,
  cents: bigint,
  homeScore: number,
  awayScore: number,
): ComponentResult {
  const goalDifference = official.selection === "HOME"
    ? homeScore - awayScore
    : awayScore - homeScore;
  const adjustedQuarters = BigInt(goalDifference) * 4n + cents / 25n;
  return adjustedQuarters > 0n ? "WIN" : adjustedQuarters < 0n ? "LOSS" : "PUSH";
}

function classification(results: readonly ComponentResult[]): Exclude<SettlementClassification, "VOID"> {
  const wins = results.filter((value) => value === "WIN").length;
  const pushes = results.filter((value) => value === "PUSH").length;
  const losses = results.filter((value) => value === "LOSS").length;
  if (wins === results.length) return "WIN";
  if (losses === results.length) return "LOSS";
  if (pushes === results.length) return "PUSH";
  if (wins > 0 && pushes > 0) return "HALF_WIN";
  if (losses > 0 && pushes > 0) return "HALF_LOSS";
  throw new Error("HANDICAP_COMPONENT_COMBINATION_INVALID");
}

function returnFor(
  value: Exclude<SettlementClassification, "VOID">,
  price: string,
): string {
  const profit = ExactDecimal.parse(price).subtract(ExactDecimal.parse("1"));
  switch (value) {
    case "WIN": return profit.toString();
    case "HALF_WIN": return profit.divideByTwo().toString();
    case "PUSH": return "0";
    case "HALF_LOSS": return "-0.5";
    case "LOSS": return "-1";
  }
}

function voidResult(): SettlementResult {
  return { components: [], classification: "VOID", net_return: "0", record_state: "SETTLED" };
}

function pendingResult(): SettlementResult {
  return { components: [], classification: null, net_return: null, record_state: "PENDING" };
}

function scores(facts: SettlementFacts): { home: number; away: number } {
  if (!Number.isInteger(facts.home_score) || !Number.isInteger(facts.away_score) ||
      (facts.home_score as number) < 0 || (facts.away_score as number) < 0) {
    throw new Error("REGULATION_SCORE_REQUIRED");
  }
  return { home: facts.home_score as number, away: facts.away_score as number };
}

function settleScore(official: FrozenAsianHandicap, facts: SettlementFacts): SettlementResult {
  ExactDecimal.parse(official.normalized_decimal_price);
  const score = scores(facts);
  const components = componentLines(lineCents(official.line)).map((line) => ({
    line: formatLine(line),
    result: componentResult(official, line, score.home, score.away),
  }));
  const settledClassification = classification(components.map((value) => value.result));
  return {
    components,
    classification: settledClassification,
    net_return: returnFor(settledClassification, official.normalized_decimal_price),
    record_state: "SETTLED",
  };
}

export function evaluateSettlement(
  official: FrozenAsianHandicap,
  facts: SettlementFacts,
): SettlementResult {
  switch (facts.match_status) {
    case "FINISHED": {
      if (official.frozen_scheduled_kickoff_at !== undefined &&
          facts.actual_kickoff_at !== undefined) {
        const frozen = timestamp(official.frozen_scheduled_kickoff_at,
          "FROZEN_KICKOFF_REQUIRED");
        const actual = timestamp(facts.actual_kickoff_at, "ACTUAL_KICKOFF_REQUIRED");
        if (actual > frozen + HOURS_48) return voidResult();
      }
      return settleScore(official, facts);
    }
    case "POSTPONED": {
      const frozen = timestamp(official.frozen_scheduled_kickoff_at, "FROZEN_KICKOFF_REQUIRED");
      if (facts.actual_kickoff_at === undefined) {
        const determined = timestamp(facts.status_determined_at, "STATUS_DETERMINED_AT_REQUIRED");
        return determined > frozen + HOURS_48 ? voidResult() : pendingResult();
      }
      const actual = timestamp(facts.actual_kickoff_at, "ACTUAL_KICKOFF_REQUIRED");
      if (actual > frozen + HOURS_48) return voidResult();
      if (facts.final_status !== "FINISHED") return pendingResult();
      return settleScore(official, facts);
    }
    case "CANCELLED":
      return voidResult();
    case "ABANDONED": {
      const actual = timestamp(facts.actual_kickoff_at, "ACTUAL_KICKOFF_REQUIRED");
      switch (facts.interruption_disposition) {
        case "RESUMED_SAME_FIXTURE": {
          const completed = timestamp(facts.regulation_completed_at ?? undefined,
            "REGULATION_COMPLETED_AT_REQUIRED");
          return completed <= actual + HOURS_48 ? settleScore(official, facts) : voidResult();
        }
        case "REPLAYED_FROM_ZERO":
        case "ABANDONED_FINAL":
          return voidResult();
        case "UNKNOWN": {
          const determined = timestamp(facts.status_determined_at, "STATUS_DETERMINED_AT_REQUIRED");
          return determined >= actual + HOURS_168 ? voidResult() : pendingResult();
        }
        default:
          throw new Error("INTERRUPTION_DISPOSITION_REQUIRED");
      }
    }
  }
}

export function sumExactDecimals(values: readonly string[]): string {
  return sumExactDecimalStrings(values);
}

export function formatPublicDecimal(value: string): string {
  return ExactDecimal.parse(value).formatFixedThreeHalfUp();
}
