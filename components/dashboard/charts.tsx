"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Analytics, SentimentLabel } from "@/lib/types";
import {
  SENTIMENT_COLORS,
  emotionColor,
  formatPercent,
  formatSigned,
  titleCase,
} from "@/lib/format";

const AXIS = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: unknown }>;
  label?: string | number;
  formatter?: (value: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-md">
      {label !== undefined ? <div className="mb-1 font-medium">{label}</div> : null}
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-[2px]"
            style={{ background: entry.color ?? "var(--foreground)" }}
          />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">
            {formatter && typeof entry.value === "number"
              ? formatter(entry.value, entry.name ?? "")
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SentimentSplit({ analytics }: { analytics: Analytics }) {
  const order: SentimentLabel[] = ["positive", "neutral", "negative"];
  const total = analytics.analyzedComments;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sentiment split</CardTitle>
        <CardDescription>
          Every comment classified into one of three labels by the TweetEval RoBERTa head.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Single stacked bar reads faster than a pie for a 3-way split */}
        <div className="bg-muted flex h-8 w-full overflow-hidden rounded-md">
          {order.map((label) => {
            const value = analytics.breakdown[label];
            const percent = total ? (value / total) * 100 : 0;
            if (percent === 0) return null;
            return (
              <div
                key={label}
                className="flex items-center justify-center text-[11px] font-medium text-white transition-all"
                style={{ width: `${percent}%`, background: SENTIMENT_COLORS[label] }}
                title={`${titleCase(label)}: ${value} (${percent.toFixed(1)}%)`}
              >
                {percent > 8 ? `${percent.toFixed(0)}%` : null}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {order.map((label) => (
            <div key={label} className="rounded-md border p-2.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ background: SENTIMENT_COLORS[label] }}
                />
                <span className="text-muted-foreground text-xs">{titleCase(label)}</span>
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {analytics.breakdown[label]}
              </div>
              <div className="text-muted-foreground text-xs tabular-nums">
                {formatPercent(analytics.breakdownPct[label], 1)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function EmotionChart({ analytics }: { analytics: Analytics }) {
  const data = analytics.emotions
    .filter((emotion) => emotion.label !== "neutral")
    .slice(0, 12)
    .map((emotion) => ({
      label: titleCase(emotion.label),
      raw: emotion.label,
      comments: emotion.presentCount,
      avg: emotion.avgScore,
    }));

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Emotional profile</CardTitle>
          <CardDescription>No emotion cleared the detection threshold.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Emotional profile</CardTitle>
        <CardDescription>
          Comments per emotion from GoEmotions (28 labels, multi-label — one comment can
          register several). Green is positive-valence, red negative, grey ambiguous.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(220, data.length * 26)}>
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" {...AXIS} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={96}
              {...AXIS}
              tickLine={false}
              axisLine={false}
            />
            <RechartsTooltip
              cursor={{ fill: "var(--muted)" }}
              content={<ChartTooltip formatter={(value) => `${value} comments`} />}
            />
            <Bar dataKey="comments" name="Comments" radius={[0, 4, 4, 0]}>
              {data.map((entry) => (
                <Cell key={entry.raw} fill={emotionColor(entry.raw)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function TimelineChart({ analytics }: { analytics: Analytics }) {
  if (analytics.timeline.length < 2) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mood over the life of the thread</CardTitle>
        <CardDescription>
          Average polarity per time bucket. Above the line the room is warming, below it
          the thread is souring.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={analytics.timeline} margin={{ left: -16, right: 12, top: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" {...AXIS} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              domain={[-1, 1]}
              {...AXIS}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => value.toFixed(1)}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            <RechartsTooltip
              content={
                <ChartTooltip
                  formatter={(value, name) =>
                    name === "Avg polarity" ? formatSigned(value) : String(value)
                  }
                />
              }
            />
            <Line
              type="monotone"
              dataKey="avgPolarity"
              name="Avg polarity"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="total"
              name="Comments"
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="4 3"
              dot={false}
              yAxisId="count"
            />
            <YAxis yAxisId="count" hide domain={[0, "dataMax"]} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function DepthChart({ analytics }: { analytics: Analytics }) {
  if (analytics.byDepth.length < 2) return null;

  const data = analytics.byDepth.map((point) => ({
    ...point,
    name: point.depth === 0 ? "Top level" : point.depth === 6 ? "6+ deep" : `Reply ${point.depth}`,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Does it get nastier deeper down?</CardTitle>
        <CardDescription>
          Average polarity by reply depth. A downward slope means arguments sour as they
          go back and forth.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ left: -16, right: 12, top: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" {...AXIS} tickLine={false} axisLine={false} />
            <YAxis
              {...AXIS}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => value.toFixed(1)}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" />
            <RechartsTooltip
              cursor={{ fill: "var(--muted)" }}
              content={<ChartTooltip formatter={(value) => formatSigned(value)} />}
            />
            <Bar dataKey="avgPolarity" name="Avg polarity" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell
                  key={entry.depth}
                  fill={
                    entry.avgPolarity >= 0.05
                      ? SENTIMENT_COLORS.positive
                      : entry.avgPolarity <= -0.05
                        ? SENTIMENT_COLORS.negative
                        : SENTIMENT_COLORS.neutral
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
