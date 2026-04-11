/**
 * Scheduler tests — outbound_messages consumer
 *
 * Tests the processScheduledPosts function against a mock Supabase client
 * and mock social backend factory.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  processScheduledPosts,
  type OutboundMessage,
  type OutboundChannel,
  type SupabaseClient,
  type BackendFactory,
} from "../scheduler.js";
import type { SocialBackend, SocialCredentials, SocialPost, SocialResult, SocialMetrics } from "../types.js";

// ============================================================================
// Mock infrastructure
// ============================================================================

/** In-memory mock Supabase that tracks queries and updates */
function createMockSupabase(
  messages: OutboundMessage[],
  channels: OutboundChannel[]
): { client: SupabaseClient; updates: Array<{ table: string; id: string; data: Record<string, unknown> }> } {
  const updates: Array<{ table: string; id: string; data: Record<string, unknown> }> = [];

  const client: SupabaseClient = {
    from(table: string) {
      let filterEq: Record<string, unknown> = {};
      let filterLte: Record<string, string> = {};
      let updateData: Record<string, unknown> | null = null;
      let isSingle = false;
      let limitCount = 100;

      const builder: any = {
        select() { return builder; },
        eq(col: string, val: unknown) { filterEq[col] = val; return builder; },
        lte(col: string, val: string) { filterLte[col] = val; return builder; },
        order() { return builder; },
        limit(n: number) { limitCount = n; return builder; },
        single() { isSingle = true; return builder; },
        update(data: Record<string, unknown>) {
          updateData = data;
          return builder;
        },
        then(fn: (val: { data: unknown; error: unknown }) => unknown) {
          if (updateData) {
            // Record the update
            const id = filterEq["id"] as string;
            if (id) {
              updates.push({ table, id, data: { ...updateData } });
              // Apply update to in-memory data
              if (table === "outbound_messages") {
                const msg = messages.find((m) => m.id === id);
                if (msg) Object.assign(msg, updateData);
              }
            }
            return Promise.resolve(fn({ data: null, error: null }));
          }

          if (table === "outbound_messages") {
            let filtered = [...messages];
            if (filterEq["status"]) filtered = filtered.filter((m) => m.status === filterEq["status"]);
            if (filterLte["scheduled_at"]) {
              const cutoff = filterLte["scheduled_at"];
              filtered = filtered.filter((m) => m.scheduled_at && m.scheduled_at <= cutoff);
            }
            filtered = filtered.slice(0, limitCount);
            return Promise.resolve(fn({ data: filtered, error: null }));
          }

          if (table === "outbound_channels") {
            if (isSingle) {
              const ch = channels.find((c) => c.id === filterEq["id"]);
              return Promise.resolve(fn({ data: ch ?? null, error: ch ? null : { message: "not found" } }));
            }
            return Promise.resolve(fn({ data: channels, error: null }));
          }

          return Promise.resolve(fn({ data: null, error: null }));
        },
      };

      return builder;
    },
  };

  return { client, updates };
}

/** Mock social backend that succeeds */
function createSuccessBackend(platform: string): SocialBackend {
  return {
    name: platform,
    async authenticate() {},
    async publish(post: SocialPost): Promise<SocialResult> {
      return {
        success: true,
        platform,
        postId: `${platform}-post-123`,
        url: `https://${platform}.com/post/123`,
        publishedAt: new Date(),
      };
    },
    async schedule() { return { success: true, platform }; },
    async delete() {},
    async metrics(): Promise<SocialMetrics> {
      return { impressions: 0, clicks: 0, likes: 0, shares: 0, comments: 0, engagementRate: 0 };
    },
  };
}

/** Mock social backend that fails */
function createFailBackend(platform: string): SocialBackend {
  return {
    name: platform,
    async authenticate() {},
    async publish(): Promise<SocialResult> {
      return { success: false, platform, error: "API rate limit exceeded" };
    },
    async schedule() { return { success: false, platform, error: "fail" }; },
    async delete() {},
    async metrics(): Promise<SocialMetrics> {
      return { impressions: 0, clicks: 0, likes: 0, shares: 0, comments: 0, engagementRate: 0 };
    },
  };
}

