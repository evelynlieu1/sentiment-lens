"use client";

import { ArrowBigUp, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyzedComment } from "@/lib/types";
import { SENTIMENT_BADGE, formatSigned } from "@/lib/format";

function CommentRow({ comment }: { comment: AnalyzedComment }) {
  return (
    <li className="border-b pb-3 last:border-0 last:pb-0">
      <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
        <span className="text-foreground font-medium">u/{comment.author}</span>
        {comment.isSubmitter ? (
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
            OP
          </Badge>
        ) : null}
        <span className="inline-flex items-center gap-0.5">
          <ArrowBigUp className="size-3.5" />
          {comment.score.toLocaleString()}
        </span>
        <Badge
          variant="outline"
          className={`h-4 px-1 text-[10px] font-normal ${SENTIMENT_BADGE[comment.sentiment]}`}
        >
          {formatSigned(comment.polarity)}
        </Badge>
        {comment.permalink ? (
          <a
            href={comment.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground ml-auto"
            aria-label="Open comment on Reddit"
          >
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
      <p className="line-clamp-3 text-sm leading-relaxed">{comment.body}</p>
      {comment.emotions.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {comment.emotions.slice(0, 3).map((emotion) => (
            <Badge
              key={emotion.label}
              variant="secondary"
              className="h-4 px-1.5 text-[10px] font-normal"
            >
              {emotion.label} {(emotion.score * 100).toFixed(0)}%
            </Badge>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function HighlightCard({
  title,
  description,
  comments,
}: {
  title: string;
  description: string;
  comments: AnalyzedComment[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {comments.length === 0 ? (
          <p className="text-muted-foreground text-sm">None found in this thread.</p>
        ) : (
          <ul className="space-y-3">
            {comments.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function Highlights({
  topPositive,
  topNegative,
  mostEngaged,
  controversial,
}: {
  topPositive: AnalyzedComment[];
  topNegative: AnalyzedComment[];
  mostEngaged: AnalyzedComment[];
  controversial: AnalyzedComment[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <HighlightCard
        title="Most positive"
        description="Highest positive polarity in the thread."
        comments={topPositive}
      />
      <HighlightCard
        title="Most negative"
        description="Highest negative polarity in the thread."
        comments={topNegative}
      />
      <HighlightCard
        title="Most upvoted"
        description="What the room actually endorsed, regardless of tone."
        comments={mostEngaged}
      />
      <HighlightCard
        title="Most divisive"
        description="Flagged controversial by Reddit, or strong opinions the crowd did not reward."
        comments={controversial}
      />
    </div>
  );
}
