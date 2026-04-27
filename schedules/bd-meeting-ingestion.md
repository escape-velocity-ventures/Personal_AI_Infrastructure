# BD Meeting Ingestion

**Schedule:** Tue/Thu 6:03 PM CST
**Trigger:** tb-manage local scheduler
**Output:** Analysis files in ev-internal/chief-of-staff/analyses/

## Prompt

Run BD meeting ingestion:

1. Discover new BD meeting docs in Google Drive
2. Extract full text from each doc
3. Parse decisions, action items, attendees
4. Save structured analysis to ~/EscapeVelocity/ev-internal/chief-of-staff/analyses/YYYY-MM-DD-bd-meeting.md
5. Update bd-docs.json with discovered documents

Script: ~/EscapeVelocity/ev-internal/chief-of-staff/bd-meeting-ingestion.ts
Run: `bun run ~/EscapeVelocity/ev-internal/chief-of-staff/bd-meeting-ingestion.ts`

If the script doesn't exist or fails, report the error. The Google Workspace credentials are at the `aurelia-google-workspace` secret (accessible via tb-sec).

## Notes
- Requires Google Workspace API access (gmail.readonly scope)
- Output goes to ev-internal repo (git commit after writing)
- Use Gitea as primary remote when committing
