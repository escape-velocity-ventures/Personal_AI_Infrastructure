# Hat Trick — Weekly Executive Advisory

**Schedule:** Mondays 7:07 AM CST
**Trigger:** tb-manage local scheduler
**Output:** Filed as beads + Slack #development summary

## Prompt

Run Hat Trick — the weekly executive advisory system.

Execute: `bun run /Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/hat-trick/src/index.ts`

This runs all executive hats (CEO, CFO, CTO, COO, Sales, Marketing, Legal, Curmudgeon) in sequence, gathering context from:
- Bead backlog across repos (`bd list --all` in active repos)
- Recent git commits (last 7 days)
- Postmortems (TinkerBelle-config/postmortems/)
- CI status (tb-ci across repos)

Each hat produces actionable recommendations. Hat Trick files beads for the week's priorities.

Report the summary output when done.

## Notes
- Uses bd v1.0.2 embedded Dolt (no external server)
- tb-ci for CI status, NOT gh
- If hat-trick script fails, report the error and run manually:
  cd ~/EscapeVelocity/PersonalAI/PAI/Packs/hat-trick && bun run src/index.ts
