/**
 * Twitter/X API v2 backend
 *
 * - OAuth 2.0 with PKCE (user context)
 * - Tweet creation with media upload
 * - Thread support (reply chain)
 * - Character limit handling (280 chars)
 * - Rate limit awareness
 * - Metrics via tweet lookup endpoint
 */

import type {
  SocialBackend,
  SocialCredentials,
  SocialPost,
  SocialResult,
  SocialMetrics,
} from "./types.js";

const TWITTER_API = "https://api.twitter.com/2";
const UPLOAD_API = "https://upload.twitter.com/1.1";
const MAX_TWEET_LENGTH = 280;

export class TwitterBackend implements SocialBackend {
  name = "twitter";
  private accessToken = "";

  async authenticate(credentials: SocialCredentials): Promise<void> {
    this.accessToken = credentials.accessToken;
    // Validate token with a /users/me call
    const res = await this.apiGet("/users/me");
    if (!res.data?.id) {
      throw new Error("Twitter: authentication failed — invalid access token");
    }
  }

  async publish(post: SocialPost): Promise<SocialResult> {
    // Thread mode: publish each tweet as a reply chain
    if (post.thread && post.thread.length > 0) {
      return this.publishThread(post);
    }

    const text = this.formatTweet(post);
    const mediaIds = post.media ? await this.uploadMedia(post.media) : [];

    const body: Record<string, unknown> = { text };
    if (mediaIds.length > 0) {
      body.media = { media_ids: mediaIds };
    }

    const res = await this.apiPost("/tweets", body);
    if (!res.data?.id) {
      throw new Error(`Twitter: failed to create tweet — ${JSON.stringify(res)}`);
    }

    return {
      platform: "twitter",
      postId: res.data.id,
      url: `https://x.com/i/status/${res.data.id}`,
      publishedAt: new Date(),
    };
  }

  async schedule(post: SocialPost, publishAt: Date): Promise<SocialResult> {
    // Twitter API v2 doesn't have native scheduling for user context.
    // Store the intent and return a placeholder — actual scheduling
    // would need an external scheduler (cron job / k8s CronJob).
    const delay = publishAt.getTime() - Date.now();
    if (delay <= 0) {
      return this.publish(post);
    }
    throw new Error(
      `Twitter: native scheduling not available via API v2. ` +
      `Use an external scheduler. Requested time: ${publishAt.toISOString()}`
    );
  }

  async delete(postId: string): Promise<void> {
    const res = await this.apiDelete(`/tweets/${postId}`);
    if (!res.data?.deleted) {
      throw new Error(`Twitter: failed to delete tweet ${postId}`);
    }
  }

  async metrics(postId: string): Promise<SocialMetrics> {
    const res = await this.apiGet(
      `/tweets/${postId}?tweet.fields=public_metrics,non_public_metrics,organic_metrics`
    );
    const pub = res.data?.public_metrics ?? {};
    const nonPub = res.data?.non_public_metrics ?? {};

    const impressions = nonPub.impression_count ?? pub.impression_count ?? 0;
    const likes = pub.like_count ?? 0;
    const shares = pub.retweet_count ?? 0;
    const comments = pub.reply_count ?? 0;
    const clicks = nonPub.url_link_clicks ?? 0;

    const total = impressions || 1;
    return {
      impressions,
      clicks,
      likes,
      shares,
      comments,
      engagementRate: ((likes + shares + comments + clicks) / total) * 100,
    };
  }

  // ---------- Internal helpers ----------

  private formatTweet(post: SocialPost): string {
    let text = post.text;
    if (post.hashtags?.length) {
      const tags = post.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
      text = `${text}\n\n${tags}`;
    }
    if (post.link) {
      text = `${text}\n\n${post.link}`;
    }
    // Auto-truncate if over limit, preserving the link
    if (text.length > MAX_TWEET_LENGTH) {
      const suffix = post.link ? `…\n\n${post.link}` : "…";
      const maxContent = MAX_TWEET_LENGTH - suffix.length;
      text = text.slice(0, maxContent) + suffix;
    }
    return text;
  }

