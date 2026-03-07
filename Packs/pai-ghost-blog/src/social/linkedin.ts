/**
 * LinkedIn API backend
 *
 * - OAuth 2.0 authorization
 * - Post creation (ugcPosts / posts API)
 * - Article publishing (longer form)
 * - Image upload
 * - Character limit (3000 chars for posts)
 * - Metrics via analytics API
 */

import type {
  SocialBackend,
  SocialCredentials,
  SocialPost,
  SocialResult,
  SocialMetrics,
} from "./types.js";

const LINKEDIN_API = "https://api.linkedin.com/v2";
const REST_API = "https://api.linkedin.com/rest";
const MAX_POST_LENGTH = 3000;

export class LinkedInBackend implements SocialBackend {
  name = "linkedin";
  private accessToken = "";
  private personUrn = "";

  async authenticate(credentials: SocialCredentials): Promise<void> {
    this.accessToken = credentials.accessToken;
    // Get the authenticated user's profile URN
    const res = await this.apiGet(`${LINKEDIN_API}/userinfo`);
    if (!res.sub) {
      throw new Error("LinkedIn: authentication failed — could not retrieve user profile");
    }
    this.personUrn = `urn:li:person:${res.sub}`;
  }

  async publish(post: SocialPost): Promise<SocialResult> {
    const text = this.formatPost(post);
    const mediaAssets = post.media ? await this.uploadMedia(post.media) : [];

    const body: Record<string, unknown> = {
      author: this.personUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: mediaAssets.length > 0 ? "IMAGE" : "NONE",
          ...(mediaAssets.length > 0
            ? {
                media: mediaAssets.map((asset, i) => ({
                  status: "READY",
                  media: asset,
                  title: { text: post.media?.[i]?.alt ?? "" },
                  description: { text: "" },
                })),
              }
            : {}),
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const res = await this.apiPost(`${LINKEDIN_API}/ugcPosts`, body);
    const postId = res.id ?? res["X-RestLi-Id"] ?? "";
    if (!postId) {
      throw new Error(`LinkedIn: failed to create post — ${JSON.stringify(res)}`);
    }

    // Extract the activity ID for URL construction
    const activityId = postId.replace("urn:li:share:", "").replace("urn:li:ugcPost:", "");

    return {
      platform: "linkedin",
      postId,
      url: `https://www.linkedin.com/feed/update/${postId}`,
      publishedAt: new Date(),
    };
  }

  async schedule(post: SocialPost, publishAt: Date): Promise<SocialResult> {
    // LinkedIn API doesn't support native scheduling for organic posts.
    const delay = publishAt.getTime() - Date.now();
    if (delay <= 0) {
      return this.publish(post);
    }
    throw new Error(
      `LinkedIn: native scheduling not available via API. ` +
      `Use an external scheduler. Requested time: ${publishAt.toISOString()}`
    );
  }

  async delete(postId: string): Promise<void> {
    const encodedId = encodeURIComponent(postId);
    const res = await fetch(`${LINKEDIN_API}/ugcPosts/${encodedId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(`LinkedIn: failed to delete post ${postId}: ${res.status} — ${text}`);
    }
  }

  async metrics(postId: string): Promise<SocialMetrics> {
    // Use organizationalEntityShareStatistics for org posts,
    // or shareStatistics for personal shares
    const encodedId = encodeURIComponent(postId);
    const res = await this.apiGet(
      `${REST_API}/socialMetadata/${encodedId}`
    );

    const likes = res.likesSummary?.totalLikes ?? 0;
    const comments = res.commentsSummary?.totalFirstLevelComments ?? 0;
    const shares = res.totalShareStatistics?.shareCount ?? 0;
    const impressions = res.totalShareStatistics?.impressionCount ?? 0;
    const clicks = res.totalShareStatistics?.clickCount ?? 0;

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

  private formatPost(post: SocialPost): string {
    let text = post.text;
    if (post.hashtags?.length) {
      const tags = post.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
      text = `${text}\n\n${tags}`;
    }
    if (post.link) {
      text = `${text}\n\n${post.link}`;
    }
    if (text.length > MAX_POST_LENGTH) {
      text = text.slice(0, MAX_POST_LENGTH - 1) + "…";
    }
    return text;
  }

  private async uploadMedia(
    media: { url: string; alt?: string }[]
  ): Promise<string[]> {
    const assets: string[] = [];
    for (const item of media) {
      // Step 1: Register the upload
      const registerRes = await this.apiPost(
        `${LINKEDIN_API}/assets?action=registerUpload`,
        {
          registerUploadRequest: {
            recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
            owner: this.personUrn,
            serviceRelationships: [
              {
                relationshipType: "OWNER",
                identifier: "urn:li:userGeneratedContent",
              },
            ],
          },
        }
      );

      const uploadUrl =
        registerRes.value?.uploadMechanism?.[
          "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
        ]?.uploadUrl;
      const asset = registerRes.value?.asset;

      if (!uploadUrl || !asset) {
        throw new Error("LinkedIn: failed to register media upload");
      }

      // Step 2: Download and upload the media
      const mediaRes = await fetch(item.url);
      if (!mediaRes.ok) {
        throw new Error(`LinkedIn: failed to download media from ${item.url}`);
      }
      const blob = await mediaRes.blob();

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": mediaRes.headers.get("content-type") ?? "application/octet-stream",
        },
        body: blob,
      });

      if (!uploadRes.ok && uploadRes.status !== 201) {
        throw new Error(`LinkedIn: media upload failed — ${uploadRes.status}`);
      }

      assets.push(asset);
    }
    return assets;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": "202401",
    };
  }

  private async apiGet(url: string): Promise<Record<string, any>> {
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LinkedIn API GET ${url}: ${res.status} — ${body}`);
    }
    return res.json();
  }

  private async apiPost(url: string, body: unknown): Promise<Record<string, any>> {
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 201) {
      const text = await res.text();
      throw new Error(`LinkedIn API POST ${url}: ${res.status} — ${text}`);
    }
    // LinkedIn sometimes returns the ID in headers
    const restliId = res.headers.get("X-RestLi-Id");
    const json = res.status === 201 && !res.headers.get("content-length")
      ? {}
      : await res.json().catch(() => ({}));
    if (restliId) json["X-RestLi-Id"] = restliId;
    return json;
  }
}
