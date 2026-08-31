import type {
  AnalyzedComment,
  Analytics,
  DepthPoint,
  EmotionAggregate,
  SentimentBreakdown,
  TimelinePoint,
} from "./types";

function emptyBreakdown(): SentimentBreakdown {
  return { positive: 0, neutral: 0, negative: 0 };
}

function tally(comments: AnalyzedComment[]): SentimentBreakdown {
  const breakdown = emptyBreakdown();
  for (const comment of comments) breakdown[comment.sentiment] += 1;
  return breakdown;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

/** Pearson correlation; 0 when either series has no variance. */
function correlation(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

function buildTimeline(comments: AnalyzedComment[]): TimelinePoint[] {
  const timed = comments.filter((comment) => comment.createdUtc > 0);
  if (timed.length < 2) return [];

  const times = timed.map((comment) => comment.createdUtc);
  const start = Math.min(...times);
  const end = Math.max(...times);
  const span = end - start;
  if (span <= 0) return [];

  // Aim for ~24 buckets, but never finer than a minute.
  const bucketCount = Math.min(24, Math.max(4, Math.ceil(timed.length / 8)));
  const bucketSize = Math.max(60, Math.ceil(span / bucketCount));

  const buckets = new Map<number, AnalyzedComment[]>();
  for (const comment of timed) {
    const key = Math.floor((comment.createdUtc - start) / bucketSize);
    const existing = buckets.get(key);
    if (existing) existing.push(comment);
    else buckets.set(key, [comment]);
  }

  const useDates = span > 60 * 60 * 36;

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, bucketComments]) => {
      const bucketStart = (start + key * bucketSize) * 1000;
      const breakdown = tally(bucketComments);
      return {
        bucket: bucketStart,
        label: new Date(bucketStart).toLocaleString(undefined, {
          month: useDates ? "short" : undefined,
          day: useDates ? "numeric" : undefined,
          hour: "numeric",
          minute: useDates ? undefined : "2-digit",
        }),
        ...breakdown,
        total: bucketComments.length,
        avgPolarity: mean(bucketComments.map((comment) => comment.polarity)),
      };
    });
}

function buildDepthProfile(comments: AnalyzedComment[]): DepthPoint[] {
  const byDepth = new Map<number, AnalyzedComment[]>();
  for (const comment of comments) {
    // Everything past depth 6 is a long tail; fold it into one bucket.
    const depth = Math.min(comment.depth, 6);
    const existing = byDepth.get(depth);
    if (existing) existing.push(comment);
    else byDepth.set(depth, [comment]);
  }

  return [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, group]) => ({
      depth,
      total: group.length,
      avgPolarity: mean(group.map((comment) => comment.polarity)),
      ...tally(group),
    }));
}

function buildEmotionAggregates(comments: AnalyzedComment[]): EmotionAggregate[] {
  const stats = new Map<
    string,
    { dominantCount: number; presentCount: number; intensity: number }
  >();

  const bump = (label: string, score: number, dominant: boolean) => {
    const entry = stats.get(label) ?? {
      dominantCount: 0,
      presentCount: 0,
      intensity: 0,
    };
    entry.presentCount += 1;
    entry.intensity += score;
    if (dominant) entry.dominantCount += 1;
    stats.set(label, entry);
  };

  for (const comment of comments) {
    const seen = new Set<string>();
    for (const emotion of comment.emotions) {
      seen.add(emotion.label);
      bump(emotion.label, emotion.score, emotion.label === comment.dominantEmotion);
    }
    // A dominant emotion below the reporting threshold still counts once.
    if (!seen.has(comment.dominantEmotion)) {
      bump(comment.dominantEmotion, 0, true);
    }
  }

  return [...stats.entries()]
    .map(([label, entry]) => ({
      label,
      dominantCount: entry.dominantCount,
      presentCount: entry.presentCount,
      avgScore: entry.presentCount ? entry.intensity / entry.presentCount : 0,
      intensity: entry.intensity,
    }))
    .sort((a, b) => b.intensity - a.intensity);
}

