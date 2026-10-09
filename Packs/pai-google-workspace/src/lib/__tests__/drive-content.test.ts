import { describe, expect, test } from "bun:test";
import { EXPORT_MIME, contentRequest, driveErrorMessage } from "../drive-content";

describe("contentRequest", () => {
  test("Google Doc exports as text/plain", () => {
    const r = contentRequest("abc", "application/vnd.google-apps.document");
    expect(r.kind).toBe("export");
    if (r.kind !== "export") return;
    expect(r.url).toBe("https://www.googleapis.com/drive/v3/files/abc/export?mimeType=text%2Fplain");
  });

  test("Google Sheet exports as CSV, never alt=media", () => {
    const r = contentRequest("abc", "application/vnd.google-apps.spreadsheet");
    expect(r.kind).toBe("export");
    if (r.kind !== "export") return;
    expect(r.exportMime).toBe("text/csv");
    expect(r.url).not.toContain("alt=media");
  });

  test("every mapped native type routes to export", () => {
    for (const mime of Object.keys(EXPORT_MIME)) {
      expect(contentRequest("x", mime).kind).toBe("export");
    }
  });

  test("binary and plain files download with alt=media", () => {
    for (const mime of ["text/markdown", "text/plain", "application/pdf", "application/zip", "image/jpeg"]) {
      const r = contentRequest("abc", mime);
      expect(r.kind).toBe("media");
      if (r.kind !== "media") return;
      expect(r.url).toBe("https://www.googleapis.com/drive/v3/files/abc?alt=media");
    }
  });

  test("native types with no content are reported, not fetched", () => {
    for (const mime of ["application/vnd.google-apps.folder", "application/vnd.google-apps.form", "application/vnd.google-apps.shortcut"]) {
      const r = contentRequest("abc", mime);
      expect(r.kind).toBe("unsupported");
      if (r.kind !== "unsupported") return;
      expect(r.reason).toContain(mime);
    }
  });

  test("file id is URL-encoded", () => {
    const r = contentRequest("a/b?c", "text/plain");
    if (r.kind !== "media") throw new Error("expected media");
    expect(r.url).toBe("https://www.googleapis.com/drive/v3/files/a%2Fb%3Fc?alt=media");
  });
});

describe("driveErrorMessage", () => {
  test("surfaces Google's message and reason", () => {
    const body = JSON.stringify({
      error: { code: 403, message: "Only files with binary content can be downloaded. Use Export with Docs Editors files.", errors: [{ reason: "fileNotDownloadable" }] },
    });
    expect(driveErrorMessage(403, body)).toBe(
      "Drive API 403: Only files with binary content can be downloaded. Use Export with Docs Editors files. (fileNotDownloadable)",
    );
  });

  test("non-JSON body is truncated, not dropped", () => {
    expect(driveErrorMessage(502, "Bad Gateway")).toBe("Drive API 502: Bad Gateway");
    expect(driveErrorMessage(500, "")).toBe("Drive API 500");
    expect(driveErrorMessage(500, "x".repeat(500)).length).toBeLessThan(230);
  });
});
