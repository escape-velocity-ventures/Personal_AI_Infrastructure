import { describe, expect, test } from "bun:test";
import { buildEventRequest, parseAttendees } from "../calendar-event";

const base = { summary: "Check-in", start: "2026-10-11T11:00:00-07:00", end: "2026-10-11T12:00:00-07:00" };

describe("parseAttendees", () => {
  test("comma or semicolon separated, trimmed, deduplicated case-insensitively", () => {
    expect(parseAttendees(" a@x.com, b@y.org;A@X.com ,")).toEqual(["a@x.com", "b@y.org"]);
  });

  test("accepts an array, including entries that themselves hold lists", () => {
    expect(parseAttendees(["a@x.com", "b@y.org,c@z.net"])).toEqual(["a@x.com", "b@y.org", "c@z.net"]);
  });

  test("nothing given is no guests", () => {
    expect(parseAttendees(undefined)).toEqual([]);
    expect(parseAttendees("")).toEqual([]);
  });

  test("refuses something that is not an address", () => {
    expect(() => parseAttendees("Steph <s@x.com>")).toThrow("Not an email address");
    expect(() => parseAttendees("stephanie")).toThrow("Not an email address");
  });
});

describe("buildEventRequest", () => {
  test("a plain event is unchanged from before: no guests, no Meet, no extra params", () => {
    const r = buildEventRequest({ ...base, description: "Agenda", location: "Phone" });
    expect(r.body).toEqual({
      summary: "Check-in",
      start: { dateTime: base.start },
      end: { dateTime: base.end },
      description: "Agenda",
      location: "Phone",
    });
    expect(r.params).toEqual({ sendUpdates: undefined, conferenceDataVersion: undefined });
  });

  test("guests and notify map to attendees and sendUpdates", () => {
    const r = buildEventRequest({ ...base, attendees: ["s@x.com"], notify: "all" });
    expect(r.body.attendees).toEqual([{ email: "s@x.com" }]);
    expect(r.params.sendUpdates).toBe("all");
  });

  test("guests without a notify choice are refused rather than defaulted", () => {
    expect(() => buildEventRequest({ ...base, attendees: ["s@x.com"] })).toThrow("say whether they get an invite email");
  });

  test("notify none with guests is allowed (added silently)", () => {
    expect(buildEventRequest({ ...base, attendees: ["s@x.com"], notify: "none" }).params.sendUpdates).toBe("none");
  });

  test("an unknown notify value is refused", () => {
    expect(() => buildEventRequest({ ...base, notify: "everyone" as never })).toThrow("notify must be one of");
  });

  test("meet adds a Meet create request and conferenceDataVersion=1", () => {
    const r = buildEventRequest({ ...base, meet: true, requestId: "fixed-id" });
    expect(r.body.conferenceData).toEqual({
      createRequest: { requestId: "fixed-id", conferenceSolutionKey: { type: "hangoutsMeet" } },
    });
    expect(r.params.conferenceDataVersion).toBe(1);
  });

  test("meet without a requestId gets a fresh one each time", () => {
    const id = (r: ReturnType<typeof buildEventRequest>) =>
      (r.body.conferenceData as { createRequest: { requestId: string } }).createRequest.requestId;
    const a = buildEventRequest({ ...base, meet: true }), b = buildEventRequest({ ...base, meet: true });
    expect(id(a)).toBeTruthy();
    expect(id(a)).not.toBe(id(b));
  });

  test("timeZone is attached to both ends and allows offset-free local times", () => {
    const r = buildEventRequest({
      summary: "x", start: "2026-10-11T11:00:00", end: "2026-10-11T12:00:00", timeZone: "America/Los_Angeles",
    });
    expect(r.body.start).toEqual({ dateTime: "2026-10-11T11:00:00", timeZone: "America/Los_Angeles" });
    expect(r.body.end).toEqual({ dateTime: "2026-10-11T12:00:00", timeZone: "America/Los_Angeles" });
  });

  test("an offset-free time with no timeZone is refused, since its meaning depends on the calendar", () => {
    expect(() => buildEventRequest({ ...base, start: "2026-10-11T11:00:00" })).toThrow("has no UTC offset");
  });

  test("end must be after start, compared across offsets", () => {
    // 13:00 CT is 11:00 PT: same instant, so zero length.
    expect(() => buildEventRequest({ ...base, end: "2026-10-11T13:00:00-05:00" })).toThrow("end must be after start");
    expect(buildEventRequest({ ...base, end: "2026-10-11T14:00:00-05:00" }).body.end).toEqual({ dateTime: "2026-10-11T14:00:00-05:00" });
  });

  test("a blank title is refused", () => {
    expect(() => buildEventRequest({ ...base, summary: "  " })).toThrow("needs a title");
  });
});
