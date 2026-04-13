/**
 * Rule-based content adapter — transforms source content into platform-specific SocialPost.
 *
 * No AI, no external dependencies. Pure string manipulation.
 * For AI-powered adaptation, see ai-adapter.ts which falls back to this.
 */

import type { SocialPost, SocialMedia } from "./types.js";

/** Input shape for content adaptation */
export interface ContentSource {
  text: string;
  title?: string;
  url?: string;
  tags?: string[];
  media?: SocialMedia[];
}

// ---------------------------------------------------------------------------
// Platform character limits
// ---------------------------------------------------------------------------

const LIMITS = {
  twitter: 280,
  linkedin: 3000,
  instagram: 2200,
  facebook: 63206,
  tiktok: 2200,
} as const;

type Platform = keyof typeof LIMITS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split text into sentences. Handles ". ", "! ", "? " boundaries. */
function splitSentences(text: string): string[] {
  if (!text.trim()) return [];
  // Split on sentence-ending punctuation followed by a space or end-of-string
  const parts = text.match(/[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!parts) return [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Truncate text to maxLen, preferring sentence boundaries. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const sentences = splitSentences(text);
  let result = "";
  for (const sentence of sentences) {
    const candidate = result ? `${result} ${sentence}` : sentence;
    if (candidate.length > maxLen) break;
    result = candidate;
  }
  // If no sentence fit, hard-truncate at word boundary
  if (!result) {
    const cut = text.slice(0, maxLen - 3);
    const lastSpace = cut.lastIndexOf(" ");
    return lastSpace > 0 ? cut.slice(0, lastSpace) + "..." : cut + "...";
  }
  return result;
}

/** Pick up to `max` hashtags from tags array. Prefixes with # if missing. */
function pickHashtags(tags: string[] | undefined, max: number): string[] {
  if (!tags || tags.length === 0) return [];
  return tags.slice(0, max).map((t) => (t.startsWith("#") ? t : `#${t}`));
}

// ---------------------------------------------------------------------------
// Platform adapters
// ---------------------------------------------------------------------------

function adaptTwitter(source: ContentSource): SocialPost {
  const hashtags = pickHashtags(source.tags, 5);
  const hashtagStr = hashtags.join(" ");

  // If text fits in a single tweet (with room for hashtags), no thread needed
  const singleLimit = LIMITS.twitter;
  const fullText = source.url
    ? `${source.text}\n\n${source.url}`
    : source.text;

  if (fullText.length + (hashtagStr ? 1 + hashtagStr.length : 0) <= singleLimit) {
    const text = hashtagStr ? `${fullText}\n\n${hashtagStr}` : fullText;
    return {
      text: text.slice(0, singleLimit),
      hashtags: hashtags.length ? hashtags : undefined,
      media: source.media,
      link: source.url,
    };
  }

  // Thread mode: split at sentence boundaries
  const sentences = splitSentences(source.text);
  const tweets: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > singleLimit) {
      if (current) tweets.push(current.trim());
      // If a single sentence exceeds the limit, hard-split at word boundary
      if (sentence.length > singleLimit) {
        let remaining = sentence;
        while (remaining.length > singleLimit) {
          const cut = remaining.slice(0, singleLimit);
          const lastSpace = cut.lastIndexOf(" ");
          const splitAt = lastSpace > 0 ? lastSpace : singleLimit;
          tweets.push(remaining.slice(0, splitAt).trim());
          remaining = remaining.slice(splitAt).trim();
        }
        current = remaining;
      } else {
        current = sentence;
      }
    } else {
      current = candidate;
    }
  }
  if (current.trim()) tweets.push(current.trim());

  // Append hashtags + URL to the last tweet if they fit, otherwise add a new tweet
  if (tweets.length > 0) {
    const suffix = [source.url, hashtagStr].filter(Boolean).join("\n\n");
    if (suffix) {
      const last = tweets[tweets.length - 1];
      if (last.length + 2 + suffix.length <= singleLimit) {
        tweets[tweets.length - 1] = `${last}\n\n${suffix}`;
      } else {
        tweets.push(suffix.slice(0, singleLimit));
      }
    }
  }

  return {
    text: tweets[0] || "",
    thread: tweets,
    hashtags: hashtags.length ? hashtags : undefined,
    media: source.media,
    link: source.url,
  };
}

