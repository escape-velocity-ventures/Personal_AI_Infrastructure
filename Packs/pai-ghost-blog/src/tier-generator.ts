/**
 * Tier generation engine for tier-cli.
 *
 * Handles:
 * - API key resolution (env var → ~/.anthropic/api_key)
 * - LLM calls via @anthropic-ai/sdk
 * - Output file writing with YAML frontmatter
 * - Single-file and batch generation
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { buildSystemPrompt, buildUserPrompt } from "./tier-prompts.js";
import {
  ALL_TIERS,
  type GenerateOptions,
  type BatchOptions,
  type GenerationResult,
  type TierOutput,
  type Tier,
  type FrontMatter,
} from "./tier-types.js";

// ============================================================================
// API Key Resolution
// ============================================================================

function resolveApiKey(): string {
  // 1. Environment variable
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  // 2. Fallback: ~/.anthropic/api_key
  const keyFile = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? "~",
    ".anthropic",
    "api_key"
  );
  if (fs.existsSync(keyFile)) {
    const key = fs.readFileSync(keyFile, "utf-8").trim();
    if (key) return key;
  }

  throw new Error(
    "No Anthropic API key found.\n" +
      "Set ANTHROPIC_API_KEY environment variable or create ~/.anthropic/api_key"
  );
}

// ============================================================================
// LLM Call
// ============================================================================

async function generateTierContent(
  client: Anthropic,
  sourceContent: string,
  sourceFilename: string,
  tier: Tier
): Promise<string> {
  const systemPrompt = buildSystemPrompt(tier);
  const userPrompt = buildUserPrompt({ sourceContent, sourceFilename, tier });

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`No text content in LLM response for tier: ${tier}`);
  }

  return textBlock.text;
}

// ============================================================================
// YAML Frontmatter
// ============================================================================

function buildFrontmatter(fm: FrontMatter): string {
  // Simple YAML serialization — no external lib needed for this structure
  return [
    "---",
    `title: "${fm.title.replace(/"/g, '\\"')}"`,
    `tier: ${fm.tier}`,
    `source: "${fm.source}"`,
    `generated: "${fm.generated}"`,
    "---",
    "",
  ].join("\n");
}

/**
 * Extract title from generated markdown (first # heading).
 */
function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled";
}

/**
 * Prepend YAML frontmatter to generated markdown content.
 */
function withFrontmatter(
  content: string,
  tier: Tier,
  sourceFilename: string,
  generatedAt: string
): string {
  const title = extractTitle(content);
  const fm = buildFrontmatter({
    title,
    tier,
    source: sourceFilename,
    generated: generatedAt,
  });
  return fm + content;
}

/**
 * Count approximate word count (split on whitespace).
 */
function countWords(text: string): number {
  return text
    .replace(/---[\s\S]*?---/, "") // strip frontmatter
    .split(/\s+/)
    .filter(Boolean).length;
}

// ============================================================================
// File Generation
// ============================================================================

/**
 * Generate tier content for a single input markdown file.
 */
export async function generateTiers(
  opts: GenerateOptions,
  onProgress?: (tier: Tier, status: "start" | "done" | "error") => void
): Promise<GenerationResult> {
  const apiKey = resolveApiKey();
  const client = new Anthropic({ apiKey });

  const sourceContent = fs.readFileSync(opts.inputFile, "utf-8");
  const sourceFilename = path.basename(opts.inputFile);
  const generatedAt = new Date().toISOString();
  const tiers = opts.tiers.length > 0 ? opts.tiers : ALL_TIERS;

  // Ensure output directory exists
  fs.mkdirSync(opts.outputDir, { recursive: true });

  const tierOutputs: TierOutput[] = [];

  for (const tier of tiers) {
    onProgress?.(tier, "start");
    try {
      const rawContent = await generateTierContent(
        client,
        sourceContent,
        sourceFilename,
        tier
      );
      const fullContent = withFrontmatter(
        rawContent,
        tier,
        sourceFilename,
        generatedAt
      );

      const outputPath = path.join(opts.outputDir, `${tier}.md`);
      fs.writeFileSync(outputPath, fullContent, "utf-8");

      tierOutputs.push({
        tier,
        content: fullContent,
        wordCount: countWords(fullContent),
      });
      onProgress?.(tier, "done");
    } catch (err) {
      onProgress?.(tier, "error");
      throw err;
    }
  }

  return {
    sourcePath: opts.inputFile,
    sourceFilename,
    outputDir: opts.outputDir,
    tiers: tierOutputs,
    generatedAt,
  };
}

/**
 * Batch generate tiers for all markdown files in a directory.
 * Each input file gets its own subdirectory in outputDir.
 */
export async function batchGenerateTiers(
  opts: BatchOptions,
  onProgress?: (
    file: string,
    tier: Tier,
    status: "start" | "done" | "error"
  ) => void
): Promise<GenerationResult[]> {
  const entries = fs.readdirSync(opts.inputDir).filter((f) => f.endsWith(".md"));

  if (entries.length === 0) {
    throw new Error(`No markdown files found in: ${opts.inputDir}`);
  }

  const results: GenerationResult[] = [];

  for (const entry of entries) {
    const inputFile = path.join(opts.inputDir, entry);
    const stem = path.basename(entry, ".md");
    const outputDir = path.join(opts.outputDir, stem);

    const result = await generateTiers(
      {
        inputFile,
        outputDir,
        tiers: opts.tiers,
      },
      (tier, status) => onProgress?.(entry, tier, status)
    );

    results.push(result);
  }

  return results;
}
