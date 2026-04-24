#!/usr/bin/env bun
/**
 * codebase-recon.ts - Phase 0 Reconnaissance for C/C++ (and other) codebases
 *
 * Generates 11 static analysis reports from a codebase using grep/git/find heuristics.
 * No AI API calls, no network — pure local analysis.
 *
 * Usage:
 *   bun run codebase-recon.ts <path-to-repo> [--language cpp] [--output docs/recon]
 */

import { $ } from "bun";
import { parseArgs } from "util";
import { join, resolve, basename } from "path";
import { mkdir } from "fs/promises";

// ---------------------------------------------------------------------------
// CLI Parsing
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    language: { type: "string", short: "l" },
    output: { type: "string", short: "o", default: "docs/recon" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Usage: bun run codebase-recon.ts <path-to-repo> [options]

Options:
  -l, --language <lang>   Force language (cpp, c, ts, go, rust). Auto-detected if omitted.
  -o, --output <dir>      Output directory relative to repo root (default: docs/recon)
  -h, --help              Show this help

Example:
  bun run codebase-recon.ts ~/src/xbmc --language cpp
`);
  process.exit(0);
}

const repoPath = resolve(positionals[0]);
const outputDir = resolve(repoPath, values.output!);

// ---------------------------------------------------------------------------
// Language Detection
// ---------------------------------------------------------------------------

type Language = "cpp" | "c" | "ts" | "go" | "rust" | "java" | "python" | "unknown";

interface LangConfig {
  srcExtensions: string[];
  headerExtensions: string[];
  testPatterns: string[];
  functionPattern: string;
  classPattern: string;
  buildFiles: string[];
}

const LANG_CONFIGS: Record<string, LangConfig> = {
  cpp: {
    srcExtensions: ["cpp", "cc", "cxx", "c++", "c", "m", "mm"],
    headerExtensions: ["h", "hpp", "hxx", "h++"],
    testPatterns: ["*test*", "*Test*", "*_test.*", "*_tests.*", "*spec*"],
    functionPattern: "^\\s*\\w[\\w:<>*&\\s]+\\s+\\w+\\s*\\(",
    classPattern: "^\\s*(class|struct)\\s+\\w+",
    buildFiles: ["CMakeLists.txt", "Makefile", "meson.build", "BUILD"],
  },
  c: {
    srcExtensions: ["c"],
    headerExtensions: ["h"],
    testPatterns: ["*test*", "*Test*"],
    functionPattern: "^\\s*\\w[\\w*\\s]+\\s+\\w+\\s*\\(",
    classPattern: "^\\s*struct\\s+\\w+",
    buildFiles: ["CMakeLists.txt", "Makefile", "configure.ac"],
  },
  ts: {
    srcExtensions: ["ts", "tsx", "js", "jsx"],
    headerExtensions: [],
    testPatterns: ["*.test.*", "*.spec.*", "__tests__/*"],
    functionPattern: "(function\\s+\\w+|\\w+\\s*=\\s*(async\\s+)?\\(|export\\s+(async\\s+)?function)",
    classPattern: "^\\s*(export\\s+)?(abstract\\s+)?class\\s+\\w+",
    buildFiles: ["package.json", "tsconfig.json"],
  },
  go: {
    srcExtensions: ["go"],
    headerExtensions: [],
    testPatterns: ["*_test.go"],
    functionPattern: "^func\\s+",
    classPattern: "^type\\s+\\w+\\s+struct",
    buildFiles: ["go.mod", "go.sum"],
  },
  rust: {
    srcExtensions: ["rs"],
    headerExtensions: [],
    testPatterns: ["*test*"],
    functionPattern: "^\\s*(pub\\s+)?(async\\s+)?fn\\s+",
    classPattern: "^\\s*(pub\\s+)?struct\\s+\\w+",
    buildFiles: ["Cargo.toml"],
  },
};

async function detectLanguage(root: string): Promise<Language> {
  const markers: [string, Language][] = [
    ["CMakeLists.txt", "cpp"],
    ["Cargo.toml", "rust"],
    ["go.mod", "go"],
    ["package.json", "ts"],
    ["setup.py", "python"],
    ["pyproject.toml", "python"],
    ["Makefile", "c"],
  ];
  for (const [file, lang] of markers) {
    try {
      const result = await $`find ${root} -maxdepth 2 -name ${file} -print -quit 2>/dev/null`.text();
      if (result.trim()) return lang;
    } catch { /* continue */ }
  }
  // Count file extensions as fallback
  try {
    const cppCount = +(await $`find ${root} -name "*.cpp" -o -name "*.cc" -o -name "*.cxx" 2>/dev/null | head -100 | wc -l`.text()).trim();
    const cCount = +(await $`find ${root} -name "*.c" ! -name "*.cpp" ! -name "*.cc" 2>/dev/null | head -100 | wc -l`.text()).trim();
    if (cppCount > 10) return "cpp";
    if (cCount > 10) return "c";
  } catch { /* continue */ }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function shell(cmd: string, cwd: string): Promise<string> {
  try {
    const result = await $`bash -c ${cmd}`.cwd(cwd).text();
    return result;
  } catch {
    return "";
  }
}

function heading(title: string, level = 1): string {
  return `${"#".repeat(level)} ${title}\n\n`;
}

function fence(content: string, lang = ""): string {
  return `\`\`\`${lang}\n${content.trim()}\n\`\`\`\n\n`;
}

