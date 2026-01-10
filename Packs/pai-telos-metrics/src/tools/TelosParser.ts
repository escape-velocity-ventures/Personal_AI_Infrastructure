#!/usr/bin/env bun
/**
 * TelosParser.ts - Parse TELOS.md into structured data
 *
 * Extracts Problems, Mission, Goals, Projects, and Journal entries
 * from the TELOS markdown file.
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";

// Types
export interface TelosItem {
  id: string;        // P1, M1, G1, etc.
  content: string;   // The actual text
  category?: string; // For goals: Professional/Personal
}

export interface TelosProject {
  name: string;
  description: string;
  status: string;
}

export interface TelosJournalEntry {
  date: string;
  content: string;
}

export interface TelosData {
  problems: TelosItem[];
  mission: TelosItem[];
  narratives: TelosItem[];
  goals: TelosItem[];
  challenges: TelosItem[];
  strategies: TelosItem[];
  projects: TelosProject[];
  skills: string[];
  ideas: string[];
  wisdom: string[];
  metrics: string[];
  journal: TelosJournalEntry[];
  raw: string;
}

// Default TELOS path
const PAI_DIR = process.env.PAI_DIR || `${homedir()}/.claude`;
const DEFAULT_TELOS_PATH = `${PAI_DIR}/skills/CORE/USER/TELOS.md`;

/**
 * Parse a markdown section that contains items like:
 * - **P1:** Description here
 * - **M1:** Another description
 */
function parseItemSection(content: string, prefix: string): TelosItem[] {
  const items: TelosItem[] = [];
  const regex = new RegExp(`\\*\\*${prefix}(\\d+):\\*\\*\\s*(.+)`, "g");

  let match;
  while ((match = regex.exec(content)) !== null) {
    items.push({
      id: `${prefix}${match[1]}`,
      content: match[2].trim()
    });
  }

  return items;
}

/**
 * Parse goals with category detection (Professional/Personal)
 */
function parseGoals(content: string): TelosItem[] {
  const goals: TelosItem[] = [];
  const lines = content.split("\n");

  let currentCategory = "";

  for (const line of lines) {
    // Check for category headers
    if (line.includes("Professional Goals")) {
      currentCategory = "Professional";
    } else if (line.includes("Personal Goals")) {
      currentCategory = "Personal";
    }

    // Match goal pattern: - **G1:** Description
    const goalMatch = line.match(/\*\*G(\d+):\*\*\s*(.+)/);
    if (goalMatch) {
      goals.push({
        id: `G${goalMatch[1]}`,
        content: goalMatch[2].trim(),
        category: currentCategory || undefined
      });
    }
  }

  return goals;
}

/**
 * Parse the Projects table
 */
