// How to fetch a Drive file's content as text, by its mimeType.
//
// Binary/plain files download with `files/{id}?alt=media`. Google-native files
// (application/vnd.google-apps.*) have no stored bytes, so alt=media fails with
// 403 fileNotDownloadable; they must go through `files/{id}/export` instead.

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

// Text export format for each Google-native type we can read.
export const EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv", // first sheet only (Drive API limit)
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.drawing": "image/svg+xml",
  "application/vnd.google-apps.script": "application/vnd.google-apps.script+json",
};

const GOOGLE_NATIVE = "application/vnd.google-apps.";

export type ContentRequest =
  | { kind: "media"; url: string }
  | { kind: "export"; url: string; exportMime: string }
  | { kind: "unsupported"; reason: string };

export function contentRequest(fileId: string, mimeType: string): ContentRequest {
  const id = encodeURIComponent(fileId);
  const exportMime = EXPORT_MIME[mimeType];
  if (exportMime) {
    return {
      kind: "export",
      url: `${DRIVE_FILES}/${id}/export?mimeType=${encodeURIComponent(exportMime)}`,
      exportMime,
    };
  }
  if (mimeType.startsWith(GOOGLE_NATIVE)) {
    const type = mimeType.slice(GOOGLE_NATIVE.length);
    return { kind: "unsupported", reason: `Google ${type} files have no readable content (${mimeType})` };
  }
  return { kind: "media", url: `${DRIVE_FILES}/${id}?alt=media` };
}

// Drive returns {"error":{"code","message","errors":[{"reason"}]}}. Surface the
// message and reason; a bare status code reads like a permissions problem.
export function driveErrorMessage(status: number, body: string): string {
  try {
    const err = JSON.parse(body)?.error;
    if (err?.message) {
      const reason = err.errors?.[0]?.reason;
      return `Drive API ${status}: ${err.message}${reason ? ` (${reason})` : ""}`;
    }
  } catch {
    // not JSON; fall through
  }
  const text = body.trim().slice(0, 200);
  return `Drive API ${status}${text ? `: ${text}` : ""}`;
}
