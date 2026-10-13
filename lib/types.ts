export type SentimentLabel = "positive" | "neutral" | "negative";

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  selftext: string;
  score: number;
  upvoteRatio: number;
  numComments: number;
  createdUtc: number;
  permalink: string;
  url: string;
  over18: boolean;
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  depth: number;
  parentId: string;
  permalink: string;
  isSubmitter: boolean;
  controversiality: number;
}

export interface EmotionScore {
  label: string;
  score: number;
}

export interface AnalyzedComment extends RedditComment {
  sentiment: SentimentLabel;
  /** Confidence of the winning sentiment label, 0..1 */
  confidence: number;
  /** Full 3-class distribution from the model */
  scores: Record<SentimentLabel, number>;
  /** Signed polarity: p(positive) - p(negative), range -1..1 */
  polarity: number;
  /** Top emotions above threshold, descending */
  emotions: EmotionScore[];
  /** Highest-scoring emotion label (may be "neutral") */
  dominantEmotion: string;
}

export interface SentimentBreakdown {
  positive: number;
  neutral: number;
  negative: number;
}

export interface TimelinePoint {
  bucket: number;
  label: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  avgPolarity: number;
}

export interface DepthPoint {
  depth: number;
  total: number;
  avgPolarity: number;
  positive: number;
  neutral: number;
  negative: number;
}

export interface EmotionAggregate {
  label: string;
  /** Number of comments where this emotion was the dominant one */
  dominantCount: number;
  /** Number of comments where this emotion cleared the detection threshold */
  presentCount: number;
  /** Mean confidence across comments where present */
  avgScore: number;
  /** Sum of confidences, used for ranking intensity */
  intensity: number;
}

export interface Analytics {
  totalComments: number;
  analyzedComments: number;
  skippedComments: number;
  breakdown: SentimentBreakdown;
  breakdownPct: SentimentBreakdown;
  /** (pos - neg) / total, range -1..1 */
  netSentiment: number;
  /** Same as netSentiment but each comment weighted by its upvote score */
  weightedNetSentiment: number;
  meanPolarity: number;
  medianPolarity: number;
  polarityStdDev: number;
  /** 0..1, how evenly split the thread is between positive and negative */
  polarization: number;
  meanConfidence: number;
  emotions: EmotionAggregate[];
  timeline: TimelinePoint[];
  byDepth: DepthPoint[];
  topPositive: AnalyzedComment[];
  topNegative: AnalyzedComment[];
  mostEngaged: AnalyzedComment[];
  controversial: AnalyzedComment[];
  opSentiment: { count: number; netSentiment: number; breakdown: SentimentBreakdown } | null;
  /** Correlation between comment upvotes and polarity, -1..1 */
  scorePolarityCorrelation: number;
}

export interface AnalysisResult {
  post: RedditPost;
  postSentiment: AnalyzedComment | null;
  comments: AnalyzedComment[];
  analytics: Analytics;
  meta: {
    fetchedComments: number;
    truncatedByLimit: boolean;
    unexpandedComments: number;
    authMode: "oauth" | "anonymous";
    durationMs: number;
    models: { sentiment: string; emotion: string };
  };
}

/** Newline-delimited JSON events streamed from /api/analyze */
export type StreamEvent =
  | { type: "status"; stage: string; message: string }
  | { type: "post"; post: RedditPost }
  | { type: "progress"; done: number; total: number; stage: string }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; message: string; hint?: string };
