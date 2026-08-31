import path from "node:path";
import {
  pipeline,
  env,
  type TextClassificationPipeline,
} from "@huggingface/transformers";
import type { EmotionScore, SentimentLabel } from "./types";

/**
 * Models
 * ------
 * Sentiment: CardiffNLP's twitter-roberta-base-sentiment-latest — a RoBERTa
 * trained on ~124M tweets and finetuned on the TweetEval sentiment benchmark.
 * It is the standard open-weights choice for short, informal, social text,
 * which is exactly what Reddit comments are. Served here as the ONNX port.
 *
 * Emotion: SamLowe/roberta-base-go_emotions — RoBERTa finetuned on Google's
 * GoEmotions corpus (58k human-annotated Reddit comments, 28 labels). It is
 * multi-label, so a comment can be both "annoyance" and "disapproval".
 */
export const SENTIMENT_MODEL = "Xenova/twitter-roberta-base-sentiment-latest";
export const EMOTION_MODEL = "SamLowe/roberta-base-go_emotions-onnx";

/** RoBERTa positional embeddings cap the usable window at 512 tokens. */
const MAX_TOKENS = 512;

/**
 * Batches are built to a token budget rather than a fixed count.
 *
 * The tokenizer pads every sequence in a batch to the longest one in it, so a
 * single 20k-character comment dragged into a batch of 16 short ones costs
 * more than all the other comments in the thread put together (measured: 6.3s
 * vs 5.4s for 110 short comments). Grouping by length and capping the padded
 * token count keeps batches wide when comments are short and narrow when they
 * are long. Measured on a 123-comment thread: 21.4 comments/s vs 3.3 with a
 * fixed batch of 16.
 *
 * Batched inference is not bit-identical to scoring one comment at a time,
 * because sequences are padded to the widest in their batch. Measured against
 * unpadded ground truth over 111 comments this costs ~0.015 mean absolute
 * polarity error with zero sentiment-label flips, and the error does not shrink
 * with narrower batches — so the widest, fastest setting is also the most
 * accurate one available.
 */
const TOKEN_BUDGET = 8192;
const MAX_BATCH = 128;

/** Rough tokens-per-character for English RoBERTa BPE, used only for grouping. */
const CHARS_PER_TOKEN = 3.6;

function estimateTokens(text: string): number {
  return Math.min(MAX_TOKENS, Math.ceil(text.length / CHARS_PER_TOKEN) + 2);
}

/**
 * Groups indices into batches of similar length, each within the padded token
 * budget. Returns indices so callers can restore the original order.
 */
