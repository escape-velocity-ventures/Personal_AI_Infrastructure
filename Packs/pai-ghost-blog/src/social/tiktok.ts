/**
 * TikTok Content Posting API backend
 *
 * - OAuth 2.0 Bearer token auth
 * - Video-only content (no image posts)
 * - Character limit: 2200 chars for descriptions
 * - No native scheduling API
 * - Metrics via /v2/video/query/ endpoint
 * - Privacy defaults to SELF_ONLY (safest default)
 *
 * Requires: TikTok Developer App with video.publish + video.list scopes
 * API docs: https://developers.tiktok.com/doc/content-posting-api-get-started
 *
 * Error format: { error: { code: string, message: string, log_id: string } }
 */

import type {
  SocialBackend,
  SocialCredentials,
  SocialPost,
  SocialResult,
  SocialMetrics,
} from "./types.js";

const TIKTOK_API = "https://open.tiktokapis.com/v2";
const MAX_CAPTION_LENGTH = 2200;

export class TikTokBackend implements SocialBackend {
  name = "tiktok";
  private accessToken = "";
  private openId = "";

  async authenticate(credentials: SocialCredentials): Promise<void> {
    this.accessToken = credentials.accessToken;

    const res = await this.apiGet(
      "/user/info/",
      { fields: "open_id,display_name" }
    );

    const openId = res?.data?.user?.open_id;
    if (!openId) {
      throw new Error("TikTok: authentication failed — could not retrieve open_id");
    }
    this.openId = openId;
  }

  async publish(post: SocialPost): Promise<SocialResult> {
    // TikTok only supports video content
    const video = post.media?.find(
      (m) => m.type === "video" || m.type === "reel"
    );
    if (!video) {
      return {
        success: false,
        platform: "tiktok",
        error:
          "TikTok only supports video content. Provide at least one media item with type 'video' or 'reel'.",
      };
    }

    const caption = this.formatCaption(post);

    const body = {
      post_info: {
        title: caption,
        privacy_level: "SELF_ONLY",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: video.url,
      },
    };

    const res = await this.apiPost("/post/publish/", body);

    const publishId = res?.data?.publish_id;
    if (!publishId) {
      throw new Error(
        `TikTok: failed to publish video — ${JSON.stringify(res)}`
      );
    }

    return {
      success: true,
      platform: "tiktok",
      postId: publishId,
      publishedAt: new Date(),
    };
  }

  async schedule(
    _post: SocialPost,
    _publishAt: Date
  ): Promise<SocialResult> {
    return {
      success: false,
      platform: "tiktok",
      error:
        "TikTok Content Posting API does not support native scheduling. Use an external scheduler (cron job / queue consumer).",
    };
  }

  async delete(_postId: string): Promise<void> {
    throw new Error(
      "TikTok: content deletion is not supported via the Content Posting API. " +
      "Videos can only be deleted through the TikTok app."
    );
  }

  async metrics(postId: string): Promise<SocialMetrics> {
    const res = await this.apiPost("/video/query/", {
      filters: {
        video_ids: [postId],
      },
    });

    const videos = res?.data?.videos ?? [];
    if (videos.length === 0) {
      return {
        impressions: 0,
        clicks: 0,
        likes: 0,
        shares: 0,
        comments: 0,
        engagementRate: 0,
        videoViews: 0,
      };
    }

    const video = videos[0];
    const views = video.view_count ?? 0;
    const likes = video.like_count ?? 0;
    const comments = video.comment_count ?? 0;
    const shares = video.share_count ?? 0;

    const total = views || 1;
    return {
      impressions: views,
      clicks: 0, // TikTok doesn't expose click data via this endpoint
      likes,
      shares,
      comments,
      engagementRate: ((likes + shares + comments) / total) * 100,
      videoViews: views,
    };
  }

  // ---------- Internal helpers ----------

  private formatCaption(post: SocialPost): string {
    let text = post.text;
    if (post.hashtags?.length) {
      const tags = post.hashtags
        .map((t) => (t.startsWith("#") ? t : `#${t}`))
        .join(" ");
      text = `${text}\n\n${tags}`;
    }
    if (text.length > MAX_CAPTION_LENGTH) {
      text = text.slice(0, MAX_CAPTION_LENGTH - 3) + "...";
    }
    return text;
  }

  private async apiGet(
    path: string,
    params?: Record<string, string>
  ): Promise<Record<string, any>> {
    let url = `${TIKTOK_API}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    await this.handleRateLimit(res);
    if (!res.ok) {
      const body = await res.text();
      this.throwApiError("GET", path, res.status, body);
    }
    return res.json();
  }

  private async apiPost(
    path: string,
    body: unknown
  ): Promise<Record<string, any>> {
    const res = await fetch(`${TIKTOK_API}${path}`, {
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
      this.throwApiError("POST", path, res.status, text);
    }
    return res.json();
  }

  private throwApiError(
    method: string,
    path: string,
    status: number,
    body: string
  ): never {
    // Try to parse TikTok error format: { error: { code, message, log_id } }
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error?.message) {
        throw new Error(
          `TikTok API ${method} ${path}: ${status} — ${parsed.error.message} (code: ${parsed.error.code}, log_id: ${parsed.error.log_id})`
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("TikTok API")) {
        throw e;
      }
    }
    throw new Error(`TikTok API ${method} ${path}: ${status} — ${body}`);
  }

  private async handleRateLimit(res: Response): Promise<void> {
    if (res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const resetAt = res.headers.get("x-ratelimit-reset");

      // Try to extract error message
      let errorMsg = "Rate limit exceeded";
      try {
        const cloned = res.clone();
        const body = await cloned.json();
        if (body?.error?.message) {
          errorMsg = body.error.message;
        }
      } catch {
        // Ignore parse errors
      }

      if (resetAt) {
        const waitMs = parseInt(resetAt, 10) * 1000 - Date.now() + 1000;
        if (waitMs > 0 && waitMs < 900_000) {
          console.warn(
            `TikTok: rate limited, waiting ${Math.ceil(waitMs / 1000)}s...`
          );
          await sleep(waitMs);
          return; // Caller should retry
        }
      }

      throw new Error(
        `TikTok: rate limit exceeded. ${errorMsg}` +
        (resetAt
          ? ` Reset at ${new Date(parseInt(resetAt, 10) * 1000).toISOString()}`
          : "")
      );
    }

    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      console.warn("TikTok: rate limit nearly exhausted, consider slowing down");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