function hasGit(root: string): Promise<boolean> {
  return $`git -C ${root} rev-parse --is-inside-work-tree 2>/dev/null`
    .text()
    .then((t) => t.trim() === "true")
    .catch(() => false);
}

function srcGlob(cfg: LangConfig): string {
  return cfg.srcExtensions.map((e) => `"*.${e}"`).join(" -o -name ");
}

// ---------------------------------------------------------------------------
// Analysis Functions (each returns markdown)
// ---------------------------------------------------------------------------

async function godObjectDecomposition(root: string, cfg: LangConfig): Promise<string> {
  let md = heading("God Object Decomposition");
  md += "> Files exceeding 2000 lines, with method counts and clustering candidates.\n\n";

  const allExts = [...cfg.srcExtensions, ...cfg.headerExtensions];
  const findExpr = allExts.map((e) => `-name "*.${e}"`).join(" -o ");
  const bigFiles = await shell(
    `find . \\( ${findExpr} \\) -exec wc -l {} + 2>/dev/null | sort -rn | head -60`,
    root
  );

  const lines = bigFiles.split("\n").filter((l) => l.trim());
  const godFiles: { path: string; lines: number }[] = [];
  for (const line of lines) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match && !match[2].includes("total")) {
      const count = parseInt(match[1]);
      if (count > 2000) godFiles.push({ path: match[2], lines: count });
    }
  }

  md += `**Found ${godFiles.length} files exceeding 2000 lines.**\n\n`;

  if (godFiles.length === 0) {
    md += "No god objects detected at the 2000-line threshold.\n";
    return md;
  }

  md += "| Lines | File | Functions/Methods |\n|------:|------|-------------------|\n";

  for (const gf of godFiles.slice(0, 30)) {
    const funcCount = await shell(
      `grep -cE '${cfg.functionPattern}' "${gf.path}" 2>/dev/null || echo 0`,
      root
    );
    md += `| ${gf.lines} | \`${gf.path}\` | ${funcCount.trim()} |\n`;
  }
  md += "\n";

  if (godFiles.length > 30) {
    md += `_...and ${godFiles.length - 30} more files._\n\n`;
  }

  md += heading("Decomposition Candidates", 2);
  md += "Files above 5000 lines are strong decomposition candidates:\n\n";
  for (const gf of godFiles.filter((f) => f.lines > 5000).slice(0, 10)) {
    md += `- **\`${gf.path}\`** (${gf.lines} lines) - review for SRP violations\n`;
  }
  md += "\n";
  return md;
}

async function singletonAudit(root: string, cfg: LangConfig): Promise<string> {
  let md = heading("Singleton & Global State Audit");
  md += "> Identifies singletons, global variables, and shared mutable state.\n\n";

  const patterns: [string, string][] = [
    ["GetInstance()", "GetInstance\\(\\)"],
    ["g_ globals", "\\bg_[A-Za-z]"],
    ["s_ statics", "\\bs_[A-Za-z]"],
    ["static instance", "static\\s+\\w+\\s*\\*?\\s*\\w*[Ii]nstance"],
    ["extern declarations", "^\\s*extern\\s+"],
    ["::Get() singletons", "::Get\\(\\)"],
  ];

  for (const [label, pat] of patterns) {
    const count = await shell(
      `grep -rn --include='*.h' --include='*.hpp' --include='*.cpp' --include='*.cc' -cE '${pat}' . 2>/dev/null | awk -F: '{s+=$2}END{print s+0}'`,
      root
    );
    const files = await shell(
      `grep -rlE '${pat}' --include='*.h' --include='*.hpp' --include='*.cpp' --include='*.cc' . 2>/dev/null | head -10`,
      root
    );
    md += heading(label, 3);
    md += `**Occurrences:** ${count.trim()}\n\n`;
    if (files.trim()) {
      md += "Top files:\n";
      for (const f of files.trim().split("\n").filter(Boolean)) {
        md += `- \`${f}\`\n`;
      }
      md += "\n";
    }
  }
  return md;
}

