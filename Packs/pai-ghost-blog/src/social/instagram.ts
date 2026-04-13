/**
 * Instagram Graph API backend
 *
 * - OAuth 2.0 via Facebook Login (Instagram Business accounts)
 * - Container-based publishing (create container -> publish)
 * - Image, carousel, and reel support
 * - Character limit: 2200 chars for captions
 * - Metrics via Instagram Insights API
 * - Rate limit handling via x-business-use-case-usage header
 *
 * Requires: Instagram Business Account linked to a Facebook Page
 * API docs: https://developers.facebook.com/docs/instagram-platform
 */

import type {
  SocialBackend,
  SocialCredentials,
  SocialMedia,
  SocialPost,
  SocialResult,
  SocialMetrics,
} from "./types.js";

const GRAPH_API = "https://graph.instagram.com/v21.0";
const FB_GRAPH_API = "https://graph.facebook.com/v21.0";
const MAX_CAPTION_LENGTH = 2200;

export class InstagramBackend implements SocialBackend {
  name = "instagram";
  private accessToken = "";
  private igUserId = "";

  async authenticate(credentials: SocialCredentials): Promise<void> {
    this.accessToken = credentials.accessToken;

    // Validate token by calling /me
    const meRes = await this.apiGet(
      `${GRAPH_API}/me?fields=id,username&access_token=${this.accessToken}`
    );

    if (meRes.error) {
      throw new Error(
        `Instagram: authentication failed — ${meRes.error.message}`
      );
    }

    if (credentials.accountId) {
      // Use the provided IG business account ID directly
      this.igUserId = credentials.accountId;
    } else {
      // Discover the IG business account via Facebook Pages
      const pagesRes = await this.apiGet(
        `${FB_GRAPH_API}/me/accounts?fields=id,instagram_business_account&access_token=${this.accessToken}`
      );

      if (pagesRes.error) {
        throw new Error(
          `Instagram: failed to fetch Facebook pages — ${pagesRes.error.message}`
        );
      }

      const page = pagesRes.data?.find(
        (p: Record<string, unknown>) => p.instagram_business_account
      );
      if (!page?.instagram_business_account?.id) {
        throw new Error(
          "Instagram: no Instagram Business Account found linked to any Facebook Page"
        );
      }

      this.igUserId = page.instagram_business_account.id;
    }
  }

  async publish(post: SocialPost): Promise<SocialResult> {
    // Carousel flow
    if (post.carousel && post.carousel.length > 0) {
      return this.publishCarousel(post);
    }

    // Single media flow (image, video, or reel)
    const media = post.media?.[0];
    if (!media) {
      throw new Error(
        "Instagram: publish requires at least one media item (image, video, or reel)"
      );
    }

    const caption = this.formatCaption(post);
    const containerId = await this.createContainer(media, caption);
    const mediaId = await this.publishContainer(containerId);

    return {
      success: true,
      platform: "instagram",
      postId: mediaId,
      url: `https://www.instagram.com/p/${mediaId}/`,
      publishedAt: new Date(),
    };
  }

  async schedule(_post: SocialPost, _publishAt: Date): Promise<SocialResult> {
    return {
      success: false,
      platform: "instagram",
      error:
        "Instagram does not support native scheduling. Use external scheduler.",
    };
  }