/** Mock backend that throws */
function createThrowBackend(platform: string): SocialBackend {
  return {
    name: platform,
    async authenticate() {},
    async publish(): Promise<SocialResult> {
      throw new Error("Network timeout");
    },
    async schedule() { throw new Error("fail"); },
    async delete() {},
    async metrics(): Promise<SocialMetrics> {
      return { impressions: 0, clicks: 0, likes: 0, shares: 0, comments: 0, engagementRate: 0 };
    },
  };
}

// ============================================================================
// Fixtures
// ============================================================================

const CHANNEL_TWITTER: OutboundChannel = {
  id: "ch-twitter-1",
  business_id: "biz-1",
  name: "Twitter Main",
  channel_type: "social",
  platform: "twitter",
  config: {},
  credentials_ref: "social-credentials",
  is_active: true,
};

const CHANNEL_LINKEDIN: OutboundChannel = {
  id: "ch-linkedin-1",
  business_id: "biz-1",
  name: "LinkedIn Main",
  channel_type: "social",
  platform: "linkedin",
  config: {},
  credentials_ref: "social-credentials",
  is_active: true,
};

const CHANNEL_INACTIVE: OutboundChannel = {
  id: "ch-inactive-1",
  business_id: "biz-1",
  name: "Inactive Channel",
  channel_type: "social",
  platform: "twitter",
  config: {},
  credentials_ref: null,
  is_active: false,
};

function makeMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: "msg-1",
    business_id: "biz-1",
    channel_id: "ch-twitter-1",
    route_id: null,
    content: { text: "Hello world from scheduler!" },
    status: "queued",
    external_id: null,
    error_message: null,
    scheduled_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
    sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("processScheduledPosts", () => {
  it("processes a single queued message successfully", async () => {
    const msg = makeMessage();
    const { client, updates } = createMockSupabase([msg], [CHANNEL_TWITTER]);
    const factory: BackendFactory = async (p) => createSuccessBackend(p);

    const results = await processScheduledPosts(client, {}, factory);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("sent");
    expect(results[0].platform).toBe("twitter");
    expect(results[0].externalId).toBe("twitter-post-123");

    // Verify status updates: sending → sent
    const statusUpdates = updates.filter((u) => u.table === "outbound_messages");
    expect(statusUpdates.some((u) => u.data.status === "sending")).toBe(true);
    expect(statusUpdates.some((u) => u.data.status === "sent")).toBe(true);
  });

  it("processes multiple messages across different platforms", async () => {
    const msg1 = makeMessage({ id: "msg-1", channel_id: "ch-twitter-1" });
    const msg2 = makeMessage({ id: "msg-2", channel_id: "ch-linkedin-1" });
    const { client } = createMockSupabase([msg1, msg2], [CHANNEL_TWITTER, CHANNEL_LINKEDIN]);
    const factory: BackendFactory = async (p) => createSuccessBackend(p);

    const results = await processScheduledPosts(client, {}, factory);

    expect(results).toHaveLength(2);
    expect(results[0].platform).toBe("twitter");
    expect(results[1].platform).toBe("linkedin");
    expect(results.every((r) => r.status === "sent")).toBe(true);
  });

  it("returns empty array when no messages are due", async () => {
    const { client } = createMockSupabase([], [CHANNEL_TWITTER]);
    const factory: BackendFactory = async (p) => createSuccessBackend(p);

    const results = await processScheduledPosts(client, {}, factory);
    expect(results).toHaveLength(0);
  });

  it("marks message as failed when publish returns success=false", async () => {
    const msg = makeMessage();
    const { client, updates } = createMockSupabase([msg], [CHANNEL_TWITTER]);
    const factory: BackendFactory = async (p) => createFailBackend(p);

    const results = await processScheduledPosts(client, {}, factory);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("rate limit");

    const failUpdate = updates.find((u) => u.data.status === "failed");
    expect(failUpdate).toBeDefined();
    expect(failUpdate!.data.error_message).toContain("rate limit");
  });

  it("marks message as failed when backend throws", async () => {
    const msg = makeMessage();
    const { client, updates } = createMockSupabase([msg], [CHANNEL_TWITTER]);
    const factory: BackendFactory = async (p) => createThrowBackend(p);

    const results = await processScheduledPosts(client, {}, factory);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("Network timeout");
  });

  it("marks message as failed when channel is inactive", async () => {
    const msg = makeMessage({ channel_id: "ch-inactive-1" });
    const { client } = createMockSupabase([msg], [CHANNEL_INACTIVE]);
    const factory: BackendFactory = async (p) => createSuccessBackend(p);

    const results = await processScheduledPosts(client, {}, factory);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("inactive");
  });

  it("marks message as failed when channel is not found", async () => {
    const msg = makeMessage({ channel_id: "nonexistent-channel" });
    const { client } = createMockSupabase([msg], [CHANNEL_TWITTER]);
    const factory: BackendFactory = async (p) => createSuccessBackend(p);

    const results = await processScheduledPosts(client, {}, factory);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("not found");
  });

  it("skips messages not yet due (future scheduled_at)", async () => {
    const futureMsg = makeMessage({
      scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), // 1 hour from now
      status: "queued",
    });
    // The mock Supabase filters by scheduled_at <= now, so this should not appear
    const { client } = createMockSupabase([futureMsg], [CHANNEL_TWITTER]);
    const factory: BackendFactory = async (p) => createSuccessBackend(p);

    const results = await processScheduledPosts(client, {}, factory);
    expect(results).toHaveLength(0);
  });

  it("respects batchSize option", async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage({ id: `msg-${i}`, channel_id: "ch-twitter-1" })
    );
    const { client } = createMockSupabase(messages, [CHANNEL_TWITTER]);
    const factory: BackendFactory = async (p) => createSuccessBackend(p);

    const results = await processScheduledPosts(client, { batchSize: 2 }, factory);
    expect(results).toHaveLength(2);
  });

  it("converts message content to SocialPost correctly", async () => {
    let capturedPost: SocialPost | null = null;
    const msg = makeMessage({
      content: {
        text: "Check this out!",
        link: "https://example.com",
        hashtags: ["tech", "ai"],
        media: [{ url: "https://img.example.com/photo.jpg", alt: "Photo" }],
      },
    });
    const { client } = createMockSupabase([msg], [CHANNEL_TWITTER]);

    const factory: BackendFactory = async (platform: string) => ({
      name: platform,
      async authenticate() {},
      async publish(post: SocialPost): Promise<SocialResult> {
        capturedPost = post;
        return { success: true, platform, postId: "cap-123" };
      },
      async schedule() { return { success: true, platform }; },
      async delete() {},
      async metrics(): Promise<SocialMetrics> {
        return { impressions: 0, clicks: 0, likes: 0, shares: 0, comments: 0, engagementRate: 0 };
      },
    });

    await processScheduledPosts(client, {}, factory);

    expect(capturedPost).not.toBeNull();
    expect(capturedPost!.text).toBe("Check this out!");
    expect(capturedPost!.link).toBe("https://example.com");
    expect(capturedPost!.hashtags).toEqual(["tech", "ai"]);
    expect(capturedPost!.media).toHaveLength(1);
    expect(capturedPost!.media![0].url).toBe("https://img.example.com/photo.jpg");
  });

  it("throws when query fails", async () => {
    // Create a client that returns an error for the initial query
    const client: SupabaseClient = {
      from() {
        const builder: any = {
          select() { return builder; },
          eq() { return builder; },
          lte() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          single() { return builder; },
          update() { return builder; },
          then(fn: (val: { data: unknown; error: unknown }) => unknown) {
            return Promise.resolve(fn({ data: null, error: { message: "connection refused" } }));
          },
        };
        return builder;
      },
    };

    await expect(
      processScheduledPosts(client, {}, async (p) => createSuccessBackend(p))
    ).rejects.toThrow("connection refused");
  });

  it("handles mixed success and failure in a batch", async () => {
    const msg1 = makeMessage({ id: "msg-ok", channel_id: "ch-twitter-1" });
    const msg2 = makeMessage({ id: "msg-bad", channel_id: "ch-inactive-1" });
    const msg3 = makeMessage({ id: "msg-ok2", channel_id: "ch-linkedin-1" });

    const { client } = createMockSupabase(
      [msg1, msg2, msg3],
      [CHANNEL_TWITTER, CHANNEL_INACTIVE, CHANNEL_LINKEDIN]
    );
    const factory: BackendFactory = async (p) => createSuccessBackend(p);

    const results = await processScheduledPosts(client, {}, factory);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe("sent");
    expect(results[1].status).toBe("failed");
    expect(results[2].status).toBe("sent");
  });
});