function adaptLinkedIn(source: ContentSource): SocialPost {
  const hashtags = pickHashtags(source.tags, 3);
  const hashtagStr = hashtags.join(" ");

  let body = "";
  // Start with title as a headline
  if (source.title) {
    body += `${source.title}\n\n`;
  }

  body += source.text;

  // Add URL
  if (source.url) {
    body += `\n\n${source.url}`;
  }

  // Add hashtags at the end
  if (hashtagStr) {
    body += `\n\n${hashtagStr}`;
  }

  // Truncate to limit
  if (body.length > LIMITS.linkedin) {
    body = truncate(body, LIMITS.linkedin);
  }

  return {
    text: body,
    hashtags: hashtags.length ? hashtags : undefined,
    media: source.media,
    link: source.url,
  };
}

function adaptInstagram(source: ContentSource): SocialPost {
  const hashtags = pickHashtags(source.tags, 30);
  const hashtagStr = hashtags.join(" ");

  // Hook line from title or first sentence
  const hookLine = source.title || splitSentences(source.text)[0] || "";

  let body = "";
  if (hookLine && hookLine !== source.text) {
    body = `${hookLine}\n\n${source.text}`;
  } else {
    body = source.text;
  }

  // Add CTA
  const cta = source.url
    ? `\n\nLink in bio for more details.`
    : `\n\nSave this for later!`;
  body += cta;

  // Hashtag block at end
  if (hashtagStr) {
    body += `\n\n${hashtagStr}`;
  }

  // Truncate to limit
  if (body.length > LIMITS.instagram) {
    body = truncate(body, LIMITS.instagram);
  }

  return {
    text: body,
    hashtags: hashtags.length ? hashtags : undefined,
    media: source.media,
    link: source.url,
  };
}

function adaptFacebook(source: ContentSource): SocialPost {
  const hashtags = pickHashtags(source.tags, 10);

  let body = "";

  // Bold-style title using Unicode uppercase or emphasis markers
  if (source.title) {
    body += `${source.title.toUpperCase()}\n\n`;
  }

  body += source.text;

  // Include URL for link preview
  if (source.url) {
    body += `\n\n${source.url}`;
  }

  // Truncate to limit (generous — 63K)
  if (body.length > LIMITS.facebook) {
    body = truncate(body, LIMITS.facebook);
  }

  return {
    text: body,
    hashtags: hashtags.length ? hashtags : undefined,
    media: source.media,
    link: source.url,
  };
}

function adaptTikTok(source: ContentSource): SocialPost {
  const hashtags = pickHashtags(source.tags, 10);
  const hashtagStr = hashtags.join(" ");

  // Short hook line — use title or first sentence, keep it under 100 chars
  const firstSentence = splitSentences(source.text)[0] || "";
  let hookLine = source.title || firstSentence;
  if (hookLine.length > 80) {
    hookLine = hookLine.slice(0, 77) + "...";
  }

  // Video description style: hook + truncated body
  const bodyText = source.text !== hookLine
    ? source.text
    : splitSentences(source.text).slice(1).join(" ");

  let body = hookLine;
  if (bodyText) {
    body += `\n\n${bodyText}`;
  }

  // Add hashtags
  if (hashtagStr) {
    body += `\n\n${hashtagStr}`;
  }

  // Truncate to limit
  if (body.length > LIMITS.tiktok) {
    body = truncate(body, LIMITS.tiktok);
  }

  return {
    text: body,
    hashtags: hashtags.length ? hashtags : undefined,
    media: source.media,
    link: source.url,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const ADAPTERS: Record<Platform, (source: ContentSource) => SocialPost> = {
  twitter: adaptTwitter,
  linkedin: adaptLinkedIn,
  instagram: adaptInstagram,
  facebook: adaptFacebook,
  tiktok: adaptTikTok,
};

/**
 * Adapt source content for a specific social media platform.
 *
 * Returns a SocialPost shaped for the target platform's constraints:
 * character limits, hashtag conventions, thread splitting, etc.
 *
 * @throws Error if platform is not supported
 */
export function adaptContent(source: ContentSource, platform: string): SocialPost {
  const adapter = ADAPTERS[platform as Platform];
  if (!adapter) {
    throw new Error(
      `Unsupported platform: "${platform}". Supported: ${Object.keys(ADAPTERS).join(", ")}`
    );
  }
  return adapter(source);
}
