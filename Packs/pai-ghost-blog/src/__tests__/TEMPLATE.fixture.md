# Postmortem: <Incident Title>

> **Standard:** all postmortems from 2026-06-10 forward use this template (the
> Google SRE postmortem format). It is **not applied retroactively** to earlier
> PMs. Keep it blameless: describe systems and actions, not people.
>
> **Required** sections (a PM is incomplete without them): Summary, Impact,
> Root Causes, Action Items, Timeline. **Recommended:** Lessons Learned and the
> rest. Delete this quote block when filing.

- **PM number:** PM-NNN
- **Date:** YYYY-MM-DD  (incident date)
- **Authors:** <names / personas>
- **Status:** Draft | In review | Complete (action items tracked)
- **Severity:** SEV1 | SEV2 | SEV3
- **Affected services:** <service(s) / namespaces>

## Summary
<2–3 sentences: what happened, the blast radius, and how it was resolved. Readable on its own.>

## Impact
<Who/what was affected and how much — users, requests, data, duration, SLO/error-budget burn, $ if known. Quantify.>

## Root Causes
<The chain of conditions that allowed the incident. Use 5-whys / contributing factors — not just the proximate trigger. There is usually more than one.>

## Trigger
<The specific event that set the incident in motion (deploy, config change, traffic spike, hardware fault, …).>

## Detection
<How the problem was discovered — which alert fired, or was it a human report? How long from start to detection? If detection was slow/manual, that is an action item.>

## Resolution
<What actions actually restored service, in order. Distinguish mitigation (stopped the bleeding) from fix (addressed the cause).>

## Action Items
> Every item gets an owner, a type, and a tracking bead. "Prevent" items are the ones that stop recurrence.

| Action item | Type (mitigate / prevent / process) | Owner | Bead / Status |
|---|---|---|---|
| <what to do> | prevent | <owner> | <bead-id> · open |

## Lessons Learned
**What went well**
- <things that worked — detection, tooling, runbooks, people>

**What went wrong**
- <what made it worse or slower — gaps, missing alerts, bad assumptions>

**Where we got lucky**
- <near-misses; things that could have been far worse but weren't, by chance>

## Timeline
> All times with timezone. Start before the trigger, end at "all-clear".

- `YYYY-MM-DD HH:MM TZ` — <event>
- `… HH:MM TZ` — <event>

## Supporting Information
<Links: dashboards, alert definitions, relevant PRs/commits, related PMs, chat threads, graphs.>
