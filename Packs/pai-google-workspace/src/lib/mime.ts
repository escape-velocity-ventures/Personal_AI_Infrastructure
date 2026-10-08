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

// Default subject for a reply: prefix "Re: " once, never "Re: Re:".
export function replySubject(originalSubject: string): string {
  return /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
}

// References for a reply: the original's References chain plus its Message-ID
// (RFC 5322 §3.6.4); the first reply in a thread has no References to carry.
export function replyReferences(originalReferences: string, originalMessageId: string): string {
  return [originalReferences, originalMessageId].filter(Boolean).join(" ");
}