async function testGapAnalysis(root: string, cfg: LangConfig): Promise<string> {
  let md = heading("Test Gap Analysis");
  md += "> Test coverage by directory, identifying subsystems with zero tests.\n\n";

  const allExts = [...cfg.srcExtensions, ...cfg.headerExtensions];
  const findExpr = allExts.map((e) => `-name "*.${e}"`).join(" -o ");

  const srcCount = await shell(
    `find . \\( ${findExpr} \\) ! -path "*/test/*" ! -path "*Test*" ! -name "*test*" ! -name "*Test*" ! -path "*/third_party/*" ! -path "*/vendor/*" 2>/dev/null | wc -l`,
    root
  );
  const testCount = await shell(
    `find . \\( ${findExpr} \\) \\( -path "*/test/*" -o -path "*Test*" -o -name "*test*" -o -name "*Test*" \\) ! -path "*/third_party/*" ! -path "*/vendor/*" 2>/dev/null | wc -l`,
    root
  );

  const src = parseInt(srcCount.trim()) || 0;
  const tst = parseInt(testCount.trim()) || 0;
  const ratio = src > 0 ? (tst / src * 100).toFixed(1) : "0";

  md += `| Metric | Count |\n|--------|------:|\n`;
  md += `| Source files | ${src} |\n`;
  md += `| Test files | ${tst} |\n`;
  md += `| Test/Source ratio | ${ratio}% |\n\n`;

  // Per top-level directory breakdown
  md += heading("Per-Directory Breakdown", 2);
  const topDirs = await shell(
    `find . -mindepth 1 -maxdepth 1 -type d ! -name ".*" ! -name "third_party" ! -name "vendor" ! -name "node_modules" ! -name "build" ! -name "out" | sort | head -30`,
    root
  );

  if (topDirs.trim()) {
    md += "| Directory | Source | Tests | Ratio |\n|-----------|-------:|------:|------:|\n";
    for (const dir of topDirs.trim().split("\n").filter(Boolean)) {
      const dirSrc = await shell(
        `find "${dir}" \\( ${findExpr} \\) ! -path "*/test/*" ! -name "*test*" ! -name "*Test*" 2>/dev/null | wc -l`,
        root
      );
      const dirTest = await shell(
        `find "${dir}" \\( ${findExpr} \\) \\( -path "*/test/*" -o -name "*test*" -o -name "*Test*" \\) 2>/dev/null | wc -l`,
        root
      );
      const ds = parseInt(dirSrc.trim()) || 0;
      const dt = parseInt(dirTest.trim()) || 0;
      const dr = ds > 0 ? (dt / ds * 100).toFixed(1) : "-";
      if (ds > 0 || dt > 0) {
        md += `| \`${dir}\` | ${ds} | ${dt} | ${dr}% |\n`;
      }
    }
    md += "\n";
  }

  md += heading("Zero-Test Subsystems", 2);
  md += "Directories with source files but no test files:\n\n";
  if (topDirs.trim()) {
    for (const dir of topDirs.trim().split("\n").filter(Boolean)) {
      const dirTest = await shell(
        `find "${dir}" \\( ${findExpr} \\) \\( -path "*/test/*" -o -name "*test*" -o -name "*Test*" \\) 2>/dev/null | wc -l`,
        root
      );
      const dirSrc = await shell(
        `find "${dir}" \\( ${findExpr} \\) ! -path "*/test/*" ! -name "*test*" 2>/dev/null | wc -l`,
        root
      );
      if (parseInt(dirTest.trim()) === 0 && parseInt(dirSrc.trim()) > 5) {
        md += `- \`${dir}\` (${dirSrc.trim()} source files, 0 tests)\n`;
      }
    }
  }
  md += "\n";
  return md;
}

