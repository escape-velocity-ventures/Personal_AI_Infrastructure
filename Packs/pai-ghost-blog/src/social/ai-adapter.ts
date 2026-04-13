/**
 * AI-powered content adapter — uses Claude to produce platform-optimized social posts.
 *
 * Falls back to the rule-based adapter (content-adapter.ts) if:
 * - ANTHROPIC_API_KEY is not set
 * - The API call fails for any reason
 * - The response cannot be parsed
 *
 * Uses claude-haiku-4-5-20251001 for speed and cost efficiency.
 */

import Anthropic from "@anthropic-ai/sdk";
import { adaptContent, type ContentSource } from "./content-adapter.js";
import type { SocialPost } from "./types.js";

// ---------------------------------------------------------------------------
// Platform system prompts
// ---------------------------------------------------------------------------

const PLATFORM_PROMPTS: Record<string, string> = {
  twitter: `You are a social media copywriter specializing in Twitter/X.
Rules:
- If the content fits in 280 characters, return a single tweet.
- If it does not fit, create a thread (array of tweets, each <=280 chars).
- Split at sentence boundaries. Never cut mid-word.
- Preserve any URLs exactly as-is.
- Extract 3-5 relevant hashtags from the content.
- Tone: concise, punchy, conversational.`,

  linkedin: `You are a professional content strategist writing LinkedIn posts.
Rules:
- Maximum 3000 characters.
- Start with a strong opening line (the "hook" before "see more").
- Use short paragraphs and line breaks for readability.
- Include key takeaways as bullet points if appropriate.
- Maximum 3 hashtags at the end.
- Tone: professional, authoritative, insightful.
- Include the source URL if provided.`,

  instagram: `You are a social media expert writing Instagram captions.
Rules:
- Maximum 2200 characters.
- Start with an attention-grabbing hook line.
- Use emoji sparingly for visual breaks.
- End with a clear call-to-action (e.g., "Link in bio", "Save this", "Share with someone who needs this").
- Add a hashtag block at the end with up to 30 relevant hashtags.
- Tone: engaging, visual, community-focused.`,

  facebook: `You are a content writer creating Facebook posts.
Rules:
- Maximum 63,206 characters (generous limit).
- If a title is provided, use it as a bold headline at the top.
- Write in a conversational, shareable tone.
- Include the source URL for link preview.
- Use hashtags naturally inline (not a block at the end).
- Tone: conversational, storytelling, community.`,

  tiktok: `You are a TikTok content creator writing video descriptions.
Rules:
- Maximum 2200 characters.
- First line MUST be a short, attention-grabbing hook (under 80 chars).
- Format as a video description: context, value prop, CTA.
- Use trending-style hashtags (mix of broad and niche).
- Tone: energetic, casual, trend-aware, Gen-Z friendly.`,
};

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface AIResponse {
  text: string;
  thread?: string[];
  hashtags?: string[];
}

function parseAIResponse(raw: string): AIResponse {
  // Try JSON first
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.text === "string") {
      return {
        text: parsed.text,
        thread: Array.isArray(parsed.thread) ? parsed.thread : undefined,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : undefined,
      };
    }
  } catch {
    // Not JSON — treat as plain text
  }

  // Plain text response — extract hashtags from end
  const lines = raw.trim().split("\n");
  const hashtagLine = lines[lines.length - 1];
  const hashtagMatch = hashtagLine?.match(/^(#\w+\s*)+$/);

  if (hashtagMatch) {
    const hashtags = hashtagLine.match(/#\w+/g) || [];
    const text = lines.slice(0, -1).join("\n").trim();
    return { text, hashtags };
  }

  return { text: raw.trim() };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Adapt content using Claude AI for natural, platform-optimized output.
 *
 * Falls back to rule-based adaptContent() on any failure.
 */
export async function adaptContentWithAI(
  source: ContentSource,
  platform: string
): Promise<SocialPost> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return adaptContent(source, platform);
  }

  const systemPrompt = PLATFORM_PROMPTS[platform];
  if (!systemPrompt) {
    return adaptContent(source, platform);
  }

  try {
    const client = new Anthropic({ apiKey });

    const userMessage = buildUserMessage(source, platform);

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      return adaptContent(source, platform);
    }

    const parsed = parseAIResponse(content.text);

    return {
      text: parsed.text,
      thread: parsed.thread,
      hashtags: parsed.hashtags,
      media: source.media,
      link: source.url,
    };
  } catch {
    // Any failure — API error, network, parsing — fall back to rules
    return adaptContent(source, platform);
  }
}

function buildUserMessage(source: ContentSource, platform: string): string {
  const parts: string[] = [];

  parts.push(`Adapt the following content for ${platform}.`);

  if (source.title) {
    parts.push(`\nTitle: ${source.title}`);
  }
  if (source.url) {
    parts.push(`Source URL: ${source.url}`);
  }
  if (source.tags?.length) {
    parts.push(`Tags: ${source.tags.join(", ")}`);
  }

  parts.push(`\nContent:\n${source.text}`);

  parts.push(
    `\nRespond with JSON: { "text": "...", "thread": ["..."] (Twitter only, if needed), "hashtags": ["#tag1", ...] }`
  );

  return parts.join("\n");
}