  async delete(postId: string): Promise<void> {
    const res = await fetch(`${GRAPH_API}/${postId}?access_token=${this.accessToken}`, {
      method: "DELETE",
    });
    await this.handleRateLimit(res);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(
        `Instagram: failed to delete media ${postId} — ${body.error?.message ?? res.statusText}`
      );
    }
  }

  async metrics(postId: string): Promise<SocialMetrics> {
    const res = await this.apiGet(
      `${GRAPH_API}/${postId}/insights?metric=impressions,reach,saved,likes,comments,shares,plays&access_token=${this.accessToken}`
    );

    if (res.error) {
      throw new Error(
        `Instagram: failed to fetch metrics for ${postId} — ${res.error.message}`
      );
    }

    const data: Array<{ name: string; values: Array<{ value: number }> }> =
      res.data ?? [];

    const getValue = (name: string): number => {
      const metric = data.find((m) => m.name === name);
      return metric?.values?.[0]?.value ?? 0;
    };

    const impressions = getValue("impressions");
    const reach = getValue("reach");
    const saves = getValue("saved");
    const likes = getValue("likes");
    const comments = getValue("comments");
    const shares = getValue("shares");
    const videoViews = getValue("plays");

    const totalEngagement = likes + comments + shares + saves;
    const total = impressions || 1;

    return {
      impressions,
      clicks: 0, // Instagram Insights API doesn't expose clicks directly
      likes,
      shares,
      comments,
      engagementRate: impressions > 0 ? (totalEngagement / total) * 100 : 0,
      reach,
      saves,
      ...(videoViews > 0 ? { videoViews } : {}),
    };
  }

  // ---------- Internal helpers ----------

  private formatCaption(post: SocialPost): string {
    let caption = post.text;

    if (post.hashtags?.length) {
      const tags = post.hashtags
        .map((t) => (t.startsWith("#") ? t : `#${t}`))
        .join(" ");
      caption = `${caption}\n\n${tags}`;
    }

    if (caption.length > MAX_CAPTION_LENGTH) {
      caption = caption.slice(0, MAX_CAPTION_LENGTH - 3) + "...";
    }

    return caption;
  }

  private async createContainer(
    media: SocialMedia,
    caption: string
  ): Promise<string> {
    const isVideo = media.type === "video" || media.type === "reel";
    const body: Record<string, unknown> = { caption };

    if (isVideo) {
      body.video_url = media.url;
      body.media_type = media.type === "reel" ? "REELS" : "VIDEO";
    } else {
      body.image_url = media.url;
    }

    const res = await this.apiPost(
      `${GRAPH_API}/${this.igUserId}/media`,
      body
    );

    if (res.error || !res.id) {
      throw new Error(
        `Instagram: failed to create media container — ${res.error?.message ?? "no container ID returned"}`
      );
    }

    return res.id;
  }

  private async createChildContainer(media: SocialMedia): Promise<string> {
    const isVideo = media.type === "video" || media.type === "reel";
    const body: Record<string, unknown> = {
      is_carousel_item: true,
    };

    if (isVideo) {
      body.video_url = media.url;
      body.media_type = "VIDEO";
    } else {
      body.image_url = media.url;
    }

    const res = await this.apiPost(
      `${GRAPH_API}/${this.igUserId}/media`,
      body
    );

    if (res.error || !res.id) {
      throw new Error(
        `Instagram: failed to create carousel child container — ${res.error?.message ?? "no container ID returned"}`
      );
    }

    return res.id;
  }

  private async publishContainer(containerId: string): Promise<string> {
    const res = await this.apiPost(
      `${GRAPH_API}/${this.igUserId}/media_publish`,
      { creation_id: containerId }
    );

    if (res.error || !res.id) {
      throw new Error(
        `Instagram: failed to publish media — ${res.error?.message ?? "no media ID returned"}`
      );
    }

    return res.id;
  }

  private async publishCarousel(post: SocialPost): Promise<SocialResult> {
    const children = post.carousel!;
    const childIds: string[] = [];

    // Create each child container
    for (const media of children) {
      const childId = await this.createChildContainer(media);
      childIds.push(childId);
    }

    // Create carousel container
    const caption = this.formatCaption(post);
    const carouselRes = await this.apiPost(
      `${GRAPH_API}/${this.igUserId}/media`,
      {
        caption,
        media_type: "CAROUSEL",
        children: childIds,
      }
    );

    if (carouselRes.error || !carouselRes.id) {
      throw new Error(
        `Instagram: failed to create carousel container — ${carouselRes.error?.message ?? "no container ID returned"}`
      );
    }

    // Publish the carousel
    const mediaId = await this.publishContainer(carouselRes.id);

    return {
      success: true,
      platform: "instagram",
      postId: mediaId,
      url: `https://www.instagram.com/p/${mediaId}/`,
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
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    await this.handleRateLimit(res);
    return res.json();
  }

  private async handleRateLimit(res: Response): Promise<void> {
    if (res.status === 429) {
      // Parse x-business-use-case-usage for retry info
      const usageHeader = res.headers.get("x-business-use-case-usage");
      let waitSeconds = 60; // default fallback

      if (usageHeader) {
        try {
          const usage = JSON.parse(usageHeader);
          const firstKey = Object.keys(usage)[0];
          if (firstKey && usage[firstKey]?.[0]?.estimated_time_to_regain_access) {
            waitSeconds = usage[firstKey][0].estimated_time_to_regain_access;
          }
        } catch {
          // Fall through to default wait
        }
      }

      throw new Error(
        `Instagram: rate limit exceeded. Estimated recovery: ${waitSeconds}s. ` +
          `Reduce call frequency (200 calls/hour/user limit).`
      );
    }
  }
}
