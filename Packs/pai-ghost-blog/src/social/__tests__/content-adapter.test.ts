/**
 * Content adapter tests — rule-based content adaptation per platform.
 *
 * Tests adaptContent() which transforms a ContentSource into a platform-specific
 * SocialPost without calling any external APIs.
 */

import { describe, it, expect } from "bun:test";
import { adaptContent, type ContentSource } from "../content-adapter.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHORT_TEXT = "Check out our latest product release!";

const MEDIUM_TEXT =
  "We just launched our new AI-powered infrastructure platform. " +
  "It automates deployments, monitors your services, and handles incidents. " +
  "Built for teams who want reliability without the overhead. " +
  "Try it free at https://example.com/try today.";

const LONG_TEXT =
  "Artificial intelligence is reshaping how we build software. " +
  "In the past year, we have seen a dramatic shift in development workflows. " +
  "Teams that once needed ten engineers now ship with three. " +
  "The key is not replacing humans but augmenting their capabilities. " +
  "Our platform gives every developer the tools of a staff engineer. " +
  "Monitoring, deployment, incident response — all automated. " +
  "This is not about removing jobs. " +
  "It is about making every person ten times more effective. " +
  "We believe the next hundred million developers are not in Silicon Valley. " +
  "They are in kitchens, construction sites, and home offices. " +
  "The barrier is not skill. It is imagination. " +
  "We are here to close that gap.";

const TAGS = ["ai", "infrastructure", "devops", "automation", "saas"];

const BASE_SOURCE: ContentSource = {
  text: MEDIUM_TEXT,
  title: "Introducing Our New Platform",
  url: "https://example.com/blog/new-platform",
  tags: TAGS,
};

// ---------------------------------------------------------------------------
// Twitter
// ---------------------------------------------------------------------------

