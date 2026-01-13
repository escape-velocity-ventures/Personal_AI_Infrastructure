#!/usr/bin/env bun
/**
 * ToolUsageSync.ts - Analyze and sync AI tool usage to TELOS metrics
 *
 * Parses Claude Code conversation files to extract tool usage patterns
 * and logs them as KPIs for tracking PAI capability utilization.
 *
 * Features:
 *   - Tool category tracking (file ops, search, shell, web, agents, etc.)
 *   - Development workflow tracking (build, test, lint, git operations)
 *   - Documentation activity tracking (markdown file edits)
 *   - Underutilization detection and tool diversity scoring
 *
 * Commands:
 *   analyze [--days 7]     Analyze tool usage for the last N days
 *   sync [--days 7]        Sync tool usage counts to TELOS metrics
 *   breakdown <file>       Show detailed breakdown for a specific conversation
 *   categories             Show tool category definitions
 *   underused [--days 7]   Show underutilized tools and suggestions
 *   diversity [--days 7]   Show tool diversity score and breakdown
 */

import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logMetric, getMetricsForDate } from "./MetricsLogger";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

// =============================================================================
// Tool Categories
// =============================================================================

const TOOL_CATEGORIES: Record<string, string[]> = {
  file_ops: ["Read", "Write", "Edit", "NotebookEdit"],
  search: ["Glob", "Grep"],
  shell: ["Bash", "KillShell"],
  web: ["WebSearch", "WebFetch"],
  agents: ["Task", "TaskOutput"],
  planning: ["TodoWrite", "EnterPlanMode", "ExitPlanMode"],
  interaction: ["AskUserQuestion"],
  skills: ["Skill"],
};

// =============================================================================
// Bash Command Subcategories (for development workflow tracking)
// =============================================================================

interface BashPattern {
  pattern: RegExp;
  category: string;
}

const BASH_PATTERNS: BashPattern[] = [
  // Package management
  { pattern: /\b(bun|npm|yarn|pnpm)\s+(install|add|remove|update)/i, category: "dev_deps" },

  // Type checking and linting
  { pattern: /\b(typecheck|tsc|eslint|prettier|lint)/i, category: "dev_lint" },

  // Testing
  { pattern: /\b(test|jest|vitest|mocha|pytest|spec)/i, category: "dev_test" },

  // Building
  { pattern: /\b(build|compile|bundle|webpack|vite|esbuild)/i, category: "dev_build" },

  // Running servers/scripts
  { pattern: /\b(bun|node|python|deno)\s+run\s+(?!test)/i, category: "dev_run" },
  { pattern: /\bstart\b/i, category: "dev_run" },

  // Git operations
  { pattern: /\bgit\s+(status|diff|add|commit|push|pull|checkout|branch|merge|rebase|log|stash)/i, category: "git_ops" },
  { pattern: /\bgh\s+(pr|issue|repo)/i, category: "git_ops" },

  // API/HTTP testing
  { pattern: /\bcurl\b/i, category: "api_test" },
  { pattern: /\bhttpie?\b/i, category: "api_test" },

  // Process management
  { pattern: /\b(pkill|kill|lsof|ps|pgrep)/i, category: "process_mgmt" },

  // Directory/file management
  { pattern: /\b(mkdir|rm|mv|cp|chmod|chown)\b/i, category: "file_mgmt" },
  { pattern: /\bls\b/i, category: "file_mgmt" },
];

// Categories for Bash commands
const BASH_CATEGORIES: Record<string, string> = {
  dev_deps: "Dependency Management",
  dev_lint: "Linting & Type Checking",
  dev_test: "Testing",
  dev_build: "Building",
  dev_run: "Running Scripts",
  git_ops: "Git Operations",
  api_test: "API Testing",
  process_mgmt: "Process Management",
  file_mgmt: "File Management",
  other: "Other Shell Commands",
};

// =============================================================================
// KPI Mappings
// =============================================================================

const CATEGORY_KPIS: Record<string, string> = {
  // Main tool categories
  file_ops: "tool_file_ops",
  search: "tool_search",
  shell: "tool_shell",
  web: "tool_web",
  agents: "tool_agents",
  planning: "tool_planning",
  interaction: "tool_interaction",
  skills: "tool_skills",

  // Development workflow (Bash subcategories)
  dev_deps: "dev_deps",
  dev_lint: "dev_lint",
  dev_test: "dev_test",
  dev_build: "dev_build",
  dev_run: "dev_run",
  git_ops: "git_ops",
  api_test: "api_test",

  // Documentation
  docs: "docs_edits",

  // Diversity
  tool_diversity: "tool_diversity",
};

