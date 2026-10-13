import type { RedditComment, RedditPost } from "./types";

const USER_AGENT =
  process.env.REDDIT_USER_AGENT ??
  "nodejs:sentiment-lens:v1.0.0 (thread sentiment analysis)";

export class RedditError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "RedditError";
    this.hint = hint;
  }
}

/* ------------------------------------------------------------------ */
/* URL parsing                                                         */
/* ------------------------------------------------------------------ */

export interface ParsedThread {
  postId: string;
  /** Set when the URL points at a specific comment permalink */
  focusCommentId?: string;
  subreddit?: string;
}

const BASE36 = /^[a-z0-9]+$/i;

/**
 * Accepts every thread URL shape Reddit hands out, plus a bare post id:
 *   /r/sub/comments/<id>/slug/          /comments/<id>
 *   /r/sub/comments/<id>/slug/<cid>/    redd.it/<id>
 *   /r/sub/s/<shortcode>  (resolved by following the redirect)
 */
export async function parseThreadUrl(input: string): Promise<ParsedThread> {
  const raw = input.trim();
  if (!raw) throw new RedditError("No URL provided.");

  // Bare post id, e.g. "1abcdef" or "t3_1abcdef"
  const bare = raw.replace(/^t3_/, "");
  if (!raw.includes("/") && BASE36.test(bare) && bare.length >= 5 && bare.length <= 10) {
    return { postId: bare };
  }

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new RedditError(`"${input}" is not a valid URL.`);
  }

  const host = url.hostname.toLowerCase();
  if (!/(^|\.)reddit\.com$/.test(host) && host !== "redd.it") {
    throw new RedditError(
      `${url.hostname} is not a Reddit domain.`,
      "Paste a link that starts with https://www.reddit.com/r/",
    );
  }

  // Short link: https://redd.it/<id>
  if (host === "redd.it") {
    const id = url.pathname.replace(/\//g, "");
    if (!id) throw new RedditError("That redd.it link has no post id.");
    return { postId: id };
  }

  const segments = url.pathname.split("/").filter(Boolean);

  // Share link: /r/<sub>/s/<code>, only resolvable by following the redirect
  const shareIdx = segments.indexOf("s");
  if (shareIdx !== -1 && segments[shareIdx - 2] === "r") {
    return parseThreadUrl(await resolveShareLink(url.toString()));
  }

  const idx = segments.indexOf("comments");
  if (idx === -1 || !segments[idx + 1]) {
    throw new RedditError(
      "That link does not point at a Reddit thread.",
      "A thread URL contains /comments/ - e.g. reddit.com/r/AskReddit/comments/abc123/title/",
    );
  }

  const postId = segments[idx + 1];
  // segments: r, <sub>, comments, <postId>, <slug>, <commentId>
  const focusCommentId = segments[idx + 3];

  return {
    postId,
    focusCommentId:
      focusCommentId && BASE36.test(focusCommentId) ? focusCommentId : undefined,
    subreddit: segments[0] === "r" ? segments[1] : undefined,
  };
}