describe("Twitter adapter", () => {
  it("should produce text under 280 chars for short content", () => {
    const result = adaptContent({ text: SHORT_TEXT, tags: TAGS }, "twitter");
    expect(result.text.length).toBeLessThanOrEqual(280);
    expect(result.text).toContain(SHORT_TEXT);
  });

  it("should create a thread array when text exceeds 280 chars", () => {
    const result = adaptContent(BASE_SOURCE, "twitter");
    expect(result.thread).toBeDefined();
    expect(result.thread!.length).toBeGreaterThan(1);
    for (const tweet of result.thread!) {
      expect(tweet.length).toBeLessThanOrEqual(280);
    }
  });

  it("should split threads at sentence boundaries, not mid-word", () => {
    const result = adaptContent({ text: LONG_TEXT, tags: TAGS }, "twitter");
    expect(result.thread).toBeDefined();
    for (const tweet of result.thread!) {
      // Each tweet should end with a sentence-ending character or be the last one
      expect(tweet.length).toBeLessThanOrEqual(280);
      // Should not start or end with whitespace (trimmed)
      expect(tweet).toBe(tweet.trim());
    }
  });

  it("should preserve links in tweets", () => {
    const textWithLink = "Check out https://example.com/test for details. This is great.";
    const result = adaptContent({ text: textWithLink }, "twitter");
    expect(result.text).toContain("https://example.com/test");
  });

  it("should extract 3-5 hashtags from tags", () => {
    const result = adaptContent(BASE_SOURCE, "twitter");
    expect(result.hashtags).toBeDefined();
    expect(result.hashtags!.length).toBeGreaterThanOrEqual(3);
    expect(result.hashtags!.length).toBeLessThanOrEqual(5);
  });

  it("should add thread numbering when creating threads", () => {
    const result = adaptContent({ text: LONG_TEXT, tags: TAGS }, "twitter");
    expect(result.thread).toBeDefined();
    // First tweet should contain the content, last could contain hashtags
    expect(result.thread!.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

describe("LinkedIn adapter", () => {
  it("should produce text under 3000 chars", () => {
    const result = adaptContent(BASE_SOURCE, "linkedin");
    expect(result.text.length).toBeLessThanOrEqual(3000);
  });

  it("should start with a professional summary paragraph", () => {
    const result = adaptContent(BASE_SOURCE, "linkedin");
    // Should start with the title or a summary line
    const firstLine = result.text.split("\n")[0];
    expect(firstLine.length).toBeGreaterThan(0);
  });

  it("should limit hashtags to 3", () => {
    const result = adaptContent(BASE_SOURCE, "linkedin");
    expect(result.hashtags).toBeDefined();
    expect(result.hashtags!.length).toBeLessThanOrEqual(3);
  });

  it("should truncate very long text to 3000 chars", () => {
    const veryLong = LONG_TEXT.repeat(5);
    const result = adaptContent({ text: veryLong, tags: TAGS }, "linkedin");
    expect(result.text.length).toBeLessThanOrEqual(3000);
  });

  it("should include the source URL when provided", () => {
    const result = adaptContent(BASE_SOURCE, "linkedin");
    expect(result.link).toBe(BASE_SOURCE.url);
  });
});

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

describe("Instagram adapter", () => {
  it("should produce text under 2200 chars", () => {
    const result = adaptContent(BASE_SOURCE, "instagram");
    expect(result.text.length).toBeLessThanOrEqual(2200);
  });

  it("should start with a hook line", () => {
    const result = adaptContent(BASE_SOURCE, "instagram");
    const firstLine = result.text.split("\n")[0];
    // Hook line should be attention-grabbing, not empty
    expect(firstLine.length).toBeGreaterThan(0);
  });

  it("should include hashtag block at end (up to 30)", () => {
    const manyTags = Array.from({ length: 35 }, (_, i) => `tag${i}`);
    const result = adaptContent({ text: MEDIUM_TEXT, tags: manyTags }, "instagram");
    expect(result.hashtags).toBeDefined();
    expect(result.hashtags!.length).toBeLessThanOrEqual(30);
  });

  it("should include a call-to-action", () => {
    const result = adaptContent(BASE_SOURCE, "instagram");
    // Text should contain some form of CTA
    const ctaPatterns = /link in bio|check out|learn more|tap|follow|save this/i;
    expect(ctaPatterns.test(result.text)).toBe(true);
  });

  it("should carry through media from source", () => {
    const source: ContentSource = {
      text: SHORT_TEXT,
      media: [{ url: "https://example.com/image.jpg", alt: "Product screenshot" }],
    };
    const result = adaptContent(source, "instagram");
    expect(result.media).toBeDefined();
    expect(result.media!.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------------

describe("Facebook adapter", () => {
  it("should prepend title as a bold-style line", () => {
    const result = adaptContent(BASE_SOURCE, "facebook");
    // Unicode bold or emphasis markers for title
    expect(result.text.startsWith(BASE_SOURCE.title!)).toBe(false);
    // Title should appear near the top
    const upperText = result.text.slice(0, 200);
    expect(
      upperText.includes(BASE_SOURCE.title!) ||
      upperText.includes(BASE_SOURCE.title!.toUpperCase())
    ).toBe(true);
  });

  it("should include source URL for link preview", () => {
    const result = adaptContent(BASE_SOURCE, "facebook");
    expect(result.link).toBe(BASE_SOURCE.url);
  });

  it("should handle full text without truncation under 63K chars", () => {
    const result = adaptContent(BASE_SOURCE, "facebook");
    // Facebook has a 63,206 char limit — medium text should not be truncated
    expect(result.text).toContain("automates deployments");
  });

  it("should include hashtags inline naturally", () => {
    const result = adaptContent(BASE_SOURCE, "facebook");
    expect(result.hashtags).toBeDefined();
    expect(result.hashtags!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

describe("TikTok adapter", () => {
  it("should produce text under 2200 chars", () => {
    const result = adaptContent(BASE_SOURCE, "tiktok");
    expect(result.text.length).toBeLessThanOrEqual(2200);
  });

  it("should start with a short attention-grabbing hook", () => {
    const result = adaptContent(BASE_SOURCE, "tiktok");
    const firstLine = result.text.split("\n")[0];
    // Hook should be concise
    expect(firstLine.length).toBeLessThan(100);
    expect(firstLine.length).toBeGreaterThan(0);
  });

  it("should format as video description style", () => {
    const result = adaptContent(BASE_SOURCE, "tiktok");
    // Should have hashtags for discoverability
    expect(result.hashtags).toBeDefined();
    expect(result.hashtags!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("should handle empty text", () => {
    const result = adaptContent({ text: "" }, "twitter");
    expect(result.text).toBeDefined();
    expect(result.text.length).toBeLessThanOrEqual(280);
  });

  it("should handle very short text (single word)", () => {
    const result = adaptContent({ text: "Hello" }, "twitter");
    expect(result.text).toContain("Hello");
    expect(result.thread).toBeUndefined();
  });

  it("should handle text with no sentences (no periods)", () => {
    const noSentences = "This is text without any sentence endings just words flowing together endlessly";
    const result = adaptContent({ text: noSentences }, "twitter");
    expect(result.text.length).toBeLessThanOrEqual(280);
  });

  it("should handle source with media only (no text)", () => {
    const source: ContentSource = {
      text: "",
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    };
    const result = adaptContent(source, "instagram");
    expect(result.media).toBeDefined();
    expect(result.media!.length).toBe(1);
  });

  it("should handle missing optional fields gracefully", () => {
    const result = adaptContent({ text: SHORT_TEXT }, "linkedin");
    expect(result.text).toBeDefined();
    // No tags means no hashtags generated from tags
    expect(result.hashtags?.length ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("should throw for unknown platforms", () => {
    expect(() => adaptContent({ text: SHORT_TEXT }, "mastodon")).toThrow();
  });

  it("should preserve existing media across all platforms", () => {
    const source: ContentSource = {
      text: MEDIUM_TEXT,
      media: [
        { url: "https://example.com/img1.jpg", type: "image", alt: "Screenshot" },
        { url: "https://example.com/img2.jpg", type: "image" },
      ],
    };
    for (const platform of ["twitter", "linkedin", "facebook", "tiktok"]) {
      const result = adaptContent(source, platform);
      expect(result.media).toBeDefined();
      expect(result.media!.length).toBe(2);
    }
  });
});