function pct(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

export interface BuildAnalyticsOptions {
  /** Comments fetched but not analyzed (e.g. cut by the max-comments cap) */
  skipped?: number;
}

export function buildAnalytics(
  comments: AnalyzedComment[],
  options: BuildAnalyticsOptions = {},
): Analytics {
  const skipped = options.skipped ?? 0;
  const total = comments.length;
  const breakdown = tally(comments);
  const polarities = comments.map((comment) => comment.polarity);

  // Upvotes can be negative; clamp to >= 1 so a downvoted comment still counts
  // once rather than subtracting from the weighted total.
  const weights = comments.map((comment) => Math.max(1, comment.score));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let weightedSigned = 0;
  comments.forEach((comment, index) => {
    const direction =
      comment.sentiment === "positive" ? 1 : comment.sentiment === "negative" ? -1 : 0;
    weightedSigned += direction * weights[index];
  });

  // Polarization: how close the non-neutral comments are to a 50/50 split,
  // scaled by how much of the thread is non-neutral at all.
  const engaged = breakdown.positive + breakdown.negative;
  const balance =
    engaged === 0 ? 0 : 1 - Math.abs(breakdown.positive - breakdown.negative) / engaged;
  const polarization = total === 0 ? 0 : balance * (engaged / total);

  const opComments = comments.filter((comment) => comment.isSubmitter);
  const opBreakdown = tally(opComments);

  const byScore = [...comments].sort((a, b) => b.score - a.score);

  // Divisiveness = a strong opinion the thread did NOT reward. Ranking by raw
  // |polarity| alone would surface the most-upvoted comment in the thread,
  // which is the opposite of divisive, so weight it against how the comment
  // placed on votes relative to its peers.
  const scoreRank = new Map<string, number>();
  byScore.forEach((comment, index) => {
    // 1 = worst-voted comment in the thread, 0 = best-voted
    scoreRank.set(comment.id, total <= 1 ? 0 : index / (total - 1));
  });
  const divisiveness = (comment: AnalyzedComment) =>
    comment.controversiality * 2 +
    Math.abs(comment.polarity) * (scoreRank.get(comment.id) ?? 0);

  return {
    totalComments: total + skipped,
    analyzedComments: total,
    skippedComments: skipped,
    breakdown,
    breakdownPct: {
      positive: pct(breakdown.positive, total),
      neutral: pct(breakdown.neutral, total),
      negative: pct(breakdown.negative, total),
    },
    netSentiment: total === 0 ? 0 : (breakdown.positive - breakdown.negative) / total,
    weightedNetSentiment: weightTotal === 0 ? 0 : weightedSigned / weightTotal,
    meanPolarity: mean(polarities),
    medianPolarity: median(polarities),
    polarityStdDev: stdDev(polarities),
    polarization,
    meanConfidence: mean(comments.map((comment) => comment.confidence)),
    emotions: buildEmotionAggregates(comments),
    timeline: buildTimeline(comments),
    byDepth: buildDepthProfile(comments),
    topPositive: [...comments]
      .filter((comment) => comment.sentiment === "positive")
      .sort((a, b) => b.polarity - a.polarity || b.score - a.score)
      .slice(0, 5),
    topNegative: [...comments]
      .filter((comment) => comment.sentiment === "negative")
      .sort((a, b) => a.polarity - b.polarity || b.score - a.score)
      .slice(0, 5),
    mostEngaged: byScore.slice(0, 5),
    controversial: [...comments]
      .filter(
        (comment) =>
          comment.controversiality > 0 ||
          // Opinionated, and voted below the middle of the thread
          (Math.abs(comment.polarity) > 0.5 && (scoreRank.get(comment.id) ?? 0) > 0.5),
      )
      .sort((a, b) => divisiveness(b) - divisiveness(a))
      .slice(0, 5),
    opSentiment: opComments.length
      ? {
          count: opComments.length,
          netSentiment:
            (opBreakdown.positive - opBreakdown.negative) / opComments.length,
          breakdown: opBreakdown,
        }
      : null,
    scorePolarityCorrelation: correlation(
      comments.map((comment) => comment.score),
      polarities,
    ),
  };
}
