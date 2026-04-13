/**
 * TikTok Content Posting API backend tests
 *
 * Tests the TikTokBackend against mocked fetch responses
 * that match the TikTok Content Posting API v2 contract.
 *
 * TikTok API error format: { error: { code: string, message: string, log_id: string } }
 * Auth: Bearer token in Authorization header
 * Video only — no image posts supported
 */

import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { TikTokBackend } from "../tiktok.js";
import type { SocialCredentials, SocialPost } from "../types.js";

// Store original fetch
const originalFetch = globalThis.fetch;

// Helper to create mock responses
function mockResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockTikTokError(code: string, message: string, logId = "log-test-123"): Response {
  return mockResponse(
    { error: { code, message, log_id: logId } },
    400
  );
}

describe("TikTokBackend", () => {
  let backend: TikTokBackend;
  let fetchMock: ReturnType<typeof mock>;
  const baseCreds: SocialCredentials = {
    platform: "tiktok",
    accessToken: "test-tiktok-token-abc",
  };

  beforeEach(() => {
    backend = new TikTokBackend();
    fetchMock = mock(() => Promise.resolve(mockResponse({})));
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("authenticate()", () => {
    it("validates token by calling /v2/user/info/ with Bearer header", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: { user: { open_id: "user-open-id-123", display_name: "TestUser" } },
          })
        )
      ) as any;

      await backend.authenticate(baseCreds);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(call[0]).toContain("open.tiktokapis.com/v2/user/info/");
      // Verify Bearer auth header (not query param)
      expect(call[1].headers.Authorization).toBe("Bearer test-tiktok-token-abc");
    });

    it("stores open_id from user info response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: { user: { open_id: "user-open-id-456", display_name: "TestUser" } },
          })
        )
      ) as any;

      await backend.authenticate(baseCreds);
      // Subsequent publish calls should use stored open_id — tested via publish
    });

    it("throws on invalid token", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockTikTokError("access_token_invalid", "The access_token is invalid or has expired.")
        )
      ) as any;

      await expect(backend.authenticate(baseCreds)).rejects.toThrow(/access_token is invalid/i);
    });

    it("throws when user info response has no open_id", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(mockResponse({ data: { user: {} } }))
      ) as any;

      await expect(backend.authenticate(baseCreds)).rejects.toThrow(/authentication failed/i);
    });
  });

  describe("publish()", () => {
    beforeEach(async () => {
      // Authenticate first
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: { user: { open_id: "user-open-id-123", display_name: "TestUser" } },
          })
        )
      ) as any;
      await backend.authenticate(baseCreds);
    });

    it("publishes a video via PULL_FROM_URL source", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: { publish_id: "pub-video-789" },
          })
        )
      ) as any;

      const post: SocialPost = {
        text: "Check out this video!",
        media: [{ url: "https://example.com/video.mp4", type: "video" }],
      };

      const result = await backend.publish(post);
      expect(result.success).toBe(true);
      expect(result.platform).toBe("tiktok");
      expect(result.postId).toBe("pub-video-789");

      // Verify the API call
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(call[0]).toContain("/v2/post/publish/");
      expect(call[1].method).toBe("POST");
      expect(call[1].headers.Authorization).toBe("Bearer test-tiktok-token-abc");

      const body = JSON.parse(call[1].body);
      expect(body.post_info.title).toBe("Check out this video!");
      expect(body.post_info.privacy_level).toBe("SELF_ONLY");
      expect(body.source_info.source).toBe("PULL_FROM_URL");
      expect(body.source_info.video_url).toBe("https://example.com/video.mp4");
    });

    it("returns error when no video media provided", async () => {
      const post: SocialPost = {
        text: "Just text, no video",
      };

      const result = await backend.publish(post);
      expect(result.success).toBe(false);
      expect(result.error).toContain("video");
      expect(result.platform).toBe("tiktok");
    });

    it("returns error when only image media provided", async () => {
      const post: SocialPost = {
        text: "Image post",
        media: [{ url: "https://example.com/photo.jpg", type: "image" }],
      };

      const result = await backend.publish(post);
      expect(result.success).toBe(false);
      expect(result.error).toContain("video");
    });

    it("uses first video when multiple media provided", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ data: { publish_id: "pub-first-video" } })
        )
      ) as any;

      const post: SocialPost = {
        text: "Multiple media",
        media: [
          { url: "https://example.com/photo.jpg", type: "image" },
          { url: "https://example.com/video1.mp4", type: "video" },
          { url: "https://example.com/video2.mp4", type: "video" },
        ],
      };

      const result = await backend.publish(post);
      expect(result.success).toBe(true);

      const call = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.source_info.video_url).toBe("https://example.com/video1.mp4");
    });

    it("appends hashtags to caption", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ data: { publish_id: "pub-hashtag" } })
        )
      ) as any;

      const post: SocialPost = {
        text: "Great video",
        media: [{ url: "https://example.com/video.mp4", type: "video" }],
        hashtags: ["trending", "#viral"],
      };

      await backend.publish(post);

      const call = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.post_info.title).toContain("#trending");
      expect(body.post_info.title).toContain("#viral");
    });

    it("truncates caption to 2200 chars", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ data: { publish_id: "pub-long" } })
        )
      ) as any;

      const longText = "A".repeat(2300);
      const post: SocialPost = {
        text: longText,
        media: [{ url: "https://example.com/video.mp4", type: "video" }],
      };

      await backend.publish(post);

      const call = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.post_info.title.length).toBeLessThanOrEqual(2200);
    });

    it("throws on API error", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockTikTokError("spam_risk_too_many_posts", "Too many posts in a short period.")
        )
      ) as any;

      const post: SocialPost = {
        text: "Spam post",
        media: [{ url: "https://example.com/video.mp4", type: "video" }],
      };

      await expect(backend.publish(post)).rejects.toThrow(/Too many posts/);
    });

    it("defaults privacy_level to SELF_ONLY", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ data: { publish_id: "pub-private" } })
        )
      ) as any;

      const post: SocialPost = {
        text: "Private video",
        media: [{ url: "https://example.com/video.mp4", type: "video" }],
      };

      await backend.publish(post);

      const call = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.post_info.privacy_level).toBe("SELF_ONLY");
    });
  });

  describe("schedule()", () => {
    it("returns success=false with clear error message", async () => {
      const post: SocialPost = { text: "Scheduled video" };
      const futureDate = new Date(Date.now() + 86400000);

      const result = await backend.schedule(post, futureDate);
      expect(result.success).toBe(false);
      expect(result.error).toContain("scheduling");
      expect(result.platform).toBe("tiktok");
    });
  });

  describe("delete()", () => {
    it("throws error — not supported via Content Posting API", async () => {
      await expect(backend.delete("video-123")).rejects.toThrow(
        /not supported/i
      );
    });
  });

  describe("metrics()", () => {
    beforeEach(async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: { user: { open_id: "user-open-id-123", display_name: "TestUser" } },
          })
        )
      ) as any;
      await backend.authenticate(baseCreds);
    });

    it("fetches and maps video query data to SocialMetrics", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: {
              videos: [
                {
                  id: "video-123",
                  view_count: 15000,
                  like_count: 500,
                  comment_count: 120,
                  share_count: 80,
                },
              ],
            },
          })
        )
      ) as any;

      const metrics = await backend.metrics("video-123");

      expect(metrics.videoViews).toBe(15000);
      expect(metrics.likes).toBe(500);
      expect(metrics.comments).toBe(120);
      expect(metrics.shares).toBe(80);
      expect(metrics.impressions).toBe(15000); // mapped from view_count
      expect(metrics.engagementRate).toBeGreaterThan(0);
    });

    it("sends video_ids filter in request body", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: {
              videos: [
                {
                  id: "video-456",
                  view_count: 100,
                  like_count: 10,
                  comment_count: 5,
                  share_count: 2,
                },
              ],
            },
          })
        )
      ) as any;

      await backend.metrics("video-456");

      const call = (globalThis.fetch as any).mock.calls[0];
      expect(call[0]).toContain("/v2/video/query/");
      expect(call[1].method).toBe("POST");

      const body = JSON.parse(call[1].body);
      expect(body.filters.video_ids).toContain("video-456");
    });

    it("handles empty video response gracefully", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ data: { videos: [] } })
        )
      ) as any;

      const metrics = await backend.metrics("nonexistent-video");
      expect(metrics.impressions).toBe(0);
      expect(metrics.likes).toBe(0);
      expect(metrics.engagementRate).toBe(0);
    });

    it("uses Bearer auth header", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: {
              videos: [
                { id: "v1", view_count: 0, like_count: 0, comment_count: 0, share_count: 0 },
              ],
            },
          })
        )
      ) as any;

      await backend.metrics("v1");

      const call = (globalThis.fetch as any).mock.calls[0];
      expect(call[1].headers.Authorization).toBe("Bearer test-tiktok-token-abc");
    });
  });

  describe("rate limiting", () => {
    beforeEach(async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: { user: { open_id: "user-open-id-123", display_name: "TestUser" } },
          })
        )
      ) as any;
      await backend.authenticate(baseCreds);
    });

    it("handles rate limit (429) responses", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "rate_limit_exceeded",
                message: "Rate limit exceeded. Please retry after some time.",
                log_id: "log-rate-limit-456",
              },
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 86400),
              },
            }
          )
        )
      ) as any;

      await expect(backend.metrics("video-123")).rejects.toThrow(/rate limit/i);
    });
  });
});
