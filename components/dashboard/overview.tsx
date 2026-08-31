"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { AnalysisResult } from "@/lib/types";
import {
  SENTIMENT_TEXT,
  describeMood,
  formatNumber,
  formatPercent,
  formatSigned,
  titleCase,
} from "@/lib/format";

function Metric({
  label,
  value,
  hint,
  tone,
  sub,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
  sub?: string;
}) {
  return (
    <Card className="gap-0 py-4">
      <CardHeader className="px-4 pb-1">
        <CardTitle className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
          {label}
          <Tooltip>
            <TooltipTrigger aria-label={`What is ${label}?`}>
              <Info className="size-3 opacity-50" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[16rem]">{hint}</TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
        {sub ? <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export function Overview({ result }: { result: AnalysisResult }) {
  const { analytics, meta, postSentiment } = result;
  const mood = describeMood(analytics.netSentiment);
  const topEmotion = analytics.emotions[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Overall mood"
          value={mood.label}
          tone={SENTIMENT_TEXT[mood.tone]}
          hint="Verdict derived from the net sentiment index: (positive - negative) / total comments."
          sub={`Net index ${formatSigned(analytics.netSentiment)}`}
        />
        <Metric
          label="Comments analyzed"
          value={formatNumber(analytics.analyzedComments)}
          hint="Comments actually scored by the model. Deleted and removed comments are excluded because they have no text."
          sub={
            meta.unexpandedComments > 0
              ? `${formatNumber(meta.unexpandedComments)} not expanded by Reddit`
              : "Full comment tree expanded"
          }
        />
        <Metric
          label="Upvote-weighted"
          value={formatSigned(analytics.weightedNetSentiment)}
          tone={SENTIMENT_TEXT[describeMood(analytics.weightedNetSentiment).tone]}
          hint="Net sentiment with each comment weighted by its upvotes, so the room's loudest-endorsed opinions count more. Differs from the raw index when the crowd upvotes one side."
          sub={
            Math.abs(analytics.weightedNetSentiment - analytics.netSentiment) > 0.08
              ? "Upvotes favour one side"
              : "Tracks the raw index"
          }
        />
        <Metric
          label="Polarization"
          value={formatPercent(analytics.polarization * 100)}
          hint="How evenly the thread splits between positive and negative. 100% means a near-perfect two-sided fight; 0% means one-sided or entirely neutral."
          sub={
            analytics.polarization > 0.5
              ? "Thread is genuinely divided"
              : "Mostly one-sided or neutral"
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Dominant emotion"
          value={topEmotion ? titleCase(topEmotion.label) : "—"}
          hint="Emotion with the highest total confidence across all comments, from the 28-label GoEmotions taxonomy."
          sub={
            topEmotion
              ? `Detected in ${formatNumber(topEmotion.presentCount)} comments`
              : undefined
          }
        />
        <Metric
          label="Mean polarity"
          value={formatSigned(analytics.meanPolarity)}
          hint="Average of p(positive) - p(negative) per comment. Unlike the net index this uses the model's full probability distribution, so mildly-positive comments count less than emphatic ones."
          sub={`Median ${formatSigned(analytics.medianPolarity)} · spread ${analytics.polarityStdDev.toFixed(2)}`}
        />
        <Metric
          label="Model confidence"
          value={formatPercent(analytics.meanConfidence * 100)}
          hint="Average confidence in the winning sentiment label. Below ~60% means the thread is full of ambiguous or sarcastic text the model finds hard to call."
          sub={analytics.meanConfidence < 0.6 ? "Low — read results loosely" : "Healthy"}
        />
        <Metric
          label="Upvotes vs mood"
          value={formatSigned(analytics.scorePolarityCorrelation)}
          hint="Correlation between a comment's upvotes and its polarity. Positive means the crowd rewards positive comments; negative means negativity gets upvoted."
          sub={
            analytics.scorePolarityCorrelation > 0.15
              ? "Positivity gets upvoted"
              : analytics.scorePolarityCorrelation < -0.15
                ? "Negativity gets upvoted"
                : "No clear relationship"
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {postSentiment ? (
          <Badge variant="outline" className="font-normal">
            Post itself:{" "}
            <span className={SENTIMENT_TEXT[postSentiment.sentiment]}>
              {postSentiment.sentiment}
            </span>
          </Badge>
        ) : null}
        {analytics.opSentiment ? (
          <Badge variant="outline" className="font-normal">
            OP replied {analytics.opSentiment.count}× · net{" "}
            <span className={SENTIMENT_TEXT[describeMood(analytics.opSentiment.netSentiment).tone]}>
              {formatSigned(analytics.opSentiment.netSentiment)}
            </span>
          </Badge>
        ) : null}
        <Badge variant="outline" className="font-normal">
          {meta.authMode === "oauth" ? "Reddit OAuth API" : "Reddit public JSON"}
        </Badge>
      </div>
    </div>
  );
}
