/**
 * Social platform backend types for tier-cli
 *
 * Shared contract between tier-cli (Bun) and Harmony outbound handlers (Deno).
 * See: ev-internal/harmony/designs/social-media-publishing-architecture.md
 */

export interface SocialBackend {
  name: string;
  authenticate(credentials: SocialCredentials): Promise<void>;
  publish(post: SocialPost): Promise<SocialResult>;
  schedule(post: SocialPost, publishAt: Date): Promise<SocialResult>;
  delete(postId: string): Promise<void>;
  metrics(postId: string): Promise<SocialMetrics>;
}

export interface SocialMedia {
  url: string;
  alt?: string;
  type?: "image" | "video" | "reel";
}

export interface SocialPost {
  text: string;
  media?: SocialMedia[];
  link?: string;
  hashtags?: string[];
  /** For Twitter threads — each element is a tweet in the thread */
  thread?: string[];
  /** For Instagram carousels — multiple images/videos in a single post */
  carousel?: SocialMedia[];
}

export interface SocialResult {
  success: boolean;
  platform: string;
  postId?: string;
  url?: string;
  publishedAt?: Date;
  error?: string;
}

export interface SocialMetrics {
  impressions: number;
  clicks: number;
  likes: number;
  shares: number;
  comments: number;
  engagementRate: number;
  /** Instagram/Facebook audience reached */
  reach?: number;
  /** Instagram saves/bookmarks */
  saves?: number;
  /** TikTok/Reels video view count */
  videoViews?: number;
}

export interface SocialCredentials {
  platform: string;
  /** OAuth2 access token (from k8s secrets or integrations table) */
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  /** For OAuth2 token refresh flows */
  clientId?: string;
  /** For OAuth2 token refresh flows */
  clientSecret?: string;
  /** Platform-specific account identifier (IG business ID, FB page ID) */
  accountId?: string;
}
