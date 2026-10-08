import { describe, expect, test } from "bun:test";
import { encodeBody, encodeHeader, replyHeaders, replyReferences, replySubject } from "../mime";

// Minimal RFC 2047 decoder for round-trip checks: drop folding whitespace
// between encoded-words, decode each, concatenate.
function decodeHeader(encoded: string): string {
  return encoded
    .split(/\r\n /)
    .map((w) => {
      const m = w.match(/^=\?UTF-8\?B\?(.*)\?=$/);
      return m ? Buffer.from(m[1], "base64") : Buffer.from(w, "utf-8");
    })
    .reduce((acc, b) => Buffer.concat([acc, b]), Buffer.alloc(0))
    .toString("utf-8");
}

describe("encodeHeader", () => {
  test("ASCII passes through unchanged", () => {
    expect(encodeHeader("Agenda for Friday, Oct 9")).toBe("Agenda for Friday, Oct 9");
  });

  test("non-ASCII becomes an encoded-word that round-trips", () => {
    const s = "Café — 3:00 PM PT";
    const out = encodeHeader(s);
    expect(out).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeHeader(out)).toBe(s);
  });

  test("long non-ASCII subject splits into encoded-words of at most 75 chars", () => {
    const s = "Réunion — ".repeat(12);
    const out = encodeHeader(s);
    const words = out.split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    expect(decodeHeader(out)).toBe(s);
  });

  test("never splits inside a multi-byte character (emoji)", () => {
    const s = "🎂".repeat(30); // 4 bytes each
    expect(decodeHeader(encodeHeader(s))).toBe(s);
  });
});

describe("encodeBody", () => {
  test("base64 round-trips UTF-8", () => {
    const body = "Hi — café\n/B";
    const out = encodeBody(body);
    expect(Buffer.from(out.replace(/\r\n/g, ""), "base64").toString("utf-8")).toBe(body);
  });

  test("wraps lines at 76 characters with CRLF", () => {
    const out = encodeBody("x".repeat(500));
    const lines = out.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(76);
  });

  test("empty body encodes to empty string", () => {
    expect(encodeBody("")).toBe("");
  });
});

describe("reply helpers", () => {
  test("replySubject prefixes once, never Re: Re:", () => {
    expect(replySubject("Agenda")).toBe("Re: Agenda");
    expect(replySubject("Re: Agenda")).toBe("Re: Agenda");
    expect(replySubject("RE: Agenda")).toBe("RE: Agenda");
  });

  test("replyReferences: first reply has only the Message-ID", () => {
    expect(replyReferences("", "<a@x>")).toBe("<a@x>");
  });

  test("replyReferences: later replies carry the chain", () => {
    expect(replyReferences("<a@x> <b@x>", "<c@x>")).toBe("<a@x> <b@x> <c@x>");
  });

  test("replyHeaders emits In-Reply-To and References only when present", () => {
    expect(replyHeaders()).toEqual([]);
    expect(replyHeaders({ threadId: "t" })).toEqual([]);
    expect(replyHeaders({ inReplyTo: "<c@x>", references: "<a@x> <c@x>" })).toEqual([
      "In-Reply-To: <c@x>",
      "References: <a@x> <c@x>",
    ]);
  });
});