  private async publishThread(post: SocialPost): Promise<SocialResult> {
    const tweets = [post.text, ...(post.thread ?? [])];
    let previousId: string | undefined;
    let firstId = "";

    for (const tweetText of tweets) {
      const body: Record<string, unknown> = { text: tweetText };
      if (previousId) {
        body.reply = { in_reply_to_tweet_id: previousId };
      }
      const res = await this.apiPost("/tweets", body);
      if (!res.data?.id) {
        throw new Error(`Twitter: failed to post thread tweet — ${JSON.stringify(res)}`);
      }
      if (!firstId) firstId = res.data.id;
      previousId = res.data.id;

      // Respect rate limits between thread tweets
      await sleep(1000);
    }

    return {
      platform: "twitter",
      postId: firstId,
      url: `https://x.com/i/status/${firstId}`,
      publishedAt: new Date(),
    };
  }

  private async uploadMedia(
    media: { url: string; alt?: string }[]
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const item of media) {
      // Download the media
      const mediaRes = await fetch(item.url);
      if (!mediaRes.ok) {
        throw new Error(`Twitter: failed to download media from ${item.url}`);
      }
      const blob = await mediaRes.blob();
      const contentType = mediaRes.headers.get("content-type") ?? "application/octet-stream";

      // INIT
      const initRes = await this.uploadApiPost("/media/upload.json", {
        command: "INIT",
        total_bytes: blob.size,
        media_type: contentType,
      });
      const mediaId = initRes.media_id_string;

      // APPEND (single chunk for simplicity; extend for large files)
      const formData = new FormData();
      formData.append("command", "APPEND");
      formData.append("media_id", mediaId);
      formData.append("segment_index", "0");
      formData.append("media", blob);
      await fetch(`${UPLOAD_API}/media/upload.json`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.accessToken}` },
        body: formData,
      });

      // FINALIZE
      await this.uploadApiPost("/media/upload.json", {
        command: "FINALIZE",
        media_id: mediaId,
      });

      // Alt text
      if (item.alt) {
        await this.apiPost("/tweets", {}); // placeholder — alt text uses v1.1:
        await fetch(`${UPLOAD_API}/media/metadata/create.json`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            media_id: mediaId,
            alt_text: { text: item.alt },
          }),
        });
      }

      ids.push(mediaId);
    }
    return ids;
  }

  private async apiGet(path: string): Promise<Record<string, any>> {
    const res = await fetch(`${TWITTER_API}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    await this.handleRateLimit(res);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Twitter API GET ${path}: ${res.status} — ${body}`);
    }
    return res.json();
  }

  private async apiPost(path: string, body: unknown): Promise<Record<string, any>> {
    const res = await fetch(`${TWITTER_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    await this.handleRateLimit(res);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twitter API POST ${path}: ${res.status} — ${text}`);
    }
    return res.json();
  }

  private async apiDelete(path: string): Promise<Record<string, any>> {
    const res = await fetch(`${TWITTER_API}${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    await this.handleRateLimit(res);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twitter API DELETE ${path}: ${res.status} — ${text}`);
    }
    return res.json();
  }

  private async uploadApiPost(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
    const res = await fetch(`${UPLOAD_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twitter Upload API POST ${path}: ${res.status} — ${text}`);
    }
    return res.json();
  }

  private async handleRateLimit(res: Response): Promise<void> {
    const remaining = res.headers.get("x-rate-limit-remaining");
    const resetAt = res.headers.get("x-rate-limit-reset");
    if (res.status === 429 && resetAt) {
      const waitMs = (parseInt(resetAt, 10) * 1000) - Date.now() + 1000;
      if (waitMs > 0 && waitMs < 900_000) { // max 15 min wait
        console.warn(`Twitter: rate limited, waiting ${Math.ceil(waitMs / 1000)}s...`);
        await sleep(waitMs);
      } else {
        throw new Error(
          `Twitter: rate limited. Reset at ${new Date(parseInt(resetAt, 10) * 1000).toISOString()}`
        );
      }
    }
    if (remaining === "0" && resetAt) {
      console.warn(`Twitter: rate limit nearly exhausted, consider slowing down`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