async function crossCutting(root: string, cfg: LangConfig): Promise<string> {
  let md = heading("Cross-Cutting Concerns");
  md += "> Logging, error handling, threading, and memory management patterns.\n\n";

  const concerns: [string, string[]][] = [
    ["Logging Patterns", ["CLog::", "LOG_", "spdlog::", "printf(", "fprintf(stderr", "std::cerr", "qDebug", "ALOG"]],
    ["Error Handling", ["try\\s*{", "catch\\s*\\(", "throw\\s+", "errno", "GetLastError", "HRESULT", "std::error_code"]],
    ["Threading", ["std::thread", "std::mutex", "pthread_", "CThread", "CSingleLock", "std::lock_guard", "std::atomic", "std::condition_variable"]],
    ["Memory Management", ["new\\s+\\w", "delete\\s+", "malloc\\(", "free\\(", "std::shared_ptr", "std::unique_ptr", "std::make_shared", "std::make_unique"]],
    ["Assertions", ["assert\\(", "ASSERT\\(", "static_assert", "VERIFY\\("]],
  ];

  for (const [category, patterns] of concerns) {
    md += heading(category, 2);
    md += "| Pattern | Occurrences |\n|---------|------------:|\n";
    for (const pat of patterns) {
      const escapedPat = pat.replace(/'/g, "'\\''");
      const count = await shell(
        `grep -rn --include='*.cpp' --include='*.cc' --include='*.c' --include='*.h' --include='*.hpp' -cE '${escapedPat}' . 2>/dev/null | awk -F: '{s+=$2}END{print s+0}'`,
        root
      );
      md += `| \`${pat}\` | ${count.trim()} |\n`;
    }
    md += "\n";
  }
  return md;
}

async function platformAudit(root: string): Promise<string> {
  let md = heading("Platform Abstraction Audit");
  md += "> Platform-specific code paths and abstraction boundaries.\n\n";

  const ifdefs: [string, string][] = [
    ["Windows", "(_WIN32|WIN32|_MSC_VER|__WINDOWS__)"],
    ["Linux", "(__linux__|__LINUX__|linux)"],
    ["macOS/Darwin", "(__APPLE__|__MACH__|TARGET_OS_MAC)"],
    ["Android", "(__ANDROID__|ANDROID)"],
    ["iOS/tvOS", "(TARGET_OS_IOS|TARGET_OS_TV)"],
    ["FreeBSD", "__FreeBSD__"],
    ["ARM", "(__arm__|__aarch64__|ARM_)"],
    ["x86", "(__x86_64__|__i386__|_M_IX86|_M_X64)"],
  ];

  md += heading("Preprocessor Platform Guards", 2);
  md += "| Platform | #ifdef Count |\n|----------|-------------:|\n";
  for (const [platform, pattern] of ifdefs) {
    const count = await shell(
      `grep -rn --include='*.cpp' --include='*.cc' --include='*.c' --include='*.h' --include='*.hpp' --include='*.mm' -cE '#if.*${pattern}' . 2>/dev/null | awk -F: '{s+=$2}END{print s+0}'`,
      root
    );
    md += `| ${platform} | ${count.trim()} |\n`;
  }
  md += "\n";

  // Platform directories
  md += heading("Platform-Specific Directories", 2);
  const platDirs = await shell(
    `find . -type d \\( -iname "win32" -o -iname "windows" -o -iname "linux" -o -iname "darwin" -o -iname "osx" -o -iname "macos" -o -iname "android" -o -iname "ios" -o -iname "posix" -o -iname "platform" \\) ! -path "*/third_party/*" ! -path "*/.git/*" 2>/dev/null | sort`,
    root
  );
  if (platDirs.trim()) {
    for (const d of platDirs.trim().split("\n").filter(Boolean)) {
      const fileCount = await shell(`find "${d}" -type f | wc -l`, root);
      md += `- \`${d}\` (${fileCount.trim()} files)\n`;
    }
  } else {
    md += "No platform-specific directories found.\n";
  }
  md += "\n";
  return md;
}

async function dependencyGraph(root: string, cfg: LangConfig): Promise<string> {
  let md = heading("Dependency Graph (Include Analysis)");
  md += "> Header fan-out, most-included files, and circular dependency candidates.\n\n";

  // Most included headers
  md += heading("Most-Included Headers", 2);
  const topIncludes = await shell(
    `grep -rh --include='*.cpp' --include='*.cc' --include='*.c' --include='*.h' --include='*.hpp' '#include' . 2>/dev/null | sed 's/.*#include\\s*[<"]\\([^>"]*\\)[>"].*/\\1/' | sort | uniq -c | sort -rn | head -30`,
    root
  );
  if (topIncludes.trim()) {
    md += "| Includers | Header |\n|---------:|--------|\n";
    for (const line of topIncludes.trim().split("\n").filter(Boolean)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match) md += `| ${match[1]} | \`${match[2]}\` |\n`;
    }
    md += "\n";
  }

  // Fan-out: files that include the most other files
  md += heading("Highest Include Fan-Out", 2);
  const fanOut = await shell(
    `find . -name '*.cpp' -o -name '*.cc' -o -name '*.c' 2>/dev/null | head -5000 | while read f; do count=$(grep -c '#include' "$f" 2>/dev/null || echo 0); echo "$count $f"; done | sort -rn | head -20`,
    root
  );
  if (fanOut.trim()) {
    md += "| Includes | File |\n|---------:|------|\n";
    for (const line of fanOut.trim().split("\n").filter(Boolean)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match && parseInt(match[1]) > 5) md += `| ${match[1]} | \`${match[2]}\` |\n`;
    }
    md += "\n";
  }

  // Circular dependency candidates (A includes B and B includes A)
  md += heading("Circular Dependency Candidates", 2);
  md += "_Pairs of headers that include each other (sampled from top-level headers):_\n\n";
  const circularCheck = await shell(
    `find . -name '*.h' -o -name '*.hpp' 2>/dev/null | head -500 | while read f; do
      includes=$(grep -oP '#include\\s*"\\K[^"]+' "$f" 2>/dev/null)
      for inc in $includes; do
        target=$(find . -name "$(basename "$inc")" -print -quit 2>/dev/null)
        if [ -n "$target" ]; then
          if grep -q "$(basename "$f")" "$target" 2>/dev/null; then
            echo "- \\\`$f\\\` <-> \\\`$target\\\`"
          fi
        fi
      done
    done | sort -u | head -20`,
    root
  );
  md += circularCheck.trim() || "No obvious circular dependencies found in sampled headers.";
  md += "\n\n";
  return md;
}

