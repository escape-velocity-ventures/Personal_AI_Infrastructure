import { describe, expect, test } from "bun:test";
import { buildFilter, describeFilter } from "../filters";

const labels = [
  { id: "Label_1", name: "Customers/BBBB" },
  { id: "Label_2", name: "Newsletters" },
  { id: "INBOX", name: "INBOX" },
  { id: "UNREAD", name: "UNREAD" },
];

describe("buildFilter", () => {
  test("label by name, case-insensitively, plus archive and mark-read", () => {
    const f = buildFilter({ from: "sebydalton@gmail.com", labels: ["customers/bbbb"], archive: true, markRead: true }, labels);
    expect(f).toEqual({
      criteria: { from: "sebydalton@gmail.com" },
      action: { addLabelIds: ["Label_1"], removeLabelIds: ["INBOX", "UNREAD"] },
    });
  });

  test("criteria are trimmed and empty ones dropped", () => {
    const f = buildFilter({ from: "  a@x.com ", subject: "   ", query: "list:news", star: true }, labels);
    expect(f.criteria).toEqual({ from: "a@x.com", query: "list:news" });
    expect(f.action).toEqual({ addLabelIds: ["STARRED"] });
  });

  test("hasAttachment counts as a criterion", () => {
    const f = buildFilter({ hasAttachment: true, labels: ["Newsletters"] }, labels);
    expect(f.criteria).toEqual({ hasAttachment: true });
  });

  test("important / never-important / never-spam map to system labels", () => {
    expect(buildFilter({ from: "a@x.com", important: true }, labels).action).toEqual({ addLabelIds: ["IMPORTANT"] });
    expect(buildFilter({ from: "a@x.com", neverImportant: true, neverSpam: true }, labels).action).toEqual({
      removeLabelIds: ["IMPORTANT", "SPAM"],
    });
  });

  test("refuses a filter with no criteria: it would match all mail", () => {
    expect(() => buildFilter({ archive: true }, labels)).toThrow("at least one criterion");
    expect(() => buildFilter({ from: "   ", archive: true }, labels)).toThrow("at least one criterion");
  });

  test("refuses a filter with no action", () => {
    expect(() => buildFilter({ from: "a@x.com" }, labels)).toThrow("at least one action");
  });

  test("refuses an unknown label rather than creating it", () => {
    expect(() => buildFilter({ from: "a@x.com", labels: ["Nope"] }, labels)).toThrow('unknown label "Nope"');
  });

  test("refuses contradictory importance", () => {
    expect(() => buildFilter({ from: "a@x.com", important: true, neverImportant: true }, labels)).toThrow("contradict");
  });

  test("the result carries no forward and no TRASH, whatever is asked", () => {
    const f = buildFilter(
      { from: "a@x.com", labels: ["Newsletters"], archive: true, markRead: true, star: true, neverSpam: true },
      labels
    );
    expect(JSON.stringify(f)).not.toContain("forward");
    expect(JSON.stringify(f)).not.toContain("TRASH");
  });
});

describe("describeFilter", () => {
  test("shows criteria and actions with label names", () => {
    const s = describeFilter(
      { id: "ANe1", criteria: { from: "a@x.com", hasAttachment: true }, action: { addLabelIds: ["Label_2"], removeLabelIds: ["INBOX"] } },
      labels
    );
    expect(s).toBe("ANe1  from:a@x.com has:attachment  =>  +Newsletters -INBOX");
  });

  test("an existing forward filter is shown, so it can't hide", () => {
    const s = describeFilter({ id: "F1", criteria: { from: "a@x.com" }, action: { forward: "x@y.com" } }, labels);
    expect(s).toContain("forward:x@y.com");
  });
});