// All available tools in Claude Code
const ALL_AVAILABLE_TOOLS = [
  "Read", "Write", "Edit", "NotebookEdit",
  "Glob", "Grep",
  "Bash", "KillShell",
  "WebSearch", "WebFetch",
  "Task", "TaskOutput",
  "TodoWrite", "EnterPlanMode", "ExitPlanMode",
  "AskUserQuestion",
  "Skill",
];

// =============================================================================
// Types
// =============================================================================

interface ToolCall {
  name: string;
  input?: Record<string, unknown>;
}

interface ToolUsage {
  tool: string;
  count: number;
}

interface ConversationAnalysis {
  file: string;
  project: string;
  date: string;
  title: string;
  totalToolCalls: number;
  toolUsage: ToolUsage[];
  categoryUsage: Record<string, number>;
  bashCategories: Record<string, number>;
  docsEdits: number;
  uniqueTools: Set<string>;
}

interface DailyAnalysis {
  date: string;
  conversations: number;
  totalToolCalls: number;
  toolUsage: Map<string, number>;
  categoryUsage: Record<string, number>;
  bashCategories: Record<string, number>;
  docsEdits: number;
  uniqueTools: Set<string>;
}

// =============================================================================
// Helper Functions
// =============================================================================

function getToolCategory(toolName: string): string | null {
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if (tools.includes(toolName)) {
      return category;
    }
  }
  return null;
}

function getBashCategory(command: string): string {
  for (const { pattern, category } of BASH_PATTERNS) {
    if (pattern.test(command)) {
      return category;
    }
  }
  return "other";
}

function isDocumentationEdit(toolName: string, input: Record<string, unknown> | undefined): boolean {
  if (!input) return false;

  if (toolName === "Write" || toolName === "Edit") {
    const filePath = input.file_path as string || "";
    return filePath.endsWith(".md") || filePath.endsWith(".mdx");
  }

  return false;
}

function calculateDiversity(uniqueTools: Set<string>, totalTools: number): number {
  // Diversity score: percentage of available tools used, weighted by usage
  const toolsUsed = uniqueTools.size;
  const availableTools = ALL_AVAILABLE_TOOLS.length;

  // Base score: % of tools used
  const baseScore = (toolsUsed / availableTools) * 100;

  return Math.round(baseScore);
}

// =============================================================================
// Analysis Functions
// =============================================================================

function analyzeConversation(filePath: string): ConversationAnalysis | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(line => line.trim());

    if (lines.length === 0) return null;

    let title = "Untitled";
    const toolCounts = new Map<string, number>();
    const categoryUsage: Record<string, number> = {};
    const bashCategories: Record<string, number> = {};
    const uniqueTools = new Set<string>();
    let docsEdits = 0;

    // Initialize counts
    for (const category of Object.keys(TOOL_CATEGORIES)) {
      categoryUsage[category] = 0;
    }
    for (const category of Object.keys(BASH_CATEGORIES)) {
      bashCategories[category] = 0;
    }

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.type === "custom-title" && entry.customTitle) {
          title = entry.customTitle;
        }

        if (entry.message?.content && Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === "tool_use" && block.name) {
              const toolName = block.name;
              const input = block.input as Record<string, unknown> | undefined;

              const currentCount = toolCounts.get(toolName) || 0;
              toolCounts.set(toolName, currentCount + 1);
              uniqueTools.add(toolName);

              // Main category
              const category = getToolCategory(toolName);
              if (category) {
                categoryUsage[category]++;
              }

              // Bash subcategorization
              if (toolName === "Bash" && input?.command) {
                const bashCat = getBashCategory(input.command as string);
                bashCategories[bashCat] = (bashCategories[bashCat] || 0) + 1;
              }

              // Documentation tracking
              if (isDocumentationEdit(toolName, input)) {
                docsEdits++;
              }
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    const stat = statSync(filePath);
    const project = filePath.split("/").slice(-2, -1)[0] || "unknown";

    return {
      file: filePath,
      project,
      date: stat.mtime.toISOString().split("T")[0],
      title,
      totalToolCalls: Array.from(toolCounts.values()).reduce((a, b) => a + b, 0),
      toolUsage: Array.from(toolCounts.entries())
        .map(([tool, count]) => ({ tool, count }))
        .sort((a, b) => b.count - a.count),
      categoryUsage,
      bashCategories,
      docsEdits,
      uniqueTools,
    };
  } catch {
    return null;
  }
}

