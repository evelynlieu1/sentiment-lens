import type { NextRequest } from "next/server";
import { fetchThread, parseThreadUrl, RedditError } from "@/lib/reddit";
import {
  analyzeTexts,
  warmModels,
  EMOTION_MODEL,
  SENTIMENT_MODEL,
} from "@/lib/sentiment";
import { buildAnalytics } from "@/lib/analytics";
import type { AnalyzedComment, StreamEvent } from "@/lib/types";

// onnxruntime-node is a native addon, so this route cannot run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_COMMENTS = Number(process.env.MAX_COMMENTS ?? 1500);

export async function POST(request: NextRequest) {
  let body: { url?: string; sort?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url : "";
  if (!url.trim()) {
    return Response.json({ error: "Provide a Reddit thread URL." }, { status: 400 });
  }

  const sort = (["top", "best", "new", "controversial", "old"] as const).find(
    (option) => option === body.sort,
  );

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({ type: "status", stage: "parse", message: "Reading thread URL" });
        const parsed = await parseThreadUrl(url);

        send({ type: "status", stage: "fetch", message: "Fetching comments from Reddit" });
        const thread = await fetchThread(parsed, {
          maxComments: MAX_COMMENTS,
          sort: sort ?? "top",
          onProgress: (fetched) => {
            send({
              type: "progress",
              stage: "fetch",
              done: fetched,
              total: Math.max(fetched, 0),
            });
          },
        });

        send({ type: "post", post: thread.post });

        if (thread.comments.length === 0) {
          send({
            type: "error",
            message: "That thread has no readable comments.",
            hint: "Every comment was deleted, removed, or the thread is empty.",
          });
          return;
        }

        send({
          type: "status",
          stage: "model",
          message: "Loading models (first run downloads ~255MB)",
        });
        await warmModels((progress) =>
          send({ type: "status", stage: progress.stage, message: progress.message }),
        );

        send({
          type: "status",
          stage: "analyze",
          message: `Analyzing ${thread.comments.length} comments`,
        });

        // The post itself is scored too, but kept out of the comment stats so
        // it cannot skew the crowd's mood.
        const postText = `${thread.post.title}\n\n${thread.post.selftext}`.trim();
        const texts = [postText, ...thread.comments.map((comment) => comment.body)];

        const predictions = await analyzeTexts(texts, (done, total) => {
          send({
            type: "progress",
            stage: "analyze",
            done: Math.max(0, done - 1),
            total: total - 1,
          });
        });

        const [postPrediction, ...commentPredictions] = predictions;

        const analyzed: AnalyzedComment[] = thread.comments.map((comment, index) => ({
          ...comment,
          ...commentPredictions[index],
        }));

        const postSentiment: AnalyzedComment | null = postPrediction
          ? {
              id: thread.post.id,
              author: thread.post.author,
              body: postText,
              score: thread.post.score,
              createdUtc: thread.post.createdUtc,
              depth: -1,
              parentId: "",
              permalink: thread.post.permalink,
              isSubmitter: true,
              controversiality: 0,
              ...postPrediction,
            }
          : null;

        send({
          type: "result",
          result: {
            post: thread.post,
            postSentiment,
            comments: analyzed,
            analytics: buildAnalytics(analyzed),
            meta: {
              fetchedComments: thread.comments.length,
              truncatedByLimit: thread.truncatedByLimit,
              unexpandedComments: thread.unexpanded,
              authMode: thread.authMode,
              durationMs: Date.now() - startedAt,
              models: { sentiment: SENTIMENT_MODEL, emotion: EMOTION_MODEL },
            },
          },
        });
      } catch (error) {
        if (error instanceof RedditError) {
          send({ type: "error", message: error.message, hint: error.hint });
        } else {
          const message =
            error instanceof Error ? error.message : "Unexpected failure during analysis.";
          console.error("[analyze]", error);
          send({ type: "error", message });
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