async function conventions(root: string, isGit: boolean): Promise<string> {
  let md = heading("Code Conventions");
  md += "> Naming patterns, style observations, and commit conventions.\n\n";

  // Naming conventions (sample from headers)
  md += heading("Naming Patterns (sampled)", 2);
  const classNames = await shell(
    `grep -rhE '^\\s*(class|struct)\\s+[A-Z]\\w+' --include='*.h' --include='*.hpp' . 2>/dev/null | sed 's/.*\\(class\\|struct\\)\\s\\+//' | awk '{print $1}' | sed 's/[:{].*$//' | head -30`,
    root
  );
  if (classNames.trim()) {
    const names = classNames.trim().split("\n").filter(Boolean);
    const prefixed = names.filter((n) => /^[A-Z][A-Z]?[a-z]/.test(n) && /^C[A-Z]/.test(n));
    const camel = names.filter((n) => /^[A-Z][a-z]/.test(n));
    md += `- **Sample size:** ${names.length} classes/structs\n`;
    md += `- **C-prefixed (CClassName):** ${prefixed.length}\n`;
    md += `- **PascalCase (ClassName):** ${camel.length}\n`;
    md += `- **Examples:** ${names.slice(0, 8).map((n) => `\`${n}\``).join(", ")}\n\n`;
  }

  // Method naming
  const methodNames = await shell(
    `grep -rhE '^\\s*(virtual\\s+)?\\w[\\w:*&<>]+\\s+(\\w+)\\(' --include='*.h' --include='*.hpp' . 2>/dev/null | grep -oE '\\b[A-Za-z]\\w*\\(' | sed 's/($//' | sort -u | head -30`,
    root
  );
  if (methodNames.trim()) {
    const methods = methodNames.trim().split("\n").filter(Boolean);
    const pascal = methods.filter((m) => /^[A-Z][a-z]/.test(m));
    const camel = methods.filter((m) => /^[a-z]/.test(m));
    md += `- **PascalCase methods:** ${pascal.length} / ${methods.length}\n`;
    md += `- **camelCase methods:** ${camel.length} / ${methods.length}\n\n`;
  }

  // Commit conventions (if git)
  if (isGit) {
    md += heading("Commit Message Conventions", 2);
    const commits = await shell(
      `git log --oneline -50 2>/dev/null`,
      root
    );
    if (commits.trim()) {
      const msgs = commits.trim().split("\n").filter(Boolean);
      md += `**Last ${msgs.length} commits sampled.**\n\n`;
      // Check for conventional commits
      const conventional = msgs.filter((m) => /^\w+ (feat|fix|chore|docs|style|refactor|test|ci|build)[\(:]/.test(m));
      const bracketed = msgs.filter((m) => /^\w+ \[/.test(m));
      md += `- Conventional commits (feat/fix/...): ${conventional.length}\n`;
      md += `- Bracketed prefix [Component]: ${bracketed.length}\n`;
      md += `- Other: ${msgs.length - conventional.length - bracketed.length}\n\n`;
      md += "Recent examples:\n";
      for (const m of msgs.slice(0, 5)) {
        md += `- ${m}\n`;
      }
      md += "\n";
    }
  }
  return md;
}

async function buildSystem(root: string): Promise<string> {
  let md = heading("Build System Analysis");
  md += "> Build tool structure, conditional compilation, and feature gates.\n\n";

  // Detect build system
  const cmakeCount = await shell(`find . -name "CMakeLists.txt" 2>/dev/null | wc -l`, root);
  const makeCount = await shell(`find . -name "Makefile" -o -name "GNUmakefile" 2>/dev/null | wc -l`, root);
  const mesonCount = await shell(`find . -name "meson.build" 2>/dev/null | wc -l`, root);
  const bazelCount = await shell(`find . -name "BUILD" -o -name "BUILD.bazel" 2>/dev/null | wc -l`, root);

  md += "| Build System | File Count |\n|-------------|----------:|\n";
  md += `| CMake | ${cmakeCount.trim()} |\n`;
  md += `| Make | ${makeCount.trim()} |\n`;
  md += `| Meson | ${mesonCount.trim()} |\n`;
  md += `| Bazel | ${bazelCount.trim()} |\n\n`;

  // CMake analysis
  if (parseInt(cmakeCount.trim()) > 0) {
    md += heading("CMake Structure", 2);
    const topCmake = await shell(
      `find . -name "CMakeLists.txt" -maxdepth 3 2>/dev/null | sort | head -20`,
      root
    );
    if (topCmake.trim()) {
      md += "Top-level CMakeLists.txt files:\n";
      for (const f of topCmake.trim().split("\n").filter(Boolean)) {
        md += `- \`${f}\`\n`;
      }
      md += "\n";
    }

    // Feature options
    md += heading("CMake Options / Feature Gates", 2);
    const options = await shell(
      `grep -rh 'option(' --include='CMakeLists.txt' --include='*.cmake' . 2>/dev/null | head -30`,
      root
    );
    if (options.trim()) {
      md += fence(options, "cmake");
    } else {
      md += "No CMake option() declarations found.\n\n";
    }

    // find_package dependencies
    md += heading("External Dependencies (find_package)", 2);
    const deps = await shell(
      `grep -rhE 'find_package\\(\\w+' --include='CMakeLists.txt' --include='*.cmake' . 2>/dev/null | sed 's/.*find_package(\\([A-Za-z0-9_]*\\).*/\\1/' | sort -u`,
      root
    );
    if (deps.trim()) {
      md += deps.trim().split("\n").filter(Boolean).map((d) => `- \`${d}\``).join("\n") + "\n\n";
    }
  }
  return md;
}