function getConversationFiles(): Array<{ path: string; mtime: Date; project: string }> {
  const files: Array<{ path: string; mtime: Date; project: string }> = [];

  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    return files;
  }

  const projects = readdirSync(CLAUDE_PROJECTS_DIR);

  for (const project of projects) {
    const projectPath = join(CLAUDE_PROJECTS_DIR, project);
    const stat = statSync(projectPath);

    if (!stat.isDirectory()) continue;

    const projectFiles = readdirSync(projectPath);

    for (const file of projectFiles) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = join(projectPath, file);
      const fileStat = statSync(filePath);

      if (fileStat.size === 0) continue;

      files.push({
        path: filePath,
        mtime: fileStat.mtime,
        project: project
      });
    }
  }

  return files;
}

function analyzeByDate(days: number = 7): DailyAnalysis[] {
  const files = getConversationFiles();
  const dailyData = new Map<string, DailyAnalysis>();

  const today = new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    dailyData.set(dateStr, {
      date: dateStr,
      conversations: 0,
      totalToolCalls: 0,
      toolUsage: new Map(),
      categoryUsage: Object.fromEntries(
        Object.keys(TOOL_CATEGORIES).map(k => [k, 0])
      ),
      bashCategories: Object.fromEntries(
        Object.keys(BASH_CATEGORIES).map(k => [k, 0])
      ),
      docsEdits: 0,
      uniqueTools: new Set(),
    });
  }

  for (const file of files) {
    const dateStr = file.mtime.toISOString().split("T")[0];
    const daily = dailyData.get(dateStr);

    if (!daily) continue;

    const analysis = analyzeConversation(file.path);
    if (!analysis) continue;

    daily.conversations++;
    daily.totalToolCalls += analysis.totalToolCalls;
    daily.docsEdits += analysis.docsEdits;

    for (const { tool, count } of analysis.toolUsage) {
      const current = daily.toolUsage.get(tool) || 0;
      daily.toolUsage.set(tool, current + count);
      daily.uniqueTools.add(tool);
    }

    for (const [category, count] of Object.entries(analysis.categoryUsage)) {
      daily.categoryUsage[category] += count;
    }

    for (const [category, count] of Object.entries(analysis.bashCategories)) {
      daily.bashCategories[category] = (daily.bashCategories[category] || 0) + count;
    }
  }

  return Array.from(dailyData.values()).sort((a, b) => b.date.localeCompare(a.date));
}

// =============================================================================
// Sync Functions
// =============================================================================

function hasLoggedForDate(date: Date, kpiId: string): boolean {
  const entries = getMetricsForDate(date);
  return entries.some(e => e.kpi_id === kpiId);
}

async function syncToolUsage(days: number = 7): Promise<void> {
  console.log(`\n🔄 Syncing tool usage for last ${days} days...\n`);

  const dailyAnalysis = analyzeByDate(days);
  let synced = 0;
  let skipped = 0;

  for (const daily of dailyAnalysis) {
    const dateObj = new Date(daily.date + "T12:00:00");
    const isToday = daily.date === new Date().toISOString().split("T")[0];

    // Sync main tool categories
    for (const [category, kpiId] of Object.entries(CATEGORY_KPIS)) {
      let count = 0;

      if (category in daily.categoryUsage) {
        count = daily.categoryUsage[category];
      } else if (category in daily.bashCategories) {
        count = daily.bashCategories[category];
      } else if (category === "docs") {
        count = daily.docsEdits;
      } else if (category === "tool_diversity") {
        count = calculateDiversity(daily.uniqueTools, daily.totalToolCalls);
      }

      if (hasLoggedForDate(dateObj, kpiId) && !isToday) {
        skipped++;
        continue;
      }

      if (count > 0) {
        try {
          const logTimestamp = isToday ? undefined : dateObj;
          logMetric(kpiId, count, isToday ? undefined : "auto-sync", logTimestamp);
          synced++;
        } catch {
          // KPI might not exist yet
        }
      }
    }

    if (daily.totalToolCalls > 0) {
      const diversity = calculateDiversity(daily.uniqueTools, daily.totalToolCalls);
      console.log(`  ${daily.date}: ${daily.totalToolCalls} tool calls, ${daily.uniqueTools.size} unique tools (${diversity}% diversity)`);
    }
  }

  console.log(`\n✅ Synced ${synced} metrics, skipped ${skipped}`);
}

