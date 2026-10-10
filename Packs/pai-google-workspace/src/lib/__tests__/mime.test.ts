import { describe, expect, test } from "bun:test";
import { assertHeaderSafe, attachmentDisposition, encodeBody, encodeHeader, formatAddress, messageHeaders, replyHeaders, replyReferences, replySubject, resolveFrom } from "../mime";

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

describe("messageHeaders", () => {
  test("To and Subject only when no extra addresses or threading", () => {
    expect(messageHeaders("a@x.com", "Hello")).toEqual(["To: a@x.com", "Subject: Hello"]);
  });

  test("order is To, Cc, Bcc, Reply-To, Subject, then threading", () => {
    const h = messageHeaders(
      "a@x.com",
      "Re: Plan",
      { cc: ["c@x.com"], bcc: ["b@x.com"], replyTo: ["r@x.com"] },
      { inReplyTo: "<m1@x>", references: "<m0@x> <m1@x>" }
    );
    expect(h).toEqual([
      "To: a@x.com",
      "Cc: c@x.com",
      "Bcc: b@x.com",
      "Reply-To: r@x.com",
      "Subject: Re: Plan",
      "In-Reply-To: <m1@x>",
      "References: <m0@x> <m1@x>",
    ]);
  });

  test("several addresses join with a comma; display names with commas stay whole", () => {
    const h = messageHeaders("a@x.com", "S", {
      replyTo: ["Lee, Ben <ben@x.com>", "communications@x.com"],
    });
    expect(h).toContain('Reply-To: Lee, Ben <ben@x.com>, communications@x.com');
  });

  test("empty and whitespace-only entries add no header", () => {
    const h = messageHeaders("a@x.com", "S", { cc: [], bcc: ["", "  "], replyTo: undefined });
    expect(h).toEqual(["To: a@x.com", "Subject: S"]);
  });

  test("non-ASCII subject is still RFC 2047 encoded", () => {
    const h = messageHeaders("a@x.com", "Café");
    expect(h[1]).toMatch(/^Subject: =\?UTF-8\?B\?/);
  });

  test("a line break in any header value is refused (header injection)", () => {
    const smuggle = "x@x.com\r\nBcc: evil@x.com";
    expect(() => messageHeaders(smuggle, "S")).toThrow("To must not contain a line break");
    expect(() => messageHeaders("a@x.com", "Hi\nBcc: evil@x.com")).toThrow("Subject must not contain a line break");
    expect(() => messageHeaders("a@x.com", "S", { cc: [smuggle] })).toThrow("Cc must not contain a line break");
    expect(() => messageHeaders("a@x.com", "S", { bcc: [smuggle] })).toThrow("Bcc must not contain a line break");
    expect(() => messageHeaders("a@x.com", "S", { replyTo: [smuggle] })).toThrow("Reply-To must not contain a line break");
  });
});

describe("messageHeaders: a line break anywhere in a list value is refused, not trimmed away", () => {
  // Cybill's review of #19: trim() strips CR/LF at the edges, so trimming before
  // asserting accepted "\r\nBcc: evil" as "Cc: Bcc: evil". Each position, each list.
  const positions: Record<string, string> = {
    leading: "\r\nBcc: evil@x.com",
    trailing: "x@x.com\r\n",
    "leading LF only": "\nBcc: evil@x.com",
    "trailing CR only": "x@x.com\r",
    middle: "x@x.com\r\nBcc: evil@x.com",
  };
  for (const [field, name] of [["cc", "Cc"], ["bcc", "Bcc"], ["replyTo", "Reply-To"]] as const) {
    for (const [where, value] of Object.entries(positions)) {
      test(`${name}: ${where}`, () => {
        expect(() => messageHeaders("a@x.com", "S", { [field]: [value] })).toThrow(
          `${name} must not contain a line break`
        );
      });
    }
  }

  test("ordinary surrounding spaces are still trimmed", () => {
    expect(messageHeaders("a@x.com", "S", { cc: ["  c@x.com  "] })).toContain("Cc: c@x.com");
  });
});