function planBatches(texts: string[]): number[][] {
  const order = texts
    .map((_, index) => index)
    .sort((a, b) => estimateTokens(texts[a]) - estimateTokens(texts[b]));

  const batches: number[][] = [];
  let current: number[] = [];
  let widest = 0;

  for (const index of order) {
    const tokens = estimateTokens(texts[index]);
    const padded = Math.max(widest, tokens);
    if (
      current.length > 0 &&
      ((current.length + 1) * padded > TOKEN_BUDGET || current.length >= MAX_BATCH)
    ) {
      batches.push(current);
      current = [];
      widest = 0;
    }
    current.push(index);
    widest = Math.max(widest, tokens);
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/** GoEmotions is multi-label; below this a label is noise rather than signal. */
const EMOTION_THRESHOLD = 0.15;

/** Cache weights inside the project so a restart does not re-download them. */
env.cacheDir = process.env.MODEL_CACHE_DIR ?? path.join(process.cwd(), ".models");

export interface ModelLoadProgress {
  stage: string;
  message: string;
}

type Classifier = TextClassificationPipeline;

let sentimentPromise: Promise<Classifier> | null = null;
let emotionPromise: Promise<Classifier> | null = null;

/**
 * The sentiment repo ships `model_max_length: 1e30`, a HuggingFace sentinel
 * meaning "unset". The pipeline passes `truncation: true` but truncates
 * against that sentinel, so a long comment reaches the model at full length
 * and ONNX aborts with an invalid-expand-shape error. Pinning the real window
 * on the tokenizer config makes truncation actually apply.
 */
function enforceTokenLimit(classifier: Classifier): Classifier {
  const tokenizer = classifier.tokenizer as unknown as {
    _tokenizerConfig?: { model_max_length?: number };
    model_max_length?: number;
  };
  const current = tokenizer.model_max_length;
  if (tokenizer._tokenizerConfig && (!current || current > MAX_TOKENS)) {
    tokenizer._tokenizerConfig.model_max_length = MAX_TOKENS;
  }
  return classifier;
}

function loadSentiment(): Promise<Classifier> {
  sentimentPromise ??= pipeline("text-classification", SENTIMENT_MODEL, {
    dtype: "q8",
  }).then(enforceTokenLimit);
  return sentimentPromise;
}

function loadEmotion(): Promise<Classifier> {
  emotionPromise ??= pipeline("text-classification", EMOTION_MODEL, {
    dtype: "q8",
  }).then(enforceTokenLimit);
  return emotionPromise;
}

/**
 * Loads both models. First call downloads ~255MB of quantized weights; every
 * later call reuses the in-process singletons.
 */
export async function warmModels(
  onProgress?: (progress: ModelLoadProgress) => void,
): Promise<void> {
  onProgress?.({ stage: "model", message: "Loading sentiment model" });
  await loadSentiment();
  onProgress?.({ stage: "model", message: "Loading emotion model" });
  await loadEmotion();
}

export interface Prediction {
  sentiment: SentimentLabel;
  confidence: number;
  scores: Record<SentimentLabel, number>;
  polarity: number;
  emotions: EmotionScore[];
  dominantEmotion: string;
}

interface RawLabel {
  label: string;
  score: number;
}

function toRows(output: unknown, batchLength: number): RawLabel[][] {
  // The pipeline returns a flat array for a single input and a nested one for
  // a batch; normalize both to one row of labels per input.
  const arr = output as RawLabel[] | RawLabel[][];
  if (batchLength === 1 && arr.length && !Array.isArray(arr[0])) {
    return [arr as RawLabel[]];
  }
  return arr as RawLabel[][];
}

const SENTIMENT_LABELS: SentimentLabel[] = ["positive", "neutral", "negative"];

function isSentimentLabel(value: string): value is SentimentLabel {
  return (SENTIMENT_LABELS as string[]).includes(value);
}

/**
 * Reddit markdown carries a lot of tokens that mean nothing to the model.
 * Stripping them keeps the 512-token window on actual prose.
 */
export function cleanForModel(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")           // fenced code blocks
    .replace(/^\s*&gt;.*$/gm, " ")             // escaped blockquotes
    .replace(/^\s*>.*$/gm, " ")                // blockquotes (quoting others)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // links -> link text
    .replace(/https?:\/\/\S+/g, " ")           // bare urls
    .replace(/\/?u\/[A-Za-z0-9_-]+/g, " ")     // user mentions
    .replace(/\/?r\/[A-Za-z0-9_]+/g, " ")      // subreddit mentions
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Runs both models over `texts` in batches, reporting progress as it goes.
 * Returns one prediction per input, in the same order.
 */
export async function analyzeTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Prediction[]> {
  if (texts.length === 0) return [];

  const [sentimentModel, emotionModel] = await Promise.all([
    loadSentiment(),
    loadEmotion(),
  ]);

  // An empty string after cleaning still needs a slot in the output, and the
  // tokenizer rejects "", so substitute a neutral placeholder.
  const prepared = texts.map((text) => cleanForModel(text) || ".");

  // Indexed by original position, since batches are processed length-sorted.
  const predictions = new Array<Prediction>(prepared.length);
  let done = 0;

  for (const indices of planBatches(prepared)) {
    const batch = indices.map((index) => prepared[index]);

    const [sentimentOut, emotionOut] = await Promise.all([
      sentimentModel(batch, { top_k: 3 }),
      emotionModel(batch, { top_k: 6 }),
    ]);

    const sentimentRows = toRows(sentimentOut, batch.length);
    const emotionRows = toRows(emotionOut, batch.length);

    for (let j = 0; j < batch.length; j += 1) {
      const sentimentRow = sentimentRows[j] ?? [];
      const emotionRow = emotionRows[j] ?? [];

      const scores: Record<SentimentLabel, number> = {
        positive: 0,
        neutral: 0,
        negative: 0,
      };
      for (const entry of sentimentRow) {
        if (isSentimentLabel(entry.label)) scores[entry.label] = entry.score;
      }

      // top_k sorts descending, so the first entry is the winning label.
      const top = sentimentRow[0];
      const sentiment: SentimentLabel =
        top && isSentimentLabel(top.label) ? top.label : "neutral";

      const emotions = emotionRow
        .filter((entry) => entry.score >= EMOTION_THRESHOLD)
        .map((entry) => ({ label: entry.label, score: entry.score }));

      predictions[indices[j]] = {
        sentiment,
        confidence: top?.score ?? 0,
        scores,
        polarity: scores.positive - scores.negative,
        emotions,
        dominantEmotion: emotionRow[0]?.label ?? "neutral",
      };
    }

    done += batch.length;
    onProgress?.(done, prepared.length);
  }

  return predictions;
}
