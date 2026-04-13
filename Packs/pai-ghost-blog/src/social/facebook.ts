/**
 * Facebook Graph API v21.0 backend
 *
 * - OAuth 2.0 (Facebook Login) — user token → Page access token
 * - Page Posts API: POST /{page-id}/feed (text/link), /photos (image), /videos (video)
 * - Native scheduling via published=false + scheduled_publish_time
 * - Character limit: 63,206 chars
 * - Metrics via /{post-id}/insights (Page Insights API)
 * - Rate limit handling via x-business-use-case-usage header
 *
 * Requires: Facebook Page with manage_pages + publish_pages permissions
 * API docs: https://developers.facebook.com/docs/pages-api
 */

import type {
  SocialBackend,
  SocialCredentials,
  SocialPost,
  SocialResult,
  SocialMetrics,
} from "./types.js";

const GRAPH_API = "https://graph.facebook.com/v21.0";
const MAX_MESSAGE_LENGTH = 63_206;
const MIN_SCHEDULE_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SCHEDULE_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months

export class FacebookBackend implements SocialBackend {
  name = "facebook";
  private pageAccessToken = "";
  private pageId = "";

  async authenticate(credentials: SocialCredentials): Promise<void> {
    const userToken = credentials.accessToken;

    // Step 1: Validate user token via GET /me
    const meRes = await this.apiGet(
      `${GRAPH_API}/me?fields=id,name&access_token=${userToken}`
    );

    if (meRes.error) {
      throw new Error(
        `Facebook: authentication failed — ${meRes.error.message}`
      );
    }

    // Step 2: Get Page access tokens via GET /me/accounts
    const pagesRes = await this.apiGet(
      `${GRAPH_API}/me/accounts?fields=id,name,access_token&access_token=${userToken}`
    );

    if (pagesRes.error) {
      throw new Error(
        `Facebook: failed to fetch pages — ${pagesRes.error.message}`
      );
    }

    const pages: Array<{ id: string; name: string; access_token: string }> =
      pagesRes.data ?? [];

    if (pages.length === 0) {
      throw new Error(
        "Facebook: no Facebook Pages found for this user"
      );
    }

    // Step 3: Select the right page
    let page: (typeof pages)[0] | undefined;
    if (credentials.accountId) {
      page = pages.find((p) => p.id === credentials.accountId);
      if (!page) {
        throw new Error(
          `Facebook: page ${credentials.accountId} not found in user's pages`
        );
      }
    } else {
      // Default to first page
      page = pages[0];
    }

    this.pageId = page.id;
    this.pageAccessToken = page.access_token;
  }

  async publish(post: SocialPost): Promise<SocialResult> {
    const media = post.media?.[0];
    const message = this.formatMessage(post);

    // Route to the correct endpoint based on media type
    if (media?.type === "video") {
      return this.publishVideo(message, media.url, post.link);
    }
    if (media?.type === "image") {
      return this.publishPhoto(message, media.url);
    }

    // Text/link post via /{page-id}/feed
    return this.publishFeed(message, post.link);
  }

  async schedule(post: SocialPost, publishAt: Date): Promise<SocialResult> {
    const delay = publishAt.getTime() - Date.now();

    // If in the past, publish immediately
    if (delay <= 0) {
      return this.publish(post);
    }

    // Validate scheduling window: 10 min to 6 months
    if (delay < MIN_SCHEDULE_MS) {
      throw new Error(
        "Facebook: scheduled time must be at least 10 minutes in the future"
      );
    }
    if (delay > MAX_SCHEDULE_MS) {
      throw new Error(
        "Facebook: scheduled time must not be more than 6 months in the future"
      );
    }

    const message = this.formatMessage(post);
    const unixTimestamp = Math.floor(publishAt.getTime() / 1000);

    const body: Record<string, unknown> = {
      message,
      published: false,
      scheduled_publish_time: unixTimestamp,
    };

    if (post.link) {
      body.link = post.link;
    }

    const res = await this.apiPost(
      `${GRAPH_API}/${this.pageId}/feed`,
      body
    );

    if (res.error || !res.id) {
      throw new Error(
        `Facebook: failed to schedule post — ${res.error?.message ?? "no post ID returned"}`
      );
    }

    return {
      success: true,
      platform: "facebook",
      postId: res.id,
      url: `https://www.facebook.com/${res.id}`,
      publishedAt: publishAt,
    };
  }

  async delete(postId: string): Promise<void> {
    const res = await fetch(
      `${GRAPH_API}/${postId}?access_token=${this.pageAccessToken}`,
      { method: "DELETE" }
    );
    await this.handleRateLimit(res);

    if (!res.ok) {
      const body = await res.json();
      throw new Error(
        `Facebook: failed to delete post ${postId} — ${body.error?.message ?? res.statusText}`
      );
    }
  }