// =============================================================================
// Display Functions
// =============================================================================

function showAnalysis(days: number = 7): void {
  const dailyAnalysis = analyzeByDate(days);

  console.log(`\n📊 Tool Usage Analysis (Last ${days} days)\n`);

  console.log("Date        | Convos | Tool Calls | Unique | Diversity | Docs");
  console.log("------------|--------|------------|--------|-----------|------");

  for (const daily of dailyAnalysis) {
    const diversity = calculateDiversity(daily.uniqueTools, daily.totalToolCalls);
    console.log(
      `${daily.date} | ${daily.conversations.toString().padStart(6)} | ${daily.totalToolCalls.toString().padStart(10)} | ${daily.uniqueTools.size.toString().padStart(6)} | ${diversity.toString().padStart(8)}% | ${daily.docsEdits.toString().padStart(4)}`
    );
  }

  // Aggregate stats
  const totals = dailyAnalysis.reduce(
    (acc, d) => {
      acc.conversations += d.conversations;
      acc.toolCalls += d.totalToolCalls;
      acc.docsEdits += d.docsEdits;
      for (const tool of d.uniqueTools) {
        acc.uniqueTools.add(tool);
      }
      for (const [cat, count] of Object.entries(d.categoryUsage)) {
        acc.categories[cat] = (acc.categories[cat] || 0) + count;
      }
      for (const [cat, count] of Object.entries(d.bashCategories)) {
        acc.bashCategories[cat] = (acc.bashCategories[cat] || 0) + count;
      }
      for (const [tool, count] of d.toolUsage.entries()) {
        acc.tools.set(tool, (acc.tools.get(tool) || 0) + count);
      }
      return acc;
    },
    {
      conversations: 0,
      toolCalls: 0,
      docsEdits: 0,
      uniqueTools: new Set<string>(),
      categories: {} as Record<string, number>,
      bashCategories: {} as Record<string, number>,
      tools: new Map<string, number>()
    }
  );

  console.log(`\n📈 Totals:`);
  console.log(`   Conversations: ${totals.conversations}`);
  console.log(`   Tool Calls: ${totals.toolCalls}`);
  console.log(`   Documentation Edits: ${totals.docsEdits}`);
  console.log(`   Unique Tools Used: ${totals.uniqueTools.size}/${ALL_AVAILABLE_TOOLS.length}`);

  console.log(`\n📁 By Tool Category:`);
  for (const [category, count] of Object.entries(totals.categories).sort((a, b) => b[1] - a[1])) {
    const pct = totals.toolCalls > 0 ? ((count / totals.toolCalls) * 100).toFixed(1) : 0;
    const bar = "█".repeat(Math.round(Number(pct) / 2));
    console.log(`   ${category.padEnd(12)} ${count.toString().padStart(5)} (${pct}%) ${bar}`);
  }

  console.log(`\n🛠️  Development Workflow (Bash breakdown):`);
  for (const [category, count] of Object.entries(totals.bashCategories).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      const name = BASH_CATEGORIES[category] || category;
      console.log(`   ${name.padEnd(22)} ${count.toString().padStart(5)}`);
    }
  }

  console.log(`\n🔧 Top 10 Tools:`);
  const topTools = Array.from(totals.tools.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [tool, count] of topTools) {
    const pct = totals.toolCalls > 0 ? ((count / totals.toolCalls) * 100).toFixed(1) : 0;
    console.log(`   ${tool.padEnd(15)} ${count.toString().padStart(5)} (${pct}%)`);
  }
}