function parseProjects(content: string): TelosProject[] {
  const projects: TelosProject[] = [];

  // Find table rows (skip header and separator)
  const tableMatch = content.match(/\| Project \| Description \| Status \|[\s\S]*?(?=\n---|\n##|$)/);
  if (!tableMatch) return projects;

  const tableContent = tableMatch[0];
  const rows = tableContent.split("\n").filter(row => {
    // Skip header and separator rows
    return row.includes("|") &&
           !row.includes("Project | Description") &&
           !row.match(/^\|[-\s|]+\|$/);
  });

  for (const row of rows) {
    const cells = row.split("|").map(c => c.trim()).filter(c => c);
    if (cells.length >= 3) {
      projects.push({
        name: cells[0],
        description: cells[1],
        status: cells[2]
      });
    }
  }

  return projects;
}

/**
 * Parse simple bullet list items
 */
function parseBulletList(section: string): string[] {
  const items: string[] = [];
  const lines = section.split("\n");

  for (const line of lines) {
    const match = line.match(/^-\s+\*\*([^:]+):\*\*\s*(.+)$/);
    if (match) {
      items.push(`${match[1]}: ${match[2]}`);
    } else {
      const simpleMatch = line.match(/^-\s+(.+)$/);
      if (simpleMatch && simpleMatch[1].trim()) {
        items.push(simpleMatch[1].trim());
      }
    }
  }

  return items;
}

/**
 * Parse journal entries
 */
function parseJournal(content: string): TelosJournalEntry[] {
  const entries: TelosJournalEntry[] = [];

  // Match pattern: - **YYYY-MM-DD:** Entry content
  const regex = /-\s+\*\*(\d{4}-\d{2}-\d{2}):\*\*\s*(.+)/g;

  let match;
  while ((match = regex.exec(content)) !== null) {
    entries.push({
      date: match[1],
      content: match[2].trim()
    });
  }

  return entries;
}

/**
 * Extract a section by heading
 */
function extractSection(content: string, heading: string): string {
  const pattern = new RegExp(`## ${heading}[\\s\\S]*?(?=\\n## |$)`, "i");
  const match = content.match(pattern);
  return match ? match[0] : "";
}

/**
 * Main parser function
 */
export function parseTelos(telosPath: string = DEFAULT_TELOS_PATH): TelosData {
  if (!existsSync(telosPath)) {
    throw new Error(`TELOS file not found: ${telosPath}`);
  }

  const raw = readFileSync(telosPath, "utf-8");

  // Extract sections
  const problemsSection = extractSection(raw, "Problems");
  const missionSection = extractSection(raw, "Mission");
  const narrativesSection = extractSection(raw, "Narratives");
  const goalsSection = extractSection(raw, "Goals");
  const challengesSection = extractSection(raw, "Challenges");
  const strategiesSection = extractSection(raw, "Strategies");
  const projectsSection = extractSection(raw, "Projects");
  const skillsSection = extractSection(raw, "Skills & Interests");
  const ideasSection = extractSection(raw, "Ideas");
  const wisdomSection = extractSection(raw, "Wisdom");
  const metricsSection = extractSection(raw, "Metrics");
  const journalSection = extractSection(raw, "Log \\(Journal\\)");

  return {
    problems: parseItemSection(problemsSection, "P"),
    mission: parseItemSection(missionSection, "M"),
    narratives: parseItemSection(narrativesSection, "N"),
    goals: parseGoals(goalsSection),
    challenges: parseItemSection(challengesSection, "C"),
    strategies: parseItemSection(strategiesSection, "S"),
    projects: parseProjects(projectsSection),
    skills: parseBulletList(skillsSection),
    ideas: parseBulletList(ideasSection),
    wisdom: parseBulletList(wisdomSection),
    metrics: parseBulletList(metricsSection),
    journal: parseJournal(journalSection),
    raw
  };
}

/**
 * Get active goals (those not marked complete)
 */
export function getActiveGoals(telos: TelosData): TelosItem[] {
  return telos.goals; // All goals for now - could filter by status later
}

/**
 * Get goals by category
 */
export function getGoalsByCategory(telos: TelosData, category: "Professional" | "Personal"): TelosItem[] {
  return telos.goals.filter(g => g.category === category);
}

/**
 * Find goal by ID
 */
export function findGoal(telos: TelosData, goalId: string): TelosItem | undefined {
  return telos.goals.find(g => g.id === goalId);
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const telosPath = args.find(a => !a.startsWith("--")) || DEFAULT_TELOS_PATH;
  const outputJson = args.includes("--json");
  const showSection = args.find(a => a.startsWith("--section="))?.replace("--section=", "");

  try {
    const telos = parseTelos(telosPath);

    if (outputJson) {
      console.log(JSON.stringify(telos, null, 2));
      return;
    }

    if (showSection) {
      const section = telos[showSection as keyof TelosData];
      if (section) {
        console.log(JSON.stringify(section, null, 2));
      } else {
        console.error(`Unknown section: ${showSection}`);
        process.exit(1);
      }
      return;
    }

    // Default: summary output
    console.log("TELOS Summary");
    console.log("=============\n");

    console.log(`Problems: ${telos.problems.length}`);
    telos.problems.forEach(p => console.log(`  ${p.id}: ${p.content.substring(0, 60)}...`));

    console.log(`\nMission: ${telos.mission.length}`);
    telos.mission.forEach(m => console.log(`  ${m.id}: ${m.content.substring(0, 60)}...`));

    console.log(`\nGoals: ${telos.goals.length}`);
    telos.goals.forEach(g => {
      const cat = g.category ? ` [${g.category}]` : "";
      console.log(`  ${g.id}${cat}: ${g.content.substring(0, 50)}...`);
    });

    console.log(`\nProjects: ${telos.projects.length}`);
    telos.projects.forEach(p => console.log(`  - ${p.name} (${p.status})`));

    console.log(`\nJournal Entries: ${telos.journal.length}`);
    telos.journal.slice(-3).forEach(j => console.log(`  ${j.date}: ${j.content.substring(0, 40)}...`));

  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}
