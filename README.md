# Sentiment Lens

Paste a Reddit thread URL, get every comment scored for **sentiment** and **emotion**, plus
thread-level analytics. Two open-weights RoBERTa models run locally in the Node process via
ONNX — no inference API, no model API key, and no comment text ever leaves your machine.
(You do need free Reddit API credentials to *fetch* the comments — see below.)

## Getting started

**Prerequisites:** Node.js 20.9+ (developed on 24.x) and npm 10+.

```bash
git clone https://github.com/evelynlieu1/sentimen-analytics-.git
cd sentimen-analytics-
npm install                    # ~360 packages, includes the ONNX runtime
cp .env.example .env.local     # then add your Reddit credentials — see below
npm run dev                    # http://localhost:3000
```

The **first** thread you analyse downloads ~245MB of model weights into `.models/`. That
happens once; every run after it is instant. Nothing else is downloaded at runtime.

---

## The one thing you have to do

Reddit blocks almost all anonymous API reads now, so you need free API credentials. This
takes about two minutes and is the only manual step:

1. Go to <https://www.reddit.com/prefs/apps> and click **create another app...**
2. Fill in:
   - **name** — anything, e.g. `sentiment-lens`
   - **type** — select **script**
   - **redirect uri** — `http://localhost:3000`
3. Click **create app**. You now have:
   - the **client id** — the short string directly under the app name
   - the **secret** — the field labelled `secret`
4. Create your local env file from the template — `.env.local` is gitignored, so a fresh
   clone will not have one:

```bash
cp .env.example .env.local     # Windows PowerShell: copy .env.example .env.local
```

5. Fill in the two values you just got:

```env
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_USER_AGENT=nodejs:sentiment-lens:v1.0.0 (by /u/your_username)
```

6. Restart `npm run dev`. Next.js only reads env files at startup.

The app runs without credentials and will try Reddit's public JSON endpoint first, but that
path returns HTTP 403 from most networks. The UI tells you clearly when this happens.

---

## What it does

**Input** — any Reddit thread reference:

| Form | Example |
| --- | --- |
| Full URL | `https://www.reddit.com/r/technology/comments/abc123/some_title/` |
| Comment permalink | `.../comments/abc123/some_title/def456/` |
| Old Reddit | `https://old.reddit.com/r/.../comments/abc123/...` |
| Share link | `https://www.reddit.com/r/tech/s/AbCdEf` (redirect is followed) |
| Short link | `https://redd.it/abc123` |
| Bare post id | `abc123` or `t3_abc123` |

**Pipeline** — `POST /api/analyze` streams newline-delimited JSON so the UI shows live
progress instead of hanging on one long request:

```
status  → parse / fetch / model / analyze stage messages
post    → thread metadata, rendered before scoring finishes
progress→ {done, total} during fetch and inference
result  → the full AnalysisResult payload
error   → {message, hint} — always actionable
```

The fetcher walks the entire comment forest, expands the collapsed
*"load more comments"* stubs 100 ids at a time via `/api/morechildren`, drops
deleted/removed comments, and records depth for every reply. If Reddit refuses to expand
some deep chains, the shortfall is reported in the UI rather than silently hidden.

**Output** — a dashboard with:

- Net sentiment index, upvote-weighted sentiment, polarization, mean/median polarity,
  model confidence, and the correlation between upvotes and mood
- Sentiment split, emotional profile (28 GoEmotions labels, coloured by valence),
  mood over the life of the thread, and average polarity by reply depth
- Highlights: most positive, most negative, most upvoted, and most divisive
- Every comment in a searchable, sortable, filterable table
- CSV export with full per-comment probability distributions

---

## Models