function showUnderusedTools(days: number = 7): void {
  const dailyAnalysis = analyzeByDate(days);

  const usedTools = new Set<string>();
  for (const daily of dailyAnalysis) {
    for (const tool of daily.uniqueTools) {
      usedTools.add(tool);
    }
  }

  const unusedTools = ALL_AVAILABLE_TOOLS.filter(t => !usedTools.has(t));
  const rarelyUsedTools: Array<{ tool: string; count: number }> = [];

  const totalCounts = new Map<string, number>();
  for (const daily of dailyAnalysis) {
    for (const [tool, count] of daily.toolUsage.entries()) {
      totalCounts.set(tool, (totalCounts.get(tool) || 0) + count);
    }
  }

  const totalToolCalls = Array.from(totalCounts.values()).reduce((a, b) => a + b, 0);

  for (const [tool, count] of totalCounts.entries()) {
    const pct = (count / totalToolCalls) * 100;
    if (pct < 2) { // Less than 2% usage
      rarelyUsedTools.push({ tool, count });
    }
  }

  console.log(`\n🔍 Underutilized Tools Analysis (Last ${days} days)\n`);

  if (unusedTools.length > 0) {
    console.log(`❌ Never Used (${unusedTools.length} tools):`);
    for (const tool of unusedTools) {
      const category = getToolCategory(tool);
      console.log(`   ${tool.padEnd(18)} - ${getToolDescription(tool)}`);
    }
  } else {
    console.log(`✅ All available tools have been used!`);
  }

  if (rarelyUsedTools.length > 0) {
    console.log(`\n⚠️  Rarely Used (<2% of calls):`);
    for (const { tool, count } of rarelyUsedTools.sort((a, b) => a.count - b.count)) {
      const pct = ((count / totalToolCalls) * 100).toFixed(1);
      console.log(`   ${tool.padEnd(18)} ${count.toString().padStart(4)} calls (${pct}%)`);
    }
  }

  console.log(`\n💡 Suggestions to increase tool diversity:`);

  if (!usedTools.has("Task")) {
    console.log(`   • Use Task tool to delegate complex research to sub-agents`);
  }
  if (!usedTools.has("WebSearch") || (totalCounts.get("WebSearch") || 0) < 10) {
    console.log(`   • Use WebSearch for current information and documentation lookups`);
  }
  if (!usedTools.has("Glob") || (totalCounts.get("Glob") || 0) < 10) {
    console.log(`   • Use Glob for finding files by pattern instead of manual navigation`);
  }
  if (!usedTools.has("TodoWrite") || (totalCounts.get("TodoWrite") || 0) < 20) {
    console.log(`   • Use TodoWrite more to track progress on complex tasks`);
  }
  if (!usedTools.has("AskUserQuestion")) {
    console.log(`   • Use AskUserQuestion to clarify requirements before implementing`);
  }
}

function getToolDescription(tool: string): string {
  const descriptions: Record<string, string> = {
    Read: "Read file contents",
    Write: "Create new files",
    Edit: "Modify existing files",
    NotebookEdit: "Edit Jupyter notebooks",
    Glob: "Find files by pattern",
    Grep: "Search file contents",
    Bash: "Execute shell commands",
    KillShell: "Stop background processes",
    WebSearch: "Search the web",
    WebFetch: "Fetch web page content",
    Task: "Delegate to sub-agents",
    TaskOutput: "Get sub-agent results",
    TodoWrite: "Track task progress",
    EnterPlanMode: "Start planning phase",
    ExitPlanMode: "Complete planning",
    AskUserQuestion: "Ask clarifying questions",
    Skill: "Invoke PAI skills",
  };
  return descriptions[tool] || "Unknown tool";
}

function showDiversity(days: number = 7): void {
  const dailyAnalysis = analyzeByDate(days);

  console.log(`\n🌈 Tool Diversity Analysis (Last ${days} days)\n`);

  console.log("Date        | Tools Used | Available | Diversity Score");
  console.log("------------|------------|-----------|----------------");

  for (const daily of dailyAnalysis) {
    const diversity = calculateDiversity(daily.uniqueTools, daily.totalToolCalls);
    const bar = "█".repeat(Math.round(diversity / 5));
    console.log(
      `${daily.date} | ${daily.uniqueTools.size.toString().padStart(10)} | ${ALL_AVAILABLE_TOOLS.length.toString().padStart(9)} | ${diversity}% ${bar}`
    );
  }

  // Overall diversity
  const allUsedTools = new Set<string>();
  for (const daily of dailyAnalysis) {
    for (const tool of daily.uniqueTools) {
      allUsedTools.add(tool);
    }
  }

  const overallDiversity = Math.round((allUsedTools.size / ALL_AVAILABLE_TOOLS.length) * 100);

  console.log(`\n📊 Overall: ${allUsedTools.size}/${ALL_AVAILABLE_TOOLS.length} tools used (${overallDiversity}% diversity)`);

  console.log(`\n✅ Tools Used:`);
  for (const tool of ALL_AVAILABLE_TOOLS) {
    const status = allUsedTools.has(tool) ? "✓" : "✗";
    const color = allUsedTools.has(tool) ? "" : " (unused)";
    console.log(`   ${status} ${tool}${color}`);
  }
}

