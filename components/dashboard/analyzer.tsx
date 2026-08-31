"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowBigUp,
  Download,
  ExternalLink,
  Loader2,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Overview } from "./overview";
import { DepthChart, EmotionChart, SentimentSplit, TimelineChart } from "./charts";
import { CommentTable } from "./comment-table";
import { Highlights } from "./highlights";
import type { AnalysisResult, RedditPost, StreamEvent } from "@/lib/types";
import { formatDuration, formatNumber, formatRelativeTime } from "@/lib/format";

const EXAMPLES = [
  {
    label: "r/technology",
    url: "https://www.reddit.com/r/technology/comments/1cxvwgm/",
  },
];

interface Progress {
  stage: string;
  done: number;
  total: number;
}

function ThreadHeader({ post }: { post: RedditPost }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant="secondary" className="font-normal">
              r/{post.subreddit}
            </Badge>
            <span>u/{post.author}</span>
            <span>·</span>
            <span>{formatRelativeTime(post.createdUtc)}</span>
            {post.over18 ? (
              <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                NSFW
              </Badge>
            ) : null}
          </div>
          <h2 className="text-lg leading-snug font-semibold text-balance">{post.title}</h2>
          {post.selftext ? (
            <p className="text-muted-foreground mt-1.5 line-clamp-3 text-sm whitespace-pre-wrap">
              {post.selftext}
            </p>
          ) : null}
        </div>
        <div className="text-muted-foreground flex shrink-0 items-center gap-3 text-sm sm:flex-col sm:items-end sm:gap-1">
          <span className="inline-flex items-center gap-1">
            <ArrowBigUp className="size-4" />
            {formatNumber(post.score)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3.5" />
            {formatNumber(post.numComments)}
          </span>
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground inline-flex items-center gap-1"
            >
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function Analyzer() {
  const [url, setUrl] = useState("");
  const [sort, setSort] = useState("top");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [post, setPost] = useState<RedditPost | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (!url.trim() || running) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setError(null);
    setResult(null);
    setPost(null);
    setProgress(null);
    setStatus("Starting");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, sort }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? `Server returned HTTP ${response.status}.`);
      }

      // The route streams newline-delimited JSON so progress lands live.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          switch (event.type) {
            case "status":
              setStatus(event.message);
              break;
            case "post":
              setPost(event.post);
              break;
            case "progress":
              setProgress({ stage: event.stage, done: event.done, total: event.total });
              break;
            case "result":
              setResult(event.result);
              setProgress(null);
              break;
            case "error":
              setError({ message: event.message, hint: event.hint });
              break;
          }
        }
      }
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") {
        setError({ message: (caught as Error).message });
      }
    } finally {
      setRunning(false);
      setStatus("");
    }
  }, [url, sort, running]);

  const downloadCsv = useCallback(() => {
    if (!result) return;
    const escape = (value: string | number) =>
      `"${String(value).replace(/"/g, '""')}"`;
    const header = [
      "id",
      "author",
      "score",
      "depth",
      "created_utc",
      "sentiment",
      "confidence",
      "polarity",
      "p_positive",
      "p_neutral",
      "p_negative",
      "dominant_emotion",
      "emotions",
      "permalink",
      "body",
    ].join(",");

    const rows = result.comments.map((comment) =>
      [
        comment.id,
        comment.author,
        comment.score,
        comment.depth,
        comment.createdUtc,
        comment.sentiment,
        comment.confidence.toFixed(4),
        comment.polarity.toFixed(4),
        comment.scores.positive.toFixed(4),
        comment.scores.neutral.toFixed(4),
        comment.scores.negative.toFixed(4),
        comment.dominantEmotion,
        comment.emotions.map((item) => `${item.label}:${item.score.toFixed(3)}`).join(" "),
        comment.permalink,
        comment.body,
      ]
        .map(escape)
        .join(","),
    );

    const blob = new Blob([`${header}\n${rows.join("\n")}`], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `sentiment-${result.post.id}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [result]);

  const percent =
    progress && progress.total > 0
      ? Math.min(100, (progress.done / progress.total) * 100)
      : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void run();
              }}
              placeholder="https://www.reddit.com/r/subreddit/comments/..."
              className="h-10 flex-1 font-mono text-sm"
              disabled={running}
              aria-label="Reddit thread URL"
            />
            <Select
              value={sort}
              onValueChange={(value) => setSort(value ?? "top")}
              disabled={running}
            >
              <SelectTrigger className="h-10 sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="top">Top comments</SelectItem>
                <SelectItem value="best">Best</SelectItem>
                <SelectItem value="new">Newest</SelectItem>
                <SelectItem value="controversial">Controversial</SelectItem>
                <SelectItem value="old">Oldest</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => void run()} disabled={running || !url.trim()} className="h-10">
              {running ? (
                <>
                  <Loader2 className="animate-spin" />
                  Analyzing
                </>
              ) : (
                <>
                  <Sparkles />
                  Analyze thread
                </>
              )}
            </Button>
          </div>

          {!running && !result ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <span>Try:</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example.url}
                  type="button"
                  onClick={() => setUrl(example.url)}
                  className="hover:text-foreground underline underline-offset-2"
                >
                  {example.label}
                </button>
              ))}
              <span className="ml-auto">
                Any /comments/ link, share link, or bare post id works.
              </span>
            </div>
          ) : null}

          {running ? (
            <div className="space-y-1.5">
              <div className="text-muted-foreground flex items-center justify-between text-xs">
                <span>{status}</span>
                {progress && progress.total > 0 ? (
                  <span className="tabular-nums">
                    {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
                  </span>
                ) : null}
              </div>
              <Progress
                value={percent}
                className={percent === null ? "animate-pulse" : ""}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{error.message}</AlertTitle>
          {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
        </Alert>
      ) : null}

      {post && !result ? <ThreadHeader post={post} /> : null}

      {result ? (
        <div className="space-y-6">
          <ThreadHeader post={result.post} />

          {result.meta.truncatedByLimit || result.meta.unexpandedComments > 0 ? (
            <Alert>
              <AlertCircle />
              <AlertTitle>Partial comment coverage</AlertTitle>
              <AlertDescription>
                {result.meta.truncatedByLimit
                  ? `Analysis capped at ${formatNumber(result.analytics.analyzedComments)} comments. Raise MAX_COMMENTS in .env.local to go further.`
                  : `Reddit did not expand ${formatNumber(result.meta.unexpandedComments)} deeply-nested comments.`}
              </AlertDescription>
            </Alert>
          ) : null}

          <Overview result={result} />

          <Tabs defaultValue="charts">
            <div className="flex flex-wrap items-center gap-2">
              <TabsList>
                <TabsTrigger value="charts">Analytics</TabsTrigger>
                <TabsTrigger value="highlights">Highlights</TabsTrigger>
                <TabsTrigger value="comments">
                  Comments ({formatNumber(result.analytics.analyzedComments)})
                </TabsTrigger>
              </TabsList>
              <Button variant="outline" size="sm" onClick={downloadCsv} className="ml-auto">
                <Download />
                Export CSV
              </Button>
            </div>

            <TabsContent value="charts" className="mt-4 space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <SentimentSplit analytics={result.analytics} />
                <EmotionChart analytics={result.analytics} />
              </div>
              <TimelineChart analytics={result.analytics} />
              <DepthChart analytics={result.analytics} />
            </TabsContent>

            <TabsContent value="highlights" className="mt-4">
              <Highlights
                topPositive={result.analytics.topPositive}
                topNegative={result.analytics.topNegative}
                mostEngaged={result.analytics.mostEngaged}
                controversial={result.analytics.controversial}
              />
            </TabsContent>

            <TabsContent value="comments" className="mt-4">
              <CommentTable comments={result.comments} />
            </TabsContent>
          </Tabs>

          <Separator />
          <p className="text-muted-foreground text-xs">
            {formatNumber(result.analytics.analyzedComments)} comments scored in{" "}
            {formatDuration(result.meta.durationMs)} by{" "}
            <code className="font-mono">{result.meta.models.sentiment}</code> and{" "}
            <code className="font-mono">{result.meta.models.emotion}</code>, running locally
            via ONNX. No comment text left this machine.
          </p>
        </div>
      ) : null}
    </div>
  );
}