| Role | Model | Why |
| --- | --- | --- |
| Sentiment | [`Xenova/twitter-roberta-base-sentiment-latest`](https://huggingface.co/Xenova/twitter-roberta-base-sentiment-latest) | ONNX port of CardiffNLP's TweetEval model — RoBERTa pretrained on ~124M tweets, finetuned for 3-class sentiment. The standard open-weights choice for short, informal text. |
| Emotion | [`SamLowe/roberta-base-go_emotions-onnx`](https://huggingface.co/SamLowe/roberta-base-go_emotions-onnx) | RoBERTa finetuned on Google's GoEmotions — 58k human-annotated **Reddit** comments across 28 emotions. Trained on exactly this domain, and multi-label, so a comment can be both `annoyance` and `disapproval`. |

Both are loaded as `q8`-quantized ONNX (~245MB total, downloaded once on first analysis and
cached in `.models/`). They are process-wide singletons, so only the first run pays the
~20s load cost.

Each comment gets:

- `sentiment` — `positive` / `neutral` / `negative`, plus the full softmax distribution
- `polarity` — `p(positive) - p(negative)`, a signed −1..1 score used for all averaging
- `emotions` — the model's top 6 GoEmotions labels, keeping those above 0.15 confidence, descending

---

## Notes on accuracy

- **Truncation.** RoBERTa's window is 512 tokens. The sentiment repo ships
  `model_max_length: 1e30` (HuggingFace's "unset" sentinel), so the pipeline's
  `truncation: true` silently does nothing and long comments crash ONNX with an
  invalid-expand-shape error. `lib/sentiment.ts` pins the real limit on the tokenizer
  config. A 21,000-character comment scores fine.
- **Batching.** Sequences are padded to the widest in their batch, so one very long comment
  dragged into a batch of short ones costs more than the rest of the thread combined.
  Batches are therefore grouped by length under a token budget — measured at 21 comments/s
  versus 3.3 with a naive fixed batch.
- **Batched vs single inference.** Padding makes batched results differ slightly from
  scoring one comment at a time: measured at ~0.015 mean absolute polarity error over 111
  comments, with zero sentiment-label flips. Narrower batches do not reduce it.
- **What the models can't do.** Sarcasm, in-jokes, and heavily context-dependent replies are
  genuinely hard, and no sentiment model reads them reliably. Watch the *model confidence*
  metric — when it drops below ~60%, treat the thread's numbers as directional only.

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `REDDIT_CLIENT_ID` | — | Reddit app client id |
| `REDDIT_CLIENT_SECRET` | — | Reddit app secret |
| `REDDIT_USER_AGENT` | `nodejs:sentiment-lens:v1.0.0 (thread sentiment analysis)` | Sent on every Reddit request |
| `MAX_COMMENTS` | `1500` | Safety cap per run; the UI reports when it's hit |
| `MODEL_CACHE_DIR` | `./.models` | Where ONNX weights are cached |

## Layout

```
app/
  page.tsx                    landing + credential warning
  layout.tsx                  fonts, metadata, TooltipProvider
  globals.css                 Tailwind v4 theme + sentiment colour tokens
  api/analyze/route.ts        NDJSON streaming endpoint
lib/
  reddit.ts                   URL parsing, OAuth, comment-tree flattening, more-expansion
  sentiment.ts                model singletons, length-bucketed batching, inference
  analytics.ts                all thread-level aggregation
  format.ts                   display helpers, sentiment/emotion colour mapping
  types.ts                    shared types incl. the stream event union
  utils.ts                    shadcn `cn` helper
components/
  dashboard/analyzer.tsx      URL form, stream consumer, tabs, CSV export
  dashboard/overview.tsx      the eight headline metric cards
  dashboard/charts.tsx        sentiment split, emotions, timeline, depth
  dashboard/comment-table.tsx searchable/sortable per-comment table
  dashboard/highlights.tsx    most positive / negative / upvoted / divisive
  ui/                         shadcn primitives (generated — edit with care)
```

## Contributing

```bash
npm run lint       # eslint
npx tsc --noEmit   # typecheck
npm run build      # production build — run this before opening a PR
```

Both lint and typecheck are clean on `main`; please keep them that way.

Where to start if you want to extend it:

- **New metric** — add it to `Analytics` in `lib/types.ts`, compute it in
  `buildAnalytics()` in `lib/analytics.ts`, then surface it in
  `components/dashboard/overview.tsx`.
- **New chart** — add a component to `components/dashboard/charts.tsx` and render it in the
  `charts` tab of `analyzer.tsx`.
- **Different model** — swap the id in `lib/sentiment.ts`. It must be an ONNX model on the
  HuggingFace Hub with a `text-classification` head. Check whether its
  `tokenizer_config.json` sets a real `model_max_length` — see the truncation note above.
- **Comment coverage** — `MAX_COMMENTS` caps a run; the fetcher and UI already report what
  they had to leave out.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Recharts ·
Transformers.js v4 on onnxruntime-node

Inference needs the Node runtime — `onnxruntime-node` is a native addon and cannot run on
edge. Deploy targets must allow native modules and a writable model cache (or bake
`.models/` into the image).