async function hotspots(root: string, isGit: boolean): Promise<string> {
  let md = heading("Churn Hotspots");
  md += "> Files with highest change frequency (git log analysis).\n\n";

  if (!isGit) {
    md += "_Not a git repository - churn analysis unavailable._\n";
    return md;
  }

  // Most changed files in last year
  md += heading("Most-Changed Files (last 365 days)", 2);
  const churn = await shell(
    `git log --since="365 days ago" --name-only --pretty=format: 2>/dev/null | grep -vE '^$' | sort | uniq -c | sort -rn | head -30`,
    root
  );
  if (churn.trim()) {
    md += "| Changes | File |\n|--------:|------|\n";
    for (const line of churn.trim().split("\n").filter(Boolean)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match) md += `| ${match[1]} | \`${match[2]}\` |\n`;
    }
    md += "\n";
  }

  // Churn x Size (complexity hotspot)
  md += heading("Churn x Size (Complexity Hotspots)", 2);
  md += "_Files that are both large AND frequently changed:_\n\n";
  const hotspotData = await shell(
    `git log --since="365 days ago" --name-only --pretty=format: 2>/dev/null | grep -vE '^$' | sort | uniq -c | sort -rn | head -100 | while read count file; do
      if [ -f "$file" ]; then
        lines=$(wc -l < "$file" 2>/dev/null || echo 0)
        score=$((count * lines))
        if [ "$score" -gt 10000 ]; then
          echo "$score $count $lines $file"
        fi
      fi
    done | sort -rn | head -20`,
    root
  );
  if (hotspotData.trim()) {
    md += "| Score | Changes | Lines | File |\n|------:|--------:|------:|------|\n";
    for (const line of hotspotData.trim().split("\n").filter(Boolean)) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (match) md += `| ${match[1]} | ${match[2]} | ${match[3]} | \`${match[4]}\` |\n`;
    }
    md += "\n";
  } else {
    md += "No significant churn x size hotspots detected.\n\n";
  }

  // Top contributors
  md += heading("Top Contributors (last 365 days)", 2);
  const authors = await shell(
    `git log --since="365 days ago" --format='%aN' 2>/dev/null | sort | uniq -c | sort -rn | head -10`,
    root
  );
  if (authors.trim()) {
    md += "| Commits | Author |\n|--------:|--------|\n";
    for (const line of authors.trim().split("\n").filter(Boolean)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match) md += `| ${match[1]} | ${match[2]} |\n`;
    }
    md += "\n";
  }
  return md;
}

