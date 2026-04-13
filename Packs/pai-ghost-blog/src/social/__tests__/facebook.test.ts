/**
 * Facebook Graph API backend tests
 *
 * Tests the FacebookBackend against mocked fetch responses
 * that match the Facebook Graph API v21.0 contract.
 */

import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { FacebookBackend } from "../facebook.js";
import type { SocialCredentials, SocialPost } from "../types.js";

// Store original fetch
const originalFetch = globalThis.fetch;

// Helper to create mock responses
function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockErrorResponse(
  message: string,
  type: string,
  code: number
): Response {
  return mockResponse({ error: { message, type, code } }, 400);
}

describe("FacebookBackend", () => {
  let backend: FacebookBackend;
  let fetchMock: ReturnType<typeof mock>;
  const baseCreds: SocialCredentials = {
    platform: "facebook",
    accessToken: "user-access-token-123",
  };

  beforeEach(() => {
    backend = new FacebookBackend();
    fetchMock = mock(() => Promise.resolve(mockResponse({})));
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("authenticate()", () => {
    it("validates user token via /me and fetches page token via /me/accounts", async () => {
      const calls: string[] = [];
      globalThis.fetch = mock((url: string) => {
        calls.push(url);
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                {
                  id: "page-123",
                  name: "My Page",
                  access_token: "page-access-token-456",
                },
              ],
            })
          );
        }
        // /me validation
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;

      await backend.authenticate(baseCreds);

      expect(calls.some((u) => u.includes("/me?"))).toBe(true);
      expect(calls.some((u) => u.includes("/me/accounts"))).toBe(true);
    });

    it("uses accountId to select the correct page", async () => {
      const credsWithPage: SocialCredentials = {
        platform: "facebook",
        accessToken: "user-access-token-123",
        accountId: "page-456",
      };

      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                { id: "page-123", name: "Wrong Page", access_token: "wrong-token" },
                { id: "page-456", name: "Right Page", access_token: "right-page-token" },
              ],
            })
          );
        }
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;

      await backend.authenticate(credsWithPage);

      // Verify the right page was selected by publishing and checking the URL
      let publishUrl = "";
      globalThis.fetch = mock((url: string) => {
        publishUrl = url;
        return Promise.resolve(mockResponse({ id: "post-999" }));
      }) as any;

      await backend.publish({ text: "Test" });
      expect(publishUrl).toContain("page-456");
    });

    it("throws on invalid user token", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockErrorResponse("Invalid OAuth access token", "OAuthException", 190)
        )
      ) as any;

      await expect(backend.authenticate(baseCreds)).rejects.toThrow(
        /authentication failed/i
      );
    });

    it("throws when no pages found", async () => {
      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(mockResponse({ data: [] }));
        }
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;

      await expect(backend.authenticate(baseCreds)).rejects.toThrow(
        /no Facebook Pages found/i
      );
    });

    it("throws when specified accountId page not found", async () => {
      const credsWithPage: SocialCredentials = {
        platform: "facebook",
        accessToken: "user-access-token-123",
        accountId: "nonexistent-page",
      };

      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                { id: "page-123", name: "Some Page", access_token: "some-token" },
              ],
            })
          );
        }
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;

      await expect(backend.authenticate(credsWithPage)).rejects.toThrow(
        /page.*nonexistent-page.*not found/i
      );
    });
  });

  describe("publish()", () => {
    beforeEach(async () => {
      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                { id: "page-123", name: "My Page", access_token: "page-token-abc" },
              ],
            })
          );
        }
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;
      await backend.authenticate(baseCreds);
    });

    it("publishes a text post via /{page-id}/feed", async () => {
      let capturedUrl = "";
      let capturedBody = "";
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedBody = init?.body as string;
        return Promise.resolve(mockResponse({ id: "page-123_post-456" }));
      }) as any;

      const post: SocialPost = { text: "Hello Facebook!" };
      const result = await backend.publish(post);

      expect(result.success).toBe(true);
      expect(result.platform).toBe("facebook");
      expect(result.postId).toBe("page-123_post-456");
      expect(result.url).toContain("facebook.com");
      expect(capturedUrl).toContain("page-123/feed");
      const body = JSON.parse(capturedBody);
      expect(body.message).toBe("Hello Facebook!");
    });

    it("publishes a text post with a link", async () => {
      let capturedBody = "";
      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return Promise.resolve(mockResponse({ id: "page-123_post-789" }));
      }) as any;

      const post: SocialPost = {
        text: "Check this out!",
        link: "https://example.com/article",
      };
      const result = await backend.publish(post);

      expect(result.success).toBe(true);
      const body = JSON.parse(capturedBody);
      expect(body.link).toBe("https://example.com/article");
    });

    it("publishes a photo post via /{page-id}/photos", async () => {
      let capturedUrl = "";
      let capturedBody = "";
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedBody = init?.body as string;
        return Promise.resolve(mockResponse({ id: "photo-123", post_id: "page-123_post-photo-456" }));
      }) as any;

      const post: SocialPost = {
        text: "Great photo!",
        media: [{ url: "https://example.com/photo.jpg", type: "image" }],
      };
      const result = await backend.publish(post);

      expect(result.success).toBe(true);
      expect(capturedUrl).toContain("page-123/photos");
      const body = JSON.parse(capturedBody);
      expect(body.url).toBe("https://example.com/photo.jpg");
    });

    it("publishes a video post via /{page-id}/videos", async () => {
      let capturedUrl = "";
      globalThis.fetch = mock((url: string) => {
        capturedUrl = url;
        return Promise.resolve(mockResponse({ id: "video-123" }));
      }) as any;

      const post: SocialPost = {
        text: "Check out this video!",
        media: [{ url: "https://example.com/video.mp4", type: "video" }],
      };
      const result = await backend.publish(post);

      expect(result.success).toBe(true);
      expect(capturedUrl).toContain("page-123/videos");
    });

    it("appends hashtags inline to message", async () => {
      let capturedBody = "";
      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return Promise.resolve(mockResponse({ id: "page-123_post-999" }));
      }) as any;

      const post: SocialPost = {
        text: "Great content",
        hashtags: ["marketing", "#social"],
      };
      await backend.publish(post);

      const body = JSON.parse(capturedBody);
      expect(body.message).toContain("#marketing");
      expect(body.message).toContain("#social");
    });

    it("returns postId in {page-id}_{post-id} format", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(mockResponse({ id: "page-123_post-789" }))
      ) as any;

      const result = await backend.publish({ text: "Test" });
      expect(result.postId).toBe("page-123_post-789");
    });

    it("throws on API failure", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockErrorResponse(
            "Requires a valid page access token",
            "OAuthException",
            190
          )
        )
      ) as any;

      await expect(backend.publish({ text: "Test" })).rejects.toThrow();
    });
  });

  describe("schedule()", () => {
    beforeEach(async () => {
      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                { id: "page-123", name: "My Page", access_token: "page-token-abc" },
              ],
            })
          );
        }
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;
      await backend.authenticate(baseCreds);
    });

    it("schedules a post with published=false and scheduled_publish_time", async () => {
      let capturedBody = "";
      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return Promise.resolve(mockResponse({ id: "page-123_scheduled-post-456" }));
      }) as any;

      const post: SocialPost = { text: "Scheduled post" };
      const futureDate = new Date(Date.now() + 3600_000); // 1 hour from now

      const result = await backend.schedule(post, futureDate);
      expect(result.success).toBe(true);
      expect(result.postId).toBe("page-123_scheduled-post-456");

      const body = JSON.parse(capturedBody);
      expect(body.published).toBe(false);
      expect(body.scheduled_publish_time).toBe(
        Math.floor(futureDate.getTime() / 1000)
      );
    });

    it("rejects scheduling less than 10 minutes in the future", async () => {
      const post: SocialPost = { text: "Too soon" };
      const tooSoon = new Date(Date.now() + 5 * 60_000); // 5 min from now

      await expect(backend.schedule(post, tooSoon)).rejects.toThrow(
        /at least 10 minutes/i
      );
    });

    it("rejects scheduling more than 6 months in the future", async () => {
      const post: SocialPost = { text: "Too far" };
      const tooFar = new Date(Date.now() + 200 * 24 * 3600_000); // ~200 days

      await expect(backend.schedule(post, tooFar)).rejects.toThrow(
        /more than 6 months/i
      );
    });

    it("publishes immediately if scheduled time is in the past", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(mockResponse({ id: "page-123_post-now" }))
      ) as any;

      const post: SocialPost = { text: "Should publish now" };
      const pastDate = new Date(Date.now() - 60_000);

      const result = await backend.schedule(post, pastDate);
      expect(result.success).toBe(true);
    });
  });

  describe("delete()", () => {
    beforeEach(async () => {
      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                { id: "page-123", name: "My Page", access_token: "page-token-abc" },
              ],
            })
          );
        }
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;
      await backend.authenticate(baseCreds);
    });

    it("deletes a post with page token", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedMethod = init?.method ?? "GET";
        return Promise.resolve(mockResponse({ success: true }));
      }) as any;

      await backend.delete("page-123_post-456");

      expect(capturedMethod).toBe("DELETE");
      expect(capturedUrl).toContain("page-123_post-456");
      expect(capturedUrl).toContain("access_token=page-token-abc");
    });

    it("throws on delete failure", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockErrorResponse(
            "Unsupported delete request",
            "OAuthException",
            100
          )
        )
      ) as any;

      await expect(backend.delete("page-123_post-456")).rejects.toThrow();
    });
  });

  describe("metrics()", () => {
    beforeEach(async () => {
      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                { id: "page-123", name: "My Page", access_token: "page-token-abc" },
              ],
            })
          );
        }
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;
      await backend.authenticate(baseCreds);
    });

    it("fetches and maps post insights to SocialMetrics", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: [
              { name: "post_impressions", period: "lifetime", values: [{ value: 2500 }] },
              { name: "post_engaged_users", period: "lifetime", values: [{ value: 180 }] },
              { name: "post_clicks", period: "lifetime", values: [{ value: 95 }] },
              { name: "post_reactions_like_total", period: "lifetime", values: [{ value: 120 }] },
            ],
          })
        )
      ) as any;

      const metrics = await backend.metrics("page-123_post-456");

      expect(metrics.impressions).toBe(2500);
      expect(metrics.clicks).toBe(95);
      expect(metrics.likes).toBe(120);
      expect(metrics.engagementRate).toBeGreaterThan(0);
    });

    it("handles missing metrics gracefully", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(mockResponse({ data: [] }))
      ) as any;

      const metrics = await backend.metrics("page-123_post-456");
      expect(metrics.impressions).toBe(0);
      expect(metrics.likes).toBe(0);
      expect(metrics.engagementRate).toBe(0);
    });

    it("includes reach in metrics", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          mockResponse({
            data: [
              { name: "post_impressions", period: "lifetime", values: [{ value: 3000 }] },
              { name: "post_impressions_unique", period: "lifetime", values: [{ value: 2200 }] },
              { name: "post_engaged_users", period: "lifetime", values: [{ value: 150 }] },
              { name: "post_clicks", period: "lifetime", values: [{ value: 50 }] },
              { name: "post_reactions_like_total", period: "lifetime", values: [{ value: 200 }] },
            ],
          })
        )
      ) as any;

      const metrics = await backend.metrics("page-123_post-456");
      expect(metrics.reach).toBe(2200);
    });
  });

  describe("rate limiting", () => {
    beforeEach(async () => {
      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                { id: "page-123", name: "My Page", access_token: "page-token-abc" },
              ],
            })
          );
        }
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;
      await backend.authenticate(baseCreds);
    });

    it("throws on rate limit with recovery info", async () => {
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
                      estimated_time_to_regain_access: 120,
                    },
                  ],
                }),
              },
            }
          )
        )
      ) as any;

      await expect(backend.metrics("page-123_post-456")).rejects.toThrow(
        /rate limit/i
      );
    });

    it("handles 429 without usage header", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { message: "Rate limited", type: "OAuthException", code: 4 },
            }),
            { status: 429, headers: { "content-type": "application/json" } }
          )
        )
      ) as any;

      await expect(backend.metrics("page-123_post-456")).rejects.toThrow(
        /rate limit/i
      );
    });
  });

  describe("formatMessage()", () => {
    beforeEach(async () => {
      globalThis.fetch = mock((url: string) => {
        if (url.includes("/me/accounts")) {
          return Promise.resolve(
            mockResponse({
              data: [
                { id: "page-123", name: "My Page", access_token: "page-token-abc" },
              ],
            })
          );
        }
        return Promise.resolve(mockResponse({ id: "user-789", name: "Test User" }));
      }) as any;
      await backend.authenticate(baseCreds);
    });

    it("normalizes hashtags with missing # prefix", async () => {
      let capturedBody = "";
      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return Promise.resolve(mockResponse({ id: "page-123_post-999" }));
      }) as any;

      await backend.publish({
        text: "Content",
        hashtags: ["noprefix", "#hasprefix"],
      });

      const body = JSON.parse(capturedBody);
      expect(body.message).toContain("#noprefix");
      expect(body.message).toContain("#hasprefix");
      // Should not double the #
      expect(body.message).not.toContain("##hasprefix");
    });
  });
});