async function resolveShareLink(shareUrl: string): Promise<string> {
  const res = await fetch(shareUrl, {
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.url.includes("/comments/")) {
    throw new RedditError(
      `That share link did not resolve to a thread (HTTP ${res.status}).`,
      "Open it in a browser and paste the full /comments/ URL instead.",
    );
  }
  return res.url;
}

/* ------------------------------------------------------------------ */
/* Auth - app-only OAuth when credentials exist, anonymous otherwise   */
/* ------------------------------------------------------------------ */

let tokenCache: { token: string; expiresAt: number } | null = null;

export function hasCredentials(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

async function getAccessToken(): Promise<string | null> {
  if (!hasCredentials()) return null;
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const basic = Buffer.from(
    `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RedditError(
      `Reddit rejected the API credentials (HTTP ${res.status}).`,
      body.includes("invalid_grant")
        ? "The client id and secret must come from the same app at reddit.com/prefs/apps."
        : "Check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env.local, then restart the dev server.",
    );
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: json.access_token,
    // Refresh a minute early so a long run cannot race token expiry
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  return tokenCache.token;
}

export type AuthMode = "oauth" | "anonymous";

interface RedditFetchResult<T> {
  data: T;
  authMode: AuthMode;
}

/** Fetches a Reddit API path, preferring OAuth and falling back to public JSON. */
async function redditFetch<T>(
  path: string,
  params: Record<string, string>,
): Promise<RedditFetchResult<T>> {
  const token = await getAccessToken();
  const query = new URLSearchParams({ raw_json: "1", ...params }).toString();

  if (token) {
    const res = await fetch(`https://oauth.reddit.com${path}?${query}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    if (res.ok) return { data: (await res.json()) as T, authMode: "oauth" };
    if (res.status === 404) {
      throw new RedditError("That thread does not exist or was deleted.");
    }
    if (res.status === 403) {
      throw new RedditError(
        "Reddit denied access to that thread.",
        "It may be in a private, quarantined, or banned subreddit.",
      );
    }
    // Any other OAuth failure falls through to an anonymous attempt
  }

  const res = await fetch(`https://www.reddit.com${path}.json?${query}`, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });

  if (res.status === 403 || res.status === 429) {
    throw new RedditError(
      token
        ? `Reddit blocked the request (HTTP ${res.status}).`
        : "Reddit blocked this anonymous request (HTTP 403).",
      token
        ? "You are likely rate limited - wait a minute and retry."
        : "Reddit blocks most anonymous API reads. Add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to .env.local (see README) and restart the dev server.",
    );
  }
  if (res.status === 404) {
    throw new RedditError("That thread does not exist or was deleted.");
  }
  if (!res.ok) throw new RedditError(`Reddit returned HTTP ${res.status}.`);

  return { data: (await res.json()) as T, authMode: "anonymous" };
}

/* ------------------------------------------------------------------ */
/* Raw listing shapes (only the fields we consume)                     */
/* ------------------------------------------------------------------ */

interface RawThing<T> {
  kind: string;
  data: T;
}

interface RawPost {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  selftext: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
  url: string;
  over_18: boolean;
}

interface RawComment {
  id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  depth?: number;
  parent_id: string;
  permalink?: string;
  is_submitter?: boolean;
  controversiality?: number;
  replies?: RawListing | "";
}

interface RawMore {
  id: string;
  name: string;
  parent_id: string;
  depth: number;
  count: number;
  children: string[];
}

type RawChild = RawThing<RawComment | RawMore | RawPost>;

interface RawListing {
  kind: "Listing";
  data: { children: RawChild[]; after: string | null };
}

const DELETED = new Set(["[deleted]", "[removed]", ""]);

function normalizePost(raw: RawPost): RedditPost {
  return {
    id: raw.id,
    title: raw.title ?? "",
    author: raw.author ?? "[unknown]",
    subreddit: raw.subreddit ?? "",
    selftext: raw.selftext ?? "",
    score: raw.score ?? 0,
    upvoteRatio: raw.upvote_ratio ?? 0,
    numComments: raw.num_comments ?? 0,
    createdUtc: raw.created_utc ?? 0,
    permalink: raw.permalink ? `https://www.reddit.com${raw.permalink}` : "",
    url: raw.url ?? "",
    over18: Boolean(raw.over_18),
  };
}

function normalizeComment(raw: RawComment, fallbackDepth: number): RedditComment | null {
  const body = (raw.body ?? "").trim();
  if (DELETED.has(body)) return null;
  return {
    id: raw.id,
    author: raw.author ?? "[unknown]",
    body,
    score: raw.score ?? 0,
    createdUtc: raw.created_utc ?? 0,
    depth: raw.depth ?? fallbackDepth,
    parentId: raw.parent_id ?? "",
    permalink: raw.permalink ? `https://www.reddit.com${raw.permalink}` : "",
    isSubmitter: Boolean(raw.is_submitter),
    controversiality: raw.controversiality ?? 0,
  };
}

/** Depth-first walk of the comment forest, collecting `more` stubs as it goes. */
function walkComments(
  children: RawChild[],
  depth: number,
  out: RedditComment[],
  moreIds: string[],
): void {
  for (const child of children) {
    if (child.kind === "more") {
      const more = child.data as RawMore;
      // "continue this thread" stubs carry no ids to expand
      if (more.children?.length) moreIds.push(...more.children);
      continue;
    }
    if (child.kind !== "t1") continue;

    const raw = child.data as RawComment;
    const normalized = normalizeComment(raw, depth);
    if (normalized) out.push(normalized);

    const replies = raw.replies;
    if (replies && typeof replies === "object" && replies.data?.children) {
      walkComments(replies.data.children, depth + 1, out, moreIds);
    }
  }
}

export interface FetchThreadOptions {
  /** Hard cap on comments collected; the shortfall is reported, not hidden */
  maxComments?: number;
  sort?: "top" | "best" | "new" | "controversial" | "old" | "qa";
  onProgress?: (fetched: number) => void;
}

export interface FetchThreadResult {
  post: RedditPost;
  comments: RedditComment[];
  authMode: AuthMode;
  truncatedByLimit: boolean;
  /** Comments Reddit refused to expand (deep chains / rate limits) */
  unexpanded: number;
}

/** Fetches a thread and flattens its entire comment forest. */
export async function fetchThread(
  parsed: ParsedThread,
  options: FetchThreadOptions = {},
): Promise<FetchThreadResult> {
  const { maxComments = 1500, sort = "top", onProgress } = options;

  const { data, authMode } = await redditFetch<[RawListing, RawListing]>(
    `/comments/${parsed.postId}`,
    { limit: "500", depth: "20", sort, threaded: "true" },
  );

  if (!Array.isArray(data) || data.length < 2) {
    throw new RedditError("Reddit returned an unexpected response for that thread.");
  }

  const postThing = data[0].data.children[0];
  if (!postThing) throw new RedditError("That thread has no post data.");
  const post = normalizePost(postThing.data as RawPost);

  const comments: RedditComment[] = [];
  const moreIds: string[] = [];
  walkComments(data[1].data.children, 0, comments, moreIds);
  onProgress?.(comments.length);

  // Expand collapsed "load more comments" stubs, 100 ids per request.
  let unexpanded = 0;
  const seen = new Set(comments.map((c) => c.id));
  const queue = [...moreIds];

  while (queue.length && comments.length < maxComments) {
    const batch = queue.splice(0, 100);
    let things: RawChild[];
    try {
      const res = await redditFetch<{
        json?: { data?: { things?: RawChild[] } };
      }>("/api/morechildren", {
        api_type: "json",
        link_id: `t3_${post.id}`,
        children: batch.join(","),
        sort,
        limit_children: "false",
      });
      things = res.data.json?.data?.things ?? [];
    } catch {
      // Expansion is best effort: report the shortfall instead of failing the run
      unexpanded += batch.length + queue.length;
      queue.length = 0;
      break;
    }

    for (const thing of things) {
      if (thing.kind === "more") {
        const more = thing.data as RawMore;
        if (more.children?.length) queue.push(...more.children);
        continue;
      }
      if (thing.kind !== "t1") continue;
      const raw = thing.data as RawComment;
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      const normalized = normalizeComment(raw, raw.depth ?? 0);
      if (normalized) comments.push(normalized);
    }
    onProgress?.(comments.length);
  }

  unexpanded += queue.length;

  const truncatedByLimit = comments.length > maxComments;
  return {
    post,
    comments: truncatedByLimit ? comments.slice(0, maxComments) : comments,
    authMode,
    truncatedByLimit,
    unexpanded,
  };
}
