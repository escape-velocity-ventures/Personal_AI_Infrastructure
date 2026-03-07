/**
 * Social platform backend types for tier-cli
 */

export interface SocialBackend {
  name: string;
  authenticate(credentials: SocialCredentials): Promise<void>;
  publish(post: SocialPost): Promise<SocialResult>;
  schedule(post: SocialPost, publishAt: Date): Promise<SocialResult>;
  delete(postId: string): Promise<void>;
  metrics(postId: string): Promise<SocialMetrics>;
}

export interface SocialPost {
  text: string;
  media?: { url: string; alt?: string }[];
  link?: string;
  hashtags?: string[];
  /** For Twitter threads — each element is a tweet in the thread */
  thread?: string[];
}

export interface SocialResult {
  platform: string;
  postId: string;
  url: string;
  publishedAt: Date;
}

export interface SocialMetrics {
  impressions: number;
  clicks: number;
  likes: number;
  shares: number;
  comments: number;
  engagementRate: number;
}

export interface SocialCredentials {
  platform: string;
  /** OAuth2 access token (from k8s secrets) */
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}