function showCategories(): void {
  console.log("\n📋 Tool Categories\n");

  console.log("=== Main Tool Categories ===\n");
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    const kpiId = CATEGORY_KPIS[category];
    console.log(`${category} (KPI: ${kpiId})`);
    console.log(`   Tools: ${tools.join(", ")}`);
    console.log();
  }

  console.log("=== Development Workflow Categories (Bash) ===\n");
  for (const [category, description] of Object.entries(BASH_CATEGORIES)) {
    const kpiId = CATEGORY_KPIS[category] || "n/a";
    console.log(`${category}: ${description} (KPI: ${kpiId})`);
  }
}

function showBreakdown(filePath: string): void {
  const analysis = analyzeConversation(filePath);

  if (!analysis) {
    console.error(`Could not analyze: ${filePath}`);
    return;
  }

  console.log(`\n📊 Conversation Analysis\n`);
  console.log(`Title: ${analysis.title}`);
  console.log(`Date: ${analysis.date}`);
  console.log(`Project: ${analysis.project}`);
  console.log(`Total Tool Calls: ${analysis.totalToolCalls}`);
  console.log(`Unique Tools: ${analysis.uniqueTools.size}`);
  console.log(`Diversity: ${calculateDiversity(analysis.uniqueTools, analysis.totalToolCalls)}%`);
  console.log(`Documentation Edits: ${analysis.docsEdits}`);

  console.log(`\n🔧 Tool Usage:`);
  for (const { tool, count } of analysis.toolUsage) {
    const category = getToolCategory(tool) || "uncategorized";
    console.log(`   ${tool.padEnd(15)} ${count.toString().padStart(4)} (${category})`);
  }

  console.log(`\n📁 By Category:`);
  for (const [category, count] of Object.entries(analysis.categoryUsage).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      console.log(`   ${category.padEnd(12)} ${count}`);
    }
  }

  if (Object.values(analysis.bashCategories).some(c => c > 0)) {
    console.log(`\n🛠️  Bash Breakdown:`);
    for (const [category, count] of Object.entries(analysis.bashCategories).sort((a, b) => b[1] - a[1])) {
      if (count > 0) {
        const name = BASH_CATEGORIES[category] || category;
        console.log(`   ${name.padEnd(22)} ${count}`);
      }
    }
  }
}

// =============================================================================
// CLI Interface
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "analyze";

  switch (command) {
    case "analyze": {
      const daysIndex = args.indexOf("--days");
      const days = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : 7;
      showAnalysis(days);
      break;
    }

    case "sync": {
      const daysIndex = args.indexOf("--days");
      const days = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : 7;
      await syncToolUsage(days);
      break;
    }

    case "breakdown": {
      const filePath = args[1];
      if (!filePath) {
        console.error("Usage: breakdown <file_path>");
        process.exit(1);
      }
      showBreakdown(filePath);
      break;
    }

    case "categories":
      showCategories();
      break;

    case "underused": {
      const daysIndex = args.indexOf("--days");
      const days = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : 7;
      showUnderusedTools(days);
      break;
    }

    case "diversity": {
      const daysIndex = args.indexOf("--days");
      const days = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : 7;
      showDiversity(days);
      break;
    }

    case "help":
    default:
      console.log("Tool Usage Analyzer for TELOS\n");
      console.log("Commands:");
      console.log("  analyze [--days 7]     Analyze tool usage with dev workflow breakdown");
      console.log("  sync [--days 7]        Sync to TELOS metrics");
      console.log("  breakdown <file>       Analyze specific conversation");
      console.log("  categories             Show all tool category definitions");
      console.log("  underused [--days 7]   Show underutilized tools and suggestions");
      console.log("  diversity [--days 7]   Show tool diversity score");
      console.log("  help                   Show this help");
  }
}

if (import.meta.main) {
  main();
}