async function apiSurface(root: string, cfg: LangConfig): Promise<string> {
  let md = heading("API Surface Analysis");
  md += "> Public vs internal headers, exported symbols, abstraction leaks.\n\n";

  // Public vs private headers
  const publicHeaders = await shell(
    `find . -name '*.h' -o -name '*.hpp' 2>/dev/null | grep -iE '(include|public|api)/' | grep -v third_party | wc -l`,
    root
  );
  const privateHeaders = await shell(
    `find . -name '*.h' -o -name '*.hpp' 2>/dev/null | grep -iE '(src|private|internal|impl|detail)/' | grep -v third_party | wc -l`,
    root
  );
  const totalHeaders = await shell(
    `find . -name '*.h' -o -name '*.hpp' 2>/dev/null | grep -v third_party | wc -l`,
    root
  );

  md += "| Category | Count |\n|----------|------:|\n";
  md += `| Total headers | ${totalHeaders.trim()} |\n`;
  md += `| Public-path headers | ${publicHeaders.trim()} |\n`;
  md += `| Private-path headers | ${privateHeaders.trim()} |\n`;
  md += `| Unclassified | ${parseInt(totalHeaders.trim()) - parseInt(publicHeaders.trim()) - parseInt(privateHeaders.trim())} |\n\n`;

  // Exported symbols / visibility
  md += heading("Visibility Macros", 2);
  const visPatterns = ["__declspec(dllexport)", "__attribute__((visibility", "EXPORT", "API_PUBLIC", "DLL_EXPORT"];
  for (const pat of visPatterns) {
    const count = await shell(
      `grep -rl --include='*.h' --include='*.hpp' '${pat}' . 2>/dev/null | wc -l`,
      root
    );
    if (parseInt(count.trim()) > 0) {
      md += `- \`${pat}\`: ${count.trim()} headers\n`;
    }
  }
  md += "\n";

  // Large public headers (potential abstraction leaks)
  md += heading("Large Public Headers (potential leaks)", 2);
  const largeHeaders = await shell(
    `find . -name '*.h' -o -name '*.hpp' 2>/dev/null | grep -v third_party | while read f; do lines=$(wc -l < "$f"); if [ "$lines" -gt 500 ]; then echo "$lines $f"; fi; done | sort -rn | head -15`,
    root
  );
  if (largeHeaders.trim()) {
    md += "| Lines | Header |\n|------:|--------|\n";
    for (const line of largeHeaders.trim().split("\n").filter(Boolean)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match) md += `| ${match[1]} | \`${match[2]}\` |\n`;
    }
    md += "\n";
  } else {
    md += "No headers exceeding 500 lines found.\n\n";
  }
  return md;
}

async function deadCode(root: string, cfg: LangConfig): Promise<string> {
  let md = heading("Dead Code Candidates");
  md += "> Potentially unreferenced functions, vestigial ifdefs, and unused includes.\n\n";
  md += "_Note: These are heuristic-based candidates. False positives are expected._\n\n";

  // Vestigial #ifdefs (defined but never evaluated)
  md += heading("Vestigial Preprocessor Defines", 2);
  md += "Defines in headers referenced only in the defining file (sampled, possible dead defines):\n\n";
  const vestigial = await shell(
    `grep -rnE '#define\\s+[A-Z_]{6,}\\b' --include='*.h' --include='*.hpp' . 2>/dev/null | head -50 | while IFS=: read file line def_line; do
      def=$(echo "$def_line" | sed 's/#define\\s*\\([A-Z_]*\\).*/\\1/')
      count=$(grep -rl --include='*.cpp' --include='*.cc' --include='*.c' "$def" . 2>/dev/null | head -2 | wc -l)
      if [ "$count" -eq 0 ]; then
        echo "- \\\`$def\\\` (only in \\\`$file\\\`)"
      fi
    done | head -15`,
    root
  );
  md += vestigial.trim() || "No obvious vestigial defines detected (sampled top 50).";
  md += "\n\n";

  // TODO/FIXME/HACK/XXX markers
  md += heading("Technical Debt Markers", 2);
  const markers = ["TODO", "FIXME", "HACK", "XXX", "DEPRECATED", "WORKAROUND"];
  md += "| Marker | Count |\n|--------|------:|\n";
  for (const marker of markers) {
    const count = await shell(
      `grep -rn --include='*.cpp' --include='*.cc' --include='*.c' --include='*.h' --include='*.hpp' -cE '\\b${marker}\\b' . 2>/dev/null | awk -F: '{s+=$2}END{print s+0}'`,
      root
    );
    md += `| ${marker} | ${count.trim()} |\n`;
  }
  md += "\n";

  // Commented-out code blocks (heuristic: lines starting with // followed by code-like patterns)
  md += heading("Commented-Out Code (estimate)", 2);
  const commentedCode = await shell(
    `grep -rn --include='*.cpp' --include='*.cc' --include='*.c' -cE '^\\s*//(\\s)*(if|for|while|return|int|void|class|struct|#include)' . 2>/dev/null | awk -F: '{s+=$2}END{print s+0}'`,
    root
  );
  md += `Estimated commented-out code lines: **${commentedCode.trim()}**\n\n`;

  return md;
}

// ---------------------------------------------------------------------------
// Summary Generator
// ---------------------------------------------------------------------------

