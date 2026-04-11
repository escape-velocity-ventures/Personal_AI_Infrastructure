/**
 * Instagram Graph API backend tests
 *
 * Tests the InstagramBackend against mocked fetch responses
 * that match the Instagram Graph API v21.0 contract.
 */

import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { InstagramBackend } from "../instagram.js";
import type { SocialCredentials, SocialPost, SocialMedia } from "../types.js";

// Store original fetch
const originalFetch = globalThis.fetch;

// Helper to create mock responses
function mockResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockErrorResponse(message: string, type: string, code: number): Response {
  return mockResponse({ error: { message, type, code } }, 400);
}

describe("InstagramBackend", () => {
  let backend: InstagramBackend;
  let fetchMock: ReturnType<typeof mock>;
  const baseCreds: SocialCredentials = {
    platform: "instagram",
    accessToken: "test-access-token-123",
    accountId: "17841400000000001",
  };

  beforeEach(() => {
    backend = new InstagramBackend();
    fetchMock = mock(() => Promise.resolve(mockResponse({})));
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("authenticate()", () => {
    it("validates token by calling /me endpoint", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ id: "17841400000000001", username: "testuser" })
        )
      ) as any;

      await backend.authenticate(baseCreds);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const call = (globalThis.fetch as any).mock.calls[0];
      expect(call[0]).toContain("/me");
      expect(call[0]).toContain("fields=id,username");
    });

    it("uses accountId from credentials when provided", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ id: "17841400000000001", username: "testuser" })
        )
      ) as any;

      await backend.authenticate(baseCreds);
      // Should only call /me, not /me/accounts
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("fetches IG business account via /me/accounts when no accountId", async () => {
      const credsNoAccount: SocialCredentials = {
        platform: "instagram",
        accessToken: "test-access-token-123",
      };

      const calls: string[] = [];
      globalThis.fetch = mock((url: string) => {
        calls.push(url);
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                {
                  id: "page-123",
                  instagram_business_account: { id: "17841400000000001" },
                },
              ],
            })
          );
        }
        // /me validation
        return Promise.resolve(
          mockResponse({ id: "17841400000000001", username: "testuser" })
        );
      }) as any;

      await backend.authenticate(credsNoAccount);
      expect(calls.some((u) => u.includes("/me/accounts"))).toBe(true);
    });

    it("throws on invalid token", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(mockErrorResponse("Invalid OAuth access token", "OAuthException", 190))
      ) as any;

      await expect(backend.authenticate(baseCreds)).rejects.toThrow();
    });

    it("throws when no IG business account found", async () => {
      const credsNoAccount: SocialCredentials = {
        platform: "instagram",
        accessToken: "test-access-token-123",
      };

      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(mockResponse({ data: [] }));
        }
        return Promise.resolve(mockResponse({ id: "user-123", username: "testuser" }));
      }) as any;

      await expect(backend.authenticate(credsNoAccount)).rejects.toThrow(
        /no Instagram Business Account/i
      );
    });
  });

  describe("publish()", () => {
    beforeEach(async () => {
      // Authenticate first
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ id: "17841400000000001", username: "testuser" })
        )
      ) as any;
      await backend.authenticate(baseCreds);
    });

    it("publishes a single image post via container flow", async () => {
      let callCount = 0;
      globalThis.fetch = mock(() => {
        callCount++;
        if (callCount === 1) {
          // Container creation
          return Promise.resolve(mockResponse({ id: "container-123" }));
        }
        // Media publish
        return Promise.resolve(mockResponse({ id: "media-456" }));
      }) as any;

      const post: SocialPost = {
        text: "Hello Instagram!",
        media: [{ url: "https://example.com/photo.jpg", type: "image" }],
      };

      const result = await backend.publish(post);
      expect(result.success).toBe(true);
      expect(result.platform).toBe("instagram");
      expect(result.postId).toBe("media-456");
      expect(result.url).toContain("instagram.com");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("publishes a carousel post", async () => {
      let callCount = 0;
      globalThis.fetch = mock(() => {
        callCount++;
        if (callCount <= 2) {
          // Two child containers
          return Promise.resolve(mockResponse({ id: `child-${callCount}` }));
        }
        if (callCount === 3) {
          // Carousel container
          return Promise.resolve(mockResponse({ id: "carousel-container-789" }));
        }
        // Media publish
        return Promise.resolve(mockResponse({ id: "carousel-media-999" }));
      }) as any;

      const post: SocialPost = {
        text: "Carousel post!",
        carousel: [
          { url: "https://example.com/photo1.jpg", type: "image" },
          { url: "https://example.com/photo2.jpg", type: "image" },
        ],
      };

      const result = await backend.publish(post);
      expect(result.success).toBe(true);
      expect(result.postId).toBe("carousel-media-999");
      // 2 children + 1 carousel container + 1 publish = 4 calls
      expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    });

    it("truncates captions over 2200 chars", async () => {
      let capturedBody: string | undefined;
      let callCount = 0;
      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          capturedBody = init?.body as string;
          return Promise.resolve(mockResponse({ id: "container-123" }));
        }
        return Promise.resolve(mockResponse({ id: "media-456" }));
      }) as any;

      const longText = "A".repeat(2300);
      const post: SocialPost = {
        text: longText,
        media: [{ url: "https://example.com/photo.jpg", type: "image" }],
      };

      await backend.publish(post);
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.caption.length).toBeLessThanOrEqual(2200);
      expect(parsed.caption.endsWith("...")).toBe(true);
    });

    it("appends hashtags to caption", async () => {
      let capturedBody: string | undefined;
      let callCount = 0;
      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          capturedBody = init?.body as string;
          return Promise.resolve(mockResponse({ id: "container-123" }));
        }
        return Promise.resolve(mockResponse({ id: "media-456" }));
      }) as any;

      const post: SocialPost = {
        text: "Great photo",
        media: [{ url: "https://example.com/photo.jpg", type: "image" }],
        hashtags: ["photography", "#nature"],
      };

      await backend.publish(post);
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.caption).toContain("#photography");
      expect(parsed.caption).toContain("#nature");
    });

    it("publishes a video/reel", async () => {
      let callCount = 0;
      let containerUrl = "";
      globalThis.fetch = mock((url: string) => {
        callCount++;
        if (callCount === 1) {
          containerUrl = url;
          return Promise.resolve(mockResponse({ id: "reel-container-123" }));
        }
        return Promise.resolve(mockResponse({ id: "reel-media-456" }));
      }) as any;

      const post: SocialPost = {
        text: "Check out this reel!",
        media: [{ url: "https://example.com/video.mp4", type: "reel" }],
      };

      const result = await backend.publish(post);
      expect(result.success).toBe(true);
    });

    it("returns error on API failure", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockErrorResponse("Media creation failed", "IGApiException", 2207026)
        )
      ) as any;

      const post: SocialPost = {
        text: "Test post",
        media: [{ url: "https://example.com/photo.jpg", type: "image" }],
      };

      await expect(backend.publish(post)).rejects.toThrow();
    });
  });

  describe("schedule()", () => {
    it("returns not-supported error", async () => {
      // Authenticate first
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ id: "17841400000000001", username: "testuser" })
        )
      ) as any;
      await backend.authenticate(baseCreds);

      const post: SocialPost = { text: "Scheduled post" };
      const futureDate = new Date(Date.now() + 86400000);

      const result = await backend.schedule(post, futureDate);
      expect(result.success).toBe(false);
      expect(result.error).toContain("does not support native scheduling");
      expect(result.platform).toBe("instagram");
    });
  });

  describe("delete()", () => {
    beforeEach(async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ id: "17841400000000001", username: "testuser" })
        )
      ) as any;
      await backend.authenticate(baseCreds);
    });

    it("deletes a media post", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(mockResponse({ success: true }))
      ) as any;

      await backend.delete("media-456");

      const call = (globalThis.fetch as any).mock.calls[0];
      expect(call[0]).toContain("media-456");
      expect(call[1].method).toBe("DELETE");
    });

    it("throws on delete failure", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockErrorResponse("Unsupported delete request", "OAuthException", 100)
        )
      ) as any;

      await expect(backend.delete("media-456")).rejects.toThrow();
    });
  });

  describe("metrics()", () => {
    beforeEach(async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ id: "17841400000000001", username: "testuser" })
        )
      ) as any;
      await backend.authenticate(baseCreds);
    });

    it("fetches and maps insights to SocialMetrics", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: [
              { name: "impressions", values: [{ value: 1500 }] },
              { name: "reach", values: [{ value: 1200 }] },
              { name: "saved", values: [{ value: 45 }] },
              { name: "likes", values: [{ value: 200 }] },
              { name: "comments", values: [{ value: 30 }] },
              { name: "shares", values: [{ value: 15 }] },
            ],
          })
        )
      ) as any;

      const metrics = await backend.metrics("media-456");

      expect(metrics.impressions).toBe(1500);
      expect(metrics.reach).toBe(1200);
      expect(metrics.saves).toBe(45);
      expect(metrics.likes).toBe(200);
      expect(metrics.comments).toBe(30);
      expect(metrics.shares).toBe(15);
      expect(metrics.engagementRate).toBeGreaterThan(0);
    });

    it("includes video views for reels", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: [
              { name: "impressions", values: [{ value: 5000 }] },
              { name: "reach", values: [{ value: 4000 }] },
              { name: "saved", values: [{ value: 100 }] },
              { name: "likes", values: [{ value: 500 }] },
              { name: "comments", values: [{ value: 50 }] },
              { name: "shares", values: [{ value: 200 }] },
              { name: "plays", values: [{ value: 8000 }] },
            ],
          })
        )
      ) as any;

      const metrics = await backend.metrics("reel-789");
      expect(metrics.videoViews).toBe(8000);
    });

    it("handles missing metrics gracefully", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(mockResponse({ data: [] }))
      ) as any;

      const metrics = await backend.metrics("media-456");
      expect(metrics.impressions).toBe(0);
      expect(metrics.likes).toBe(0);
      expect(metrics.engagementRate).toBe(0);
    });
  });

  describe("rate limiting", () => {
    beforeEach(async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({ id: "17841400000000001", username: "testuser" })
        )
      ) as any;
      await backend.authenticate(baseCreds);
    });

    it("handles rate limit responses", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: "Application request limit reached",
                type: "OAuthException",
                code: 4,
              },
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "x-business-use-case-usage": JSON.stringify({
                  "business-id": [
                    {
                      call_count: 100,
                      total_cputime: 100,
                      total_time: 100,
                      type: "BUC",
                      estimated_time_to_regain_access: 60,
                    },
                  ],
                }),
              },
            }
          )
        )
      ) as any;

      await expect(backend.metrics("media-456")).rejects.toThrow(/rate limit/i);
    });
  });
});
