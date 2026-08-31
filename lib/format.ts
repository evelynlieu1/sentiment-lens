import type { SentimentLabel } from "./types";

export const SENTIMENT_COLORS: Record<SentimentLabel, string> = {
  positive: "var(--positive)",
  neutral: "var(--neutral)",
  negative: "var(--negative)",
};

export const SENTIMENT_TEXT: Record<SentimentLabel, string> = {
  positive: "text-[var(--positive)]",
  neutral: "text-[var(--neutral)]",
  negative: "text-[var(--negative)]",
};

export const SENTIMENT_BADGE: Record<SentimentLabel, string> = {
  positive:
    "bg-[var(--positive-soft)] text-[var(--positive)] border-[var(--positive)]/25",
  neutral: "bg-[var(--neutral-soft)] text-[var(--neutral)] border-[var(--neutral)]/25",
  negative:
    "bg-[var(--negative-soft)] text-[var(--negative)] border-[var(--negative)]/25",
};

/** Emotions grouped by valence, used to color the emotion charts. */
const POSITIVE_EMOTIONS = new Set([
  "admiration",
  "amusement",
  "approval",
  "caring",
  "desire",
  "excitement",
  "gratitude",
  "joy",
  "love",
  "optimism",
  "pride",
  "relief",
]);

const NEGATIVE_EMOTIONS = new Set([
  "anger",
  "annoyance",
  "disappointment",
  "disapproval",
  "disgust",
  "embarrassment",
  "fear",
  "grief",
  "nervousness",
  "remorse",
  "sadness",
]);

export function emotionValence(label: string): SentimentLabel {
  if (POSITIVE_EMOTIONS.has(label)) return "positive";
  if (NEGATIVE_EMOTIONS.has(label)) return "negative";
  return "neutral";
}

export function emotionColor(label: string): string {
  return SENTIMENT_COLORS[emotionValence(label)];
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function formatSigned(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function formatRelativeTime(unixSeconds: number): string {
  if (!unixSeconds) return "unknown";
  const deltaSeconds = Math.floor(Date.now() / 1000) - unixSeconds;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds) {
      return formatter.format(-Math.round(deltaSeconds / seconds), unit);
    }
  }
  return formatter.format(-deltaSeconds, "second");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Turns the net-sentiment index into a plain-language verdict. */
export function describeMood(net: number): { label: string; tone: SentimentLabel } {
  if (net >= 0.35) return { label: "Strongly positive", tone: "positive" };
  if (net >= 0.12) return { label: "Leaning positive", tone: "positive" };
  if (net > -0.12) return { label: "Mixed / neutral", tone: "neutral" };
  if (net > -0.35) return { label: "Leaning negative", tone: "negative" };
  return { label: "Strongly negative", tone: "negative" };
}