async function generateSummary(root: string, lang: Language, cfg: LangConfig, reports: string[], timing: number): Promise<string> {
  let md = heading(`Codebase Reconnaissance Summary: ${basename(root)}`);
  md += `- **Language:** ${lang}\n`;
  md += `- **Generated:** ${new Date().toISOString()}\n`;
  md += `- **Wall-clock time:** ${(timing / 1000).toFixed(1)}s\n\n`;

  // Quick stats
  const totalFiles = await shell(
    `find . -type f ! -path '*/.git/*' ! -path '*/node_modules/*' ! -path '*/build/*' 2>/dev/null | wc -l`,
    root
  );
  const allExts = [...cfg.srcExtensions, ...cfg.headerExtensions];
  const findExpr = allExts.map((e) => `-name "*.${e}"`).join(" -o ");
  const totalLines = await shell(
    `find . \\( ${findExpr} \\) ! -path '*/.git/*' 2>/dev/null | head -5000 | xargs wc -l 2>/dev/null | tail -1`,
    root
  );

  md += heading("Quick Stats", 2);
  md += `- **Total files:** ${totalFiles.trim()}\n`;
  md += `- **Lines of code (sampled):** ${totalLines.trim()}\n\n`;

  md += heading("Reports", 2);
  const reportNames = [
    "god-object-decomposition",
    "singleton-audit",
    "test-gap-analysis",
    "cross-cutting",
    "platform-audit",
    "dependency-graph",
    "conventions",
    "build-system",
    "hotspots",
    "api-surface",
    "dead-code",
  ];
  const reportTitles = [
    "God Object Decomposition",
    "Singleton & Global State Audit",
    "Test Gap Analysis",
    "Cross-Cutting Concerns",
    "Platform Abstraction Audit",
    "Dependency Graph",
    "Code Conventions",
    "Build System Analysis",
    "Churn Hotspots",
    "API Surface Analysis",
    "Dead Code Candidates",
  ];

  for (let i = 0; i < reportNames.length; i++) {
    md += `${i + 1}. [${reportTitles[i]}](./${reportNames[i]}.md)\n`;
  }
  md += "\n";

  md += heading("Next Steps", 2);
  md += "1. Review each report for high-priority findings\n";
  md += "2. Feed reports to AI agents for deeper decomposition analysis\n";
  md += "3. Use hotspots + god objects to prioritize refactoring targets\n";
  md += "4. Cross-reference test gaps with hotspots for risk assessment\n";
  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = performance.now();

  console.log(`\n--- Codebase Reconnaissance ---`);
  console.log(`Target: ${repoPath}`);

  // Validate repo path
  try {
    await $`test -d ${repoPath}`.quiet();
  } catch {
    console.error(`Error: ${repoPath} is not a directory`);
    process.exit(1);
  }

  // Detect language
  const lang = (values.language as Language) || (await detectLanguage(repoPath));
  const cfg = LANG_CONFIGS[lang] || LANG_CONFIGS.cpp;
  console.log(`Language: ${lang}`);

  // Check for git
  const isGit = await hasGit(repoPath);
  console.log(`Git repo: ${isGit}`);

  // Create output directory
  await mkdir(outputDir, { recursive: true });
  console.log(`Output: ${outputDir}`);
  console.log(`\nRunning 11 analyses in parallel...\n`);

  // Run all analyses in parallel
  const analyses: [string, Promise<string>][] = [
    ["god-object-decomposition", godObjectDecomposition(repoPath, cfg)],
    ["singleton-audit", singletonAudit(repoPath, cfg)],
    ["test-gap-analysis", testGapAnalysis(repoPath, cfg)],
    ["cross-cutting", crossCutting(repoPath, cfg)],
    ["platform-audit", platformAudit(repoPath)],
    ["dependency-graph", dependencyGraph(repoPath, cfg)],
    ["conventions", conventions(repoPath, isGit)],
    ["build-system", buildSystem(repoPath)],
    ["hotspots", hotspots(repoPath, isGit)],
    ["api-surface", apiSurface(repoPath, cfg)],
    ["dead-code", deadCode(repoPath, cfg)],
  ];

  const results = await Promise.allSettled(analyses.map(([, p]) => p));

  // Write each report
  const reportContents: string[] = [];
  for (let i = 0; i < analyses.length; i++) {
    const [name] = analyses[i];
    const result = results[i];
    const filePath = join(outputDir, `${name}.md`);

    if (result.status === "fulfilled") {
      await Bun.write(filePath, result.value);
      reportContents.push(result.value);
      console.log(`  [done] ${name}.md`);
    } else {
      const errorMd = `# ${name}\n\nAnalysis failed: ${result.reason}\n`;
      await Bun.write(filePath, errorMd);
      reportContents.push(errorMd);
      console.log(`  [FAIL] ${name}.md - ${result.reason}`);
    }
  }

  // Generate and write summary
  const elapsed = performance.now() - startTime;
  const summary = await generateSummary(repoPath, lang, cfg, reportContents, elapsed);
  await Bun.write(join(outputDir, "summary.md"), summary);
  console.log(`  [done] summary.md`);

  const finalTime = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\n--- Complete in ${finalTime}s ---`);
  console.log(`Reports: ${outputDir}/`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
