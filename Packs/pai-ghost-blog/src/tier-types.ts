/**
 * Types for tier-cli — AI-powered tier generation engine
 */

export type Tier = "free" | "starter" | "pro";

export interface TierConfig {
  name: Tier;
  /** Target word count range */
  wordRange: [number, number];
  /** Core goal for this tier */
  goal: string;
  /** Ending instruction */
  ending: string;
}

export interface GenerateOptions {
  /** Path to the input markdown file */
  inputFile: string;
  /** Directory to write generated tier files */
  outputDir: string;
  /** Which tiers to generate (defaults to all) */
  tiers: Tier[];
}

export interface BatchOptions {
  /** Directory containing markdown files to process */
  inputDir: string;
  /** Base output directory (each file gets a subdirectory) */
  outputDir: string;
  /** Which tiers to generate (defaults to all) */
  tiers: Tier[];
}

export interface TierOutput {
  tier: Tier;
  /** Full markdown content including YAML frontmatter */
  content: string;
  /** Words in the generated content */
  wordCount: number;
}

export interface GenerationResult {
  sourcePath: string;
  sourceFilename: string;
  outputDir: string;
  tiers: TierOutput[];
  generatedAt: string;
}

export interface FrontMatter {
  title: string;
  tier: Tier;
  source: string;
  generated: string;
}

export const ALL_TIERS: Tier[] = ["free", "starter", "pro"];

export interface TierManifest {
  /** Relative path to source .md (relative to the tier-dir) */
  source: string;
  /** Ghost post IDs for each tier */
  ghost: {
    free?: string;
    starter?: string;
    pro?: string;
  };
  /** ISO timestamp of last successful sync */
  lastSync?: string;
}

// Re-export social types for convenience
export type {
  SocialBackend,
  SocialPost,
  SocialResult,
  SocialMetrics,
  SocialCredentials,
} from "./social/types.js";

export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  free: {
    name: "free",
    wordRange: [600, 1000],
    goal: "Learn what is possible. Neutralize fear. Show results.",
    ending: "End with a compelling CTA that makes the reader want to learn more or take the next step.",
  },
  starter: {
    name: "starter",
    wordRange: [1200, 1800],
    goal: "Encourage agency. Meet them where they are with actionable insights for their CURRENT step.",
    ending: "End with a specific 'try this week' action they can take immediately.",
  },
  pro: {
    name: "pro",
    wordRange: [2000, 3000],
    goal: "Encourage growth. Respect experience. Unintuitive, data-backed insights that challenge assumptions.",
    ending: "End with advanced insights, edge cases, and a challenge to go deeper.",
  },
};
