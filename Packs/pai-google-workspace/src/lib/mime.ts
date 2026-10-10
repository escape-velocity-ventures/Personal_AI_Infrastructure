// Pure MIME helpers for building Gmail raw messages. No I/O, so they are unit-testable.

// RFC 2047: a non-ASCII header value must be sent as encoded-words, each at
// most 75 characters. Split on character boundaries (never inside a UTF-8
// sequence): 45 bytes -> 60 base64 chars + 12 for "=?UTF-8?B??=" = 72.
const MAX_ENCODED_WORD_BYTES = 45;

export function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;

  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, "utf-8") > MAX_ENCODED_WORD_BYTES) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);

  // Encoded-words separated by folding whitespace; decoders drop the
  // whitespace between adjacent encoded-words (RFC 2047 §6.2).
  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w, "utf-8").toString("base64")}?=`)
    .join("\r\n ");
}

// RFC 2045: with no Content-Transfer-Encoding the default is 7bit, so a UTF-8
// body must be transfer-encoded. Base64, wrapped at 76 characters per line.
export function encodeBody(body: string): string {
  const b64 = Buffer.from(body, "utf-8").toString("base64");
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

// Threading options for replies: Gmail places the message in threadId, and
// recipients' clients thread it via In-Reply-To/References.
export interface ReplyOptions {
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export function replyHeaders(reply?: ReplyOptions): string[] {
  const headers: string[] = [];
  if (reply?.inReplyTo) headers.push(`In-Reply-To: ${reply.inReplyTo}`);
  if (reply?.references) headers.push(`References: ${reply.references}`);
  return headers;
}

// Extra recipients and reply addresses for an outgoing message. Each entry is
// one address (optionally "Name <addr>"), used verbatim; they are not split on
// commas, because a display name can contain one.
export interface AddressOptions {
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
}

// A CR or LF in a header value ends that header, and whatever follows is read
// as new headers (header injection, e.g. a smuggled Bcc). Refuse it outright.
export function assertHeaderSafe(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`${name} must not contain a line break`);
  return value;
}

// Every header ahead of the MIME ones, in one place so send paths can't drift:
// To, Cc, Bcc, Reply-To, Subject, then threading. Empty lists add no header.
export function messageHeaders(
  to: string,
  subject: string,
  addr: AddressOptions = {},
  reply?: ReplyOptions
): string[] {
  // Assert BEFORE trimming: trim() strips CR/LF at the edges, so trimming first
  // would quietly clean "\r\nBcc: x" into an accepted value instead of refusing
  // it the way To and Subject do.
  const list = (name: string, values: string[] = []) => {
    const present = values.map((v) => assertHeaderSafe(name, v).trim()).filter(Boolean);
    return present.length ? [`${name}: ${present.join(", ")}`] : [];
  };
  return [
    `To: ${assertHeaderSafe("To", to)}`,
    ...list("Cc", addr.cc),
    ...list("Bcc", addr.bcc),
    ...list("Reply-To", addr.replyTo),
    `Subject: ${encodeHeader(assertHeaderSafe("Subject", subject))}`,
    ...replyHeaders(reply),
  ];
}

// Content-Disposition for an attachment. The filename is a header value too:
// no line breaks, and quotes or backslashes escaped so it can't end the
// quoted-string early (RFC 2045 quoted-string).
export function attachmentDisposition(filename: string): string {
  const quoted = assertHeaderSafe("Attachment filename", filename).replace(/["\\]/g, "\\$&");
  return `Content-Disposition: attachment; filename="${quoted}"`;
}

// Default subject for a reply: prefix "Re: " once, never "Re: Re:".
export function replySubject(originalSubject: string): string {
  return /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
}

// References for a reply: the original's References chain plus its Message-ID
// (RFC 5322 §3.6.4); the first reply in a thread has no References to carry.
export function replyReferences(originalReferences: string, originalMessageId: string): string {
  return [originalReferences, originalMessageId].filter(Boolean).join(" ");
}
