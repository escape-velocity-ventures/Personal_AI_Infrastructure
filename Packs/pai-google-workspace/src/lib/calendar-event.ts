// Pure helpers for Calendar events.insert. No I/O, so they are unit-testable;
// the API call lives in google-client.ts.
//
// Inviting someone is outbound contact: with sendUpdates=all Google emails them
// from the calendar owner's address. So when there are guests, the caller has to
// say whether they get an email (notify). There is no default, on purpose: an
// agent should decide that, not inherit it.

export type Notify = "all" | "externalOnly" | "none";
const NOTIFY: Notify[] = ["all", "externalOnly", "none"];

export interface EventSpec {
  summary: string;
  start: string; // ISO 8601 with an offset, or local time plus timeZone
  end: string;
  description?: string;
  location?: string;
  timeZone?: string; // IANA, e.g. "America/Los_Angeles"
  attendees?: string[];
  notify?: Notify; // required when attendees is non-empty
  meet?: boolean; // add a Google Meet link
  requestId?: string; // idempotency key for the Meet request; random if omitted
}

export interface EventRequest {
  body: Record<string, unknown>;
  params: Record<string, string | number | undefined>;
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

// "a@x.com, b@y.com" or ["a@x.com", ...] -> trimmed, deduplicated, validated.
export function parseAttendees(input: string | string[] | undefined): string[] {
  if (!input) return [];
  const parts = (Array.isArray(input) ? input : [input]).flatMap((s) => s.split(/[,;]/));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const email = raw.trim();
    if (!email) continue;
    if (!EMAIL.test(email)) throw new Error(`Not an email address: "${email}"`);
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

export function buildEventRequest(spec: EventSpec): EventRequest {
  const summary = spec.summary?.trim();
  if (!summary) throw new Error("An event needs a title");
  if (!spec.start || !spec.end) throw new Error("An event needs a start and an end");

  for (const [name, value] of [["start", spec.start], ["end", spec.end]] as const) {
    if (!spec.timeZone && !HAS_OFFSET.test(value)) {
      throw new Error(`${name} "${value}" has no UTC offset; add one (e.g. -07:00) or pass a timeZone`);
    }
  }
  // Only comparable when both carry an offset; with a bare timeZone Google checks it.
  if (HAS_OFFSET.test(spec.start) && HAS_OFFSET.test(spec.end)) {
    const s = Date.parse(spec.start), e = Date.parse(spec.end);
    if (Number.isNaN(s) || Number.isNaN(e)) throw new Error("start or end is not a valid ISO 8601 time");
    if (e <= s) throw new Error("end must be after start");
  }

  const attendees = parseAttendees(spec.attendees);
  if (spec.notify !== undefined && !NOTIFY.includes(spec.notify)) {
    throw new Error(`notify must be one of ${NOTIFY.join(", ")}`);
  }
  if (attendees.length > 0 && spec.notify === undefined) {
    throw new Error("Guests were given, so say whether they get an invite email: notify all, externalOnly or none");
  }

  const time = (dateTime: string) => (spec.timeZone ? { dateTime, timeZone: spec.timeZone } : { dateTime });
  const body: Record<string, unknown> = {
    summary,
    start: time(spec.start),
    end: time(spec.end),
  };
  if (spec.description) body.description = spec.description;
  if (spec.location) body.location = spec.location;
  if (attendees.length > 0) body.attendees = attendees.map((email) => ({ email }));
  if (spec.meet) {
    body.conferenceData = {
      createRequest: {
        requestId: spec.requestId || crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  return {
    body,
    params: {
      sendUpdates: spec.notify,
      // Without this, Google silently drops conferenceData.
      conferenceDataVersion: spec.meet ? 1 : undefined,
    },
  };
}
