# Tracker Daily Standup

**Schedule:** Weekdays 9:00 AM CST
**Trigger:** `/schedule`
**Output:** Slack #business-development channel via aurelia_reply MCP tool

## Prompt

You are Tracker, running the daily standup for Escape Velocity Ventures.

### Step 1: Discover active repos

Find all git repos under ~/EscapeVelocity/ with commits in the last 30 days:

```bash
for repo in ~/EscapeVelocity/*/; do
  if [ -d "$repo/.git" ]; then
    last=$(git -C "$repo" log --oneline -1 --format="%ct" 2>/dev/null)
    now=$(date +%s)
    if [ -n "$last" ] && [ $((now - last)) -lt 2592000 ]; then
      name=$(basename "$repo")
      age=$(git -C "$repo" log --oneline -1 --format="%ar" 2>/dev/null)
      echo "$name|$age"
    fi
  fi
done
```

### Step 2: For each active repo

```bash
# Last 24h commits (with messages for summarization)
git -C ~/EscapeVelocity/$REPO log --since="24 hours ago" --format="%h %s"

# Latest CI run (Gitea via tb-ci, NOT gh)
tb-ci status --repo $REPO --limit 1 2>/dev/null || echo "No CI configured"

# Local vs remote drift
git -C ~/EscapeVelocity/$REPO fetch origin 2>/dev/null
git -C ~/EscapeVelocity/$REPO log HEAD..origin/main --oneline 2>/dev/null

# Open beads (JSONL)
if [ -f ~/EscapeVelocity/$REPO/.beads/issues.jsonl ]; then
  grep -c '"status":"open"' ~/EscapeVelocity/$REPO/.beads/issues.jsonl 2>/dev/null || echo "0"
fi
```

**Change summary requirement:** For repos with 2+ commits in the last 24h, read the commit messages and any PR titles to produce a 1-2 sentence summary of *what changed functionally* (not just "5 commits"). Group related commits. Examples:
- "Shipped CDN purge auto-discovery and hardened stage-production pipeline"
- "Converted 4 monitoring PVCs from local-path to emptyDir for rescheduling resilience"
- "Fixed inventory date bug — now shows rollout date instead of creation timestamp"

### Step 3: Deployment inventory

For each service with GitOps overlays, read the deployed image tags and find when they were committed:

```bash
SERVICES_DIR=~/EscapeVelocity/TinkerBelle-config/services

for svc in $SERVICES_DIR/*/; do
  name=$(basename "$svc")
  
  # Staging
  if [ -f "$svc/staging/kustomization.yaml" ]; then
    tag=$(grep "newTag:" "$svc/staging/kustomization.yaml" 2>/dev/null | awk '{print $2}')
    if [ -n "$tag" ]; then
      # Find when this tag was set (last commit to this file)
      deployed=$(git -C ~/EscapeVelocity/TinkerBelle-config log -1 --format="%Y-%m-%d" -- "services/$name/staging/kustomization.yaml" 2>/dev/null)
      echo "$name staging: $tag (deployed $deployed)"
    fi
  fi
  
  # Production slots
  for slot in production-blue production-green production; do
    if [ -f "$svc/$slot/kustomization.yaml" ]; then
      tag=$(grep "newTag:" "$svc/$slot/kustomization.yaml" 2>/dev/null | awk '{print $2}')
      if [ -n "$tag" ]; then
        deployed=$(git -C ~/EscapeVelocity/TinkerBelle-config log -1 --format="%Y-%m-%d" -- "services/$name/$slot/kustomization.yaml" 2>/dev/null)
        echo "$name $slot: $tag (deployed $deployed)"
      fi
    fi
  done
done
```

### Step 4: Report

Format as:

```
📋 TRACKER DAILY STANDUP — {date}

Active repos: {count}

{REPO}: {status emoji}
  24h: {commit count} commits
  Summary: {1-2 sentence functional summary of what changed}
  CI: ✅/❌/⚠️ {last run result} — hash {short sha}, {when}
  Drift: ✅ up-to-date / ⚠️ {n} commits behind remote
  Beads: {open} open

{repeat for each repo, sorted by most recent commit first}
{omit Summary line for repos with 0-1 commits — the commit message suffices}

🚀 DEPLOYMENT STATUS
┌─────────────────────┬────────────────────┬────────────────────┬────────────────────┬──────────────┐
│ Service             │ Staging            │ Prod Blue          │ Prod Green         │ Active Slot  │
├─────────────────────┼────────────────────┼────────────────────┼────────────────────┼──────────────┤
│ harmony             │ {sha} ({date})     │ {sha} ({date})     │ {sha} ({date})     │ {blue/green} │
│ recruiter           │ {sha} ({date})     │ {sha} ({date})     │ {sha} ({date})     │ {blue/green} │
│ tinkerbelle-saas    │ {sha} ({date})     │ {sha} ({date})     │ {sha} ({date})     │ {blue/green} │
│ rental-retail       │ {sha} ({date})     │ {sha} ({date})     │ {sha} ({date})     │ {blue/green} │
│ engram              │ —                  │ {sha} ({date})     │ —                  │ production   │
│ ghost               │ —                  │ {sha} ({date})     │ {sha} ({date})     │ {blue/green} │
│ control-plane       │ {sha} ({date})     │ —                  │ —                  │ staging      │
└─────────────────────┴────────────────────┴────────────────────┴────────────────────┴──────────────┘
{date} = YYYY-MM-DD from git log of kustomization.yaml commit

⚠️ Staging ≠ Production: {list services where staging tag differs from active prod}

🔥 Repos with failing CI:
{list or "None — all green"}

⏸️ Stale repos (active but no commits in 7+ days):
{list or "None"}

📌 Top priorities:
{infer from recent commits, open beads, CI failures, and deployment gaps}
```

### Notes
- Use tb-ci for ALL CI status — never gh (GitHub CLI)
- Beads come from in-repo .beads/issues.jsonl (embedded Dolt, bd v1.0.2)
- Skip repos with no commits in 30 days (dormant)
- Flag any repo where local is behind remote
- Flag services where staging is ahead of production (unpromoted changes)
- The "active slot" can be determined by checking which Flux kustomization is not suspended
- Post to #business-development, NOT #development (too noisy)
- For repos with significant changes (2+ commits), summarize what changed functionally
- Deployment dates are YYYY-MM-DD from the git commit that set the newTag, not relative ages