describe("assertHeaderSafe", () => {
  test("returns the value unchanged when it has no line break", () => {
    expect(assertHeaderSafe("To", "Name <a@x.com>")).toBe("Name <a@x.com>");
  });
  test("refuses a bare CR as well as LF", () => {
    expect(() => assertHeaderSafe("To", "a\rb")).toThrow();
    expect(() => assertHeaderSafe("To", "a\nb")).toThrow();
  });
});

describe("attachmentDisposition", () => {
  test("plain filename is quoted", () => {
    expect(attachmentDisposition("report.pdf")).toBe('Content-Disposition: attachment; filename="report.pdf"');
  });
  test("quotes and backslashes are escaped so the quoted-string can't end early", () => {
    expect(attachmentDisposition('a"b\\c.txt')).toBe('Content-Disposition: attachment; filename="a\\"b\\\\c.txt"');
  });
  test("a line break in the filename is refused", () => {
    expect(() => attachmentDisposition("x.pdf\r\nContent-Type: text/html")).toThrow("Attachment filename must not contain a line break");
  });
});

describe("From", () => {
  const sendAs = [
    { sendAsEmail: "aurelia@x.com", displayName: "Escape Velocity Communications", isPrimary: true },
    { sendAsEmail: "communications@x.com", displayName: "Escape Velocity Communications", isDefault: true, verificationStatus: "accepted" },
    { sendAsEmail: "pending@x.com", displayName: "Pending", verificationStatus: "pending" },
  ];

  test("no From header unless one is asked for (Gmail then uses the default send-as)", () => {
    expect(messageHeaders("a@x.com", "S")[0]).toBe("To: a@x.com");
  });

  test("From comes first when set", () => {
    expect(messageHeaders("a@x.com", "S", { from: "communications@x.com" })[0]).toBe("From: communications@x.com");
  });

  test("resolveFrom uses Gmail's display name for a verified alias, case-insensitively", () => {
    expect(resolveFrom("Communications@X.com", sendAs)).toBe('"Escape Velocity Communications" <communications@x.com>');
  });

  test("resolveFrom accepts the primary address, which has no verification status", () => {
    expect(resolveFrom("aurelia@x.com", sendAs)).toBe('"Escape Velocity Communications" <aurelia@x.com>');
  });

  test("resolveFrom refuses an unknown address and a pending alias, listing the usable ones", () => {
    expect(() => resolveFrom("someone@else.com", sendAs)).toThrow("not a verified send-as address");
    expect(() => resolveFrom("someone@else.com", sendAs)).toThrow("usable: aurelia@x.com, communications@x.com");
    expect(() => resolveFrom("pending@x.com", sendAs)).toThrow("not a verified send-as address");
  });

  test("formatAddress quotes ASCII names, escapes quotes, encodes non-ASCII, and handles no name", () => {
    expect(formatAddress("Lee, Ben", "b@x.com")).toBe('"Lee, Ben" <b@x.com>');
    expect(formatAddress('Say "hi"', "b@x.com")).toBe('"Say \\"hi\\"" <b@x.com>');
    expect(formatAddress("Café Crème", "b@x.com")).toMatch(/^=\?UTF-8\?B\?.+\?= <b@x\.com>$/);
    expect(formatAddress(undefined, " b@x.com ")).toBe("b@x.com");
  });

  test("a line break in the From name, address or header is refused", () => {
    expect(() => formatAddress("Ben\r\nBcc: evil@x.com", "b@x.com")).toThrow("From must not contain a line break");
    expect(() => formatAddress("Ben", "b@x.com\r\n")).toThrow("From must not contain a line break");
    expect(() => messageHeaders("a@x.com", "S", { from: "\r\nBcc: evil@x.com" })).toThrow("From must not contain a line break");
  });
});
