"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, ExternalLink, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AnalyzedComment, SentimentLabel } from "@/lib/types";
import {
  SENTIMENT_BADGE,
  formatRelativeTime,
  formatSigned,
  titleCase,
} from "@/lib/format";

type SortKey = "polarity" | "score" | "confidence" | "createdUtc";

const PAGE_SIZE = 25;

/** Hoisted so the header cells are not remounted on every keystroke. */
function SortButton({
  label,
  sortBy,
  activeKey,
  onSort,
}: {
  label: string;
  sortBy: SortKey;
  activeKey: SortKey;
  onSort: (key: SortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortBy)}
      className="hover:text-foreground -mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors"
    >
      {label}
      <ArrowUpDown className={`size-3 ${activeKey === sortBy ? "opacity-100" : "opacity-30"}`} />
    </button>
  );
}

export function CommentTable({ comments }: { comments: AnalyzedComment[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SentimentLabel | "all">("all");
  const [emotion, setEmotion] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [ascending, setAscending] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const emotionOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const comment of comments) {
      for (const item of comment.emotions) labels.add(item.label);
    }
    return [...labels].sort();
  }, [comments]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = comments.filter((comment) => {
      if (filter !== "all" && comment.sentiment !== filter) return false;
      if (emotion !== "all" && !comment.emotions.some((item) => item.label === emotion)) {
        return false;
      }
      if (
        needle &&
        !comment.body.toLowerCase().includes(needle) &&
        !comment.author.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });

    const direction = ascending ? 1 : -1;
    return filtered.sort((a, b) => (a[sortKey] - b[sortKey]) * direction);
  }, [comments, query, filter, emotion, sortKey, ascending]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setAscending((value) => !value);
    } else {
      setSortKey(key);
      setAscending(false);
    }
    setVisible(PAGE_SIZE);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Every comment, scored</CardTitle>
        <CardDescription>
          {rows.length.toLocaleString()} of {comments.length.toLocaleString()} comments
          shown. Search, filter by label or emotion, and sort any column.
        </CardDescription>
        <div className="flex flex-col gap-2 pt-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisible(PAGE_SIZE);
              }}
              placeholder="Search comment text or author"
              className="h-9 pl-8"
            />
          </div>
          <Select
            value={filter}
            onValueChange={(value) => {
              setFilter((value ?? "all") as SentimentLabel | "all");
              setVisible(PAGE_SIZE);
            }}
          >
            <SelectTrigger className="h-9 sm:w-[150px]">
              <SelectValue placeholder="Sentiment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sentiment</SelectItem>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={emotion}
            onValueChange={(value) => {
              setEmotion(value ?? "all");
              setVisible(PAGE_SIZE);
            }}
          >
            <SelectTrigger className="h-9 sm:w-[160px]">
              <SelectValue placeholder="Emotion" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All emotions</SelectItem>
              {emotionOptions.map((label) => (
                <SelectItem key={label} value={label}>
                  {titleCase(label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-[320px]">Comment</TableHead>
                <TableHead className="w-[110px]">Sentiment</TableHead>
                <TableHead className="w-[120px]">Emotions</TableHead>
                <TableHead className="w-[92px] text-right">
                  <SortButton
                    label="Polarity"
                    sortBy="polarity"
                    activeKey={sortKey}
                    onSort={toggleSort}
                  />
                </TableHead>
                <TableHead className="w-[92px] text-right">
                  <SortButton
                    label="Conf."
                    sortBy="confidence"
                    activeKey={sortKey}
                    onSort={toggleSort}
                  />
                </TableHead>
                <TableHead className="w-[80px] text-right">
                  <SortButton
                    label="Votes"
                    sortBy="score"
                    activeKey={sortKey}
                    onSort={toggleSort}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground h-24 text-center">
                    No comments match those filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.slice(0, visible).map((comment) => (
                  <TableRow key={comment.id} className="align-top">
                    <TableCell className="max-w-[520px] py-3">
                      <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
                        <span className="text-foreground font-medium">
                          u/{comment.author}
                        </span>
                        {comment.isSubmitter ? (
                          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                            OP
                          </Badge>
                        ) : null}
                        <span>·</span>
                        <span>{formatRelativeTime(comment.createdUtc)}</span>
                        {comment.depth > 0 ? (
                          <>
                            <span>·</span>
                            <span>depth {comment.depth}</span>
                          </>
                        ) : null}
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
                      <p className="line-clamp-4 text-sm leading-relaxed whitespace-pre-wrap">
                        {comment.body}
                      </p>
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={`font-normal ${SENTIMENT_BADGE[comment.sentiment]}`}
                      >
                        {comment.sentiment}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex flex-wrap gap-1">
                        {comment.emotions.slice(0, 3).map((item) => (
                          <Badge
                            key={item.label}
                            variant="secondary"
                            className="h-5 px-1.5 text-[10px] font-normal"
                            title={`${item.label}: ${(item.score * 100).toFixed(0)}%`}
                          >
                            {item.label}
                          </Badge>
                        ))}
                        {comment.emotions.length === 0 ? (
                          <span className="text-muted-foreground text-xs">-</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="py-3 text-right text-sm tabular-nums">
                      {formatSigned(comment.polarity)}
                    </TableCell>
                    <TableCell className="text-muted-foreground py-3 text-right text-sm tabular-nums">
                      {(comment.confidence * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell className="py-3 text-right text-sm tabular-nums">
                      {comment.score.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {visible < rows.length ? (
          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisible((value) => value + PAGE_SIZE * 2)}
            >
              Show more ({(rows.length - visible).toLocaleString()} remaining)
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