  async metrics(postId: string): Promise<SocialMetrics> {
    const metricNames = [
      "post_impressions",
      "post_impressions_unique",
      "post_engaged_users",
      "post_clicks",
      "post_reactions_like_total",
    ].join(",");

    const res = await this.apiGet(
      `${GRAPH_API}/${postId}/insights?metric=${metricNames}&access_token=${this.pageAccessToken}`
    );

    if (res.error) {
      throw new Error(
        `Facebook: failed to fetch metrics for ${postId} — ${res.error.message}`
      );
    }

    const data: Array<{ name: string; values: Array<{ value: number }> }> =
      res.data ?? [];

    const getValue = (name: string): number => {
      const metric = data.find((m) => m.name === name);
      return metric?.values?.[0]?.value ?? 0;
    };

    const impressions = getValue("post_impressions");
    const reach = getValue("post_impressions_unique");
    const engagedUsers = getValue("post_engaged_users");
    const clicks = getValue("post_clicks");
    const likes = getValue("post_reactions_like_total");

    // shares and comments come from the post object, not insights
    // For now, approximate from engaged_users
    const shares = 0;
    const comments = 0;

    const totalEngagement = likes + clicks + engagedUsers;
    const total = impressions || 1;

    return {
      impressions,
      clicks,
      likes,
      shares,
      comments,
      engagementRate: impressions > 0 ? (totalEngagement / total) * 100 : 0,
      ...(reach > 0 ? { reach } : {}),
    };
  }

  // ---------- Internal helpers ----------

  private formatMessage(post: SocialPost): string {
    let message = post.text;

    if (post.hashtags?.length) {
      const tags = post.hashtags
        .map((t) => (t.startsWith("#") ? t : `#${t}`))
        .join(" ");
      message = `${message}\n\n${tags}`;
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      message = message.slice(0, MAX_MESSAGE_LENGTH - 3) + "...";
    }

    return message;
  }

  private async publishFeed(
    message: string,
    link?: string
  ): Promise<SocialResult> {
    const body: Record<string, unknown> = { message };
    if (link) {
      body.link = link;
    }

    const res = await this.apiPost(
      `${GRAPH_API}/${this.pageId}/feed`,
      body
    );

    if (res.error || !res.id) {
      throw new Error(
        `Facebook: failed to publish post — ${res.error?.message ?? "no post ID returned"}`
      );
    }

    return {
      success: true,
      platform: "facebook",
      postId: res.id,
      url: `https://www.facebook.com/${res.id}`,
      publishedAt: new Date(),
    };
  }

  private async publishPhoto(
    message: string,
    imageUrl: string
  ): Promise<SocialResult> {
    const body: Record<string, unknown> = {
      message,
      url: imageUrl,
    };

    const res = await this.apiPost(
      `${GRAPH_API}/${this.pageId}/photos`,
      body
    );

    if (res.error || (!res.id && !res.post_id)) {
      throw new Error(
        `Facebook: failed to publish photo — ${res.error?.message ?? "no post ID returned"}`
      );
    }

    const postId = res.post_id ?? res.id;

    return {
      success: true,
      platform: "facebook",
      postId,
      url: `https://www.facebook.com/${postId}`,
      publishedAt: new Date(),
    };
  }

  private async publishVideo(
    message: string,
    videoUrl: string,
    link?: string
  ): Promise<SocialResult> {
    const body: Record<string, unknown> = {
      description: message,
      file_url: videoUrl,
    };
    if (link) {
      body.link = link;
    }

    const res = await this.apiPost(
      `${GRAPH_API}/${this.pageId}/videos`,
      body
    );

    if (res.error || !res.id) {
      throw new Error(
        `Facebook: failed to publish video — ${res.error?.message ?? "no video ID returned"}`
      );
    }

    return {
      success: true,
      platform: "facebook",
      postId: res.id,
      url: `https://www.facebook.com/${res.id}`,
      publishedAt: new Date(),
    };
  }

  private async apiGet(url: string): Promise<Record<string, any>> {
    const res = await fetch(url);
    await this.handleRateLimit(res);
    return res.json();
  }

  private async apiPost(
    url: string,
    body: unknown
  ): Promise<Record<string, any>> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.pageAccessToken}`,
      },
      body: JSON.stringify(body),
    });
    await this.handleRateLimit(res);
    return res.json();
  }

  private async handleRateLimit(res: Response): Promise<void> {
    if (res.status === 429) {
      const usageHeader = res.headers.get("x-business-use-case-usage");
      let waitSeconds = 60;

      if (usageHeader) {
        try {
          const usage = JSON.parse(usageHeader);
          const firstKey = Object.keys(usage)[0];
          if (
            firstKey &&
            usage[firstKey]?.[0]?.estimated_time_to_regain_access
          ) {
            waitSeconds = usage[firstKey][0].estimated_time_to_regain_access;
          }
        } catch {
          // Fall through to default wait
        }
      }

      throw new Error(
        `Facebook: rate limit exceeded. Estimated recovery: ${waitSeconds}s. ` +
          `Reduce call frequency.`
      );
    }
  }
}
