# pai-memory (DEPRECATED)

This package has been extracted to its own standalone repo as **Engram**.

## New location

- **Repo:** `~/EscapeVelocity/engram/`
- **Remote:** `git.escape-velocity-ventures.org/escape-velocity-ventures/engram`
- **API:** `https://engram.escape-velocity-ventures.org`
- **Legacy API:** `https://memory-api.escape-velocity-ventures.org` (still works)

## Environment variables

| New (canonical) | Old (still works) | Purpose |
|-----------------|-------------------|---------|
| `ENGRAM_API_URL` | `MEMORY_API_URL` | API endpoint |
| `ENGRAM_API_KEY` | `MEMORY_API_KEY` | Auth token |
| `ENGRAM_AGENT_ID` | `PAI_AGENT_ID` | Agent identity |

## What to do

If you're editing Engram code, work in `~/EscapeVelocity/engram/`.
If you're importing it, use the `engram` package.
This directory will be removed once all references are cleaned up.
