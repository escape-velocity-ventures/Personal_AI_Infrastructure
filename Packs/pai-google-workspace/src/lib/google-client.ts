import { getValidAccessToken } from "../auth/token-manager";
import { getMimeType } from "./mime-types";

const RATE_LIMIT_WINDOW = 100 * 1000; // 100 seconds
const MAX_REQUESTS = 100;

let requestTimestamps: number[] = [];

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW
  );

  if (requestTimestamps.length >= MAX_REQUESTS) {
    const oldestRequest = requestTimestamps[0];
    const waitTime = RATE_LIMIT_WINDOW - (now - oldestRequest);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  requestTimestamps.push(Date.now());
}

export interface GoogleApiOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  account?: string; // Account email for multi-account support
}

export async function googleApi<T>(
  endpoint: string,
  options: GoogleApiOptions = {}
): Promise<T> {
  await waitForRateLimit();

  const accessToken = await getValidAccessToken(options.account);
  const { method = "GET", body, params } = options;

  let url = endpoint;
  if (!url.startsWith("https://")) {
    url = `https://www.googleapis.com${endpoint}`;
  }

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
    const paramStr = searchParams.toString();
    if (paramStr) {
      url += (url.includes("?") ? "&" : "?") + paramStr;
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error (${response.status}): ${errorText}`);
  }

  // Handle empty responses (e.g., DELETE requests)
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

// Helper to create account-scoped API functions
function withAccount(account?: string) {
  return {
    gmail: createGmailHelpers(account),
    calendar: createCalendarHelpers(account),
    drive: createDriveHelpers(account),
    docs: createDocsHelpers(account),
  };
}

// Gmail API helpers
function createGmailHelpers(account?: string) {
  return {
    async search(query: string, maxResults = 10) {
      interface MessagesResponse {
        messages?: { id: string; threadId: string }[];
      }
      const result = await googleApi<MessagesResponse>("/gmail/v1/users/me/messages", {
        params: { q: query, maxResults },
        account,
      });
      return result.messages || [];
    },

    async getMessage(id: string) {
      interface Message {
        id: string;
        threadId: string;
        labelIds: string[];
        snippet: string;
        payload: {
          headers: { name: string; value: string }[];
          body?: { data?: string };
          parts?: { mimeType: string; body?: { data?: string } }[];
        };
      }
      return googleApi<Message>(`/gmail/v1/users/me/messages/${id}`, {
        params: { format: "full" },
        account,
      });
    },

    async send(to: string, subject: string, body: string) {
      const email = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ].join("\r\n");

      const encoded = Buffer.from(email).toString("base64url");

      interface SendResponse {
        id: string;
        threadId: string;
        labelIds: string[];
      }
      return googleApi<SendResponse>("/gmail/v1/users/me/messages/send", {
        method: "POST",
        body: { raw: encoded },
        account,
      });
    },

    async sendWithAttachment(
      to: string,
      subject: string,
      body: string,
      attachments: { filename: string; content: Buffer }[]
    ) {
      const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const parts: string[] = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ];

      for (const attachment of attachments) {
        const mimeType = getMimeType(attachment.filename);
        const base64Content = attachment.content.toString("base64");

        parts.push(
          `--${boundary}`,
          `Content-Type: ${mimeType}`,
          `Content-Disposition: attachment; filename="${attachment.filename}"`,
          "Content-Transfer-Encoding: base64",
          "",
          base64Content
        );
      }

      parts.push(`--${boundary}--`);

      const email = parts.join("\r\n");
      const encoded = Buffer.from(email).toString("base64url");

      interface SendResponse {
        id: string;
        threadId: string;
        labelIds: string[];
      }
      return googleApi<SendResponse>("/gmail/v1/users/me/messages/send", {
        method: "POST",
        body: { raw: encoded },
        account,
      });
    },

    async listLabels() {
      interface LabelsResponse {
        labels: { id: string; name: string; type: string }[];
      }
      const result = await googleApi<LabelsResponse>("/gmail/v1/users/me/labels", { account });
      return result.labels;
    },
  };
}

// Calendar API helpers
function createCalendarHelpers(account?: string) {
  return {
    async listEvents(calendarId = "primary", days = 7) {
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      interface EventsResponse {
        items: {
          id: string;
          summary: string;
          start: { dateTime?: string; date?: string };
          end: { dateTime?: string; date?: string };
          location?: string;
          description?: string;
        }[];
      }
      const result = await googleApi<EventsResponse>(
        `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          params: {
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 50,
          },
          account,
        }
      );
      return result.items || [];
    },

    async getEvent(eventId: string, calendarId = "primary") {
      return googleApi(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
        account,
      });
    },

    async createEvent(
      summary: string,
      start: string,
      end: string,
      options: { description?: string; location?: string; calendarId?: string } = {}
    ) {
      const calendarId = options.calendarId || "primary";
      return googleApi(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST",
        body: {
          summary,
          start: { dateTime: start },
          end: { dateTime: end },
          description: options.description,
          location: options.location,
        },
        account,
      });
    },

    async freeBusy(start: string, end: string, calendarIds = ["primary"]) {
      interface FreeBusyResponse {
        calendars: Record<string, { busy: { start: string; end: string }[] }>;
      }
      return googleApi<FreeBusyResponse>("/calendar/v3/freeBusy", {
        method: "POST",
        body: {
          timeMin: start,
          timeMax: end,
          items: calendarIds.map((id) => ({ id })),
        },
        account,
      });
    },
  };
}

// Drive API helpers
function createDriveHelpers(account?: string) {
  return {
    async listFiles(folderId?: string, maxResults = 20) {
      let query = "trashed = false";
      if (folderId) {
        query += ` and '${folderId}' in parents`;
      }

      interface FilesResponse {
        files: {
          id: string;
          name: string;
          mimeType: string;
          modifiedTime: string;
          size?: string;
        }[];
      }
      const result = await googleApi<FilesResponse>("/drive/v3/files", {
        params: {
          q: query,
          pageSize: maxResults,
          fields: "files(id,name,mimeType,modifiedTime,size)",
          orderBy: "modifiedTime desc",
        },
        account,
      });
      return result.files || [];
    },

    async search(query: string, maxResults = 20) {
      interface FilesResponse {
        files: {
          id: string;
          name: string;
          mimeType: string;
          modifiedTime: string;
        }[];
      }
      const result = await googleApi<FilesResponse>("/drive/v3/files", {
        params: {
          q: `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
          pageSize: maxResults,
          fields: "files(id,name,mimeType,modifiedTime)",
        },
        account,
      });
      return result.files || [];
    },

    async getFile(fileId: string) {
      return googleApi(`/drive/v3/files/${fileId}`, {
        params: { fields: "id,name,mimeType,modifiedTime,size,webViewLink" },
        account,
      });
    },

    async readContent(fileId: string) {
      const accessToken = await getValidAccessToken(account);
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.status}`);
      }

      return response.text();
    },
  };
}

// Google Docs API helpers
function createDocsHelpers(account?: string) {
  return {
    /**
     * Get a Google Doc's content (returns structured document JSON)
     */
    async getDocument(documentId: string) {
      interface GoogleDoc {
        documentId: string;
        title: string;
        body: {
          content: DocContent[];
        };
        revisionId: string;
      }
      interface DocContent {
        paragraph?: {
          elements: ParagraphElement[];
          paragraphStyle?: { namedStyleType?: string };
        };
        table?: unknown;
        sectionBreak?: unknown;
        tableOfContents?: unknown;
      }
      interface ParagraphElement {
        textRun?: { content: string; textStyle?: unknown };
        inlineObjectElement?: unknown;
      }
      return googleApi<GoogleDoc>(`https://docs.googleapis.com/v1/documents/${documentId}`, {
        account,
      });
    },

    /**
     * Read a Google Doc as plain text
     */
    async readAsText(documentId: string): Promise<string> {
      const doc = await this.getDocument(documentId);
      const lines: string[] = [];

      for (const content of doc.body.content) {
        if (content.paragraph) {
          let paragraphText = "";
          for (const element of content.paragraph.elements) {
            if (element.textRun?.content) {
              paragraphText += element.textRun.content;
            }
          }
          // Remove trailing newline from paragraph (we'll handle formatting ourselves)
          lines.push(paragraphText.replace(/\n$/, ""));
        }
      }

      return lines.join("\n");
    },

    /**
     * Append text to the end of a Google Doc
     */
    async append(documentId: string, text: string): Promise<void> {
      // First get the document to find the end index
      const doc = await this.getDocument(documentId);

      // Find the end index (last content element's endIndex - 1 because of final newline)
      let endIndex = 1;
      for (const content of doc.body.content) {
        if (content.paragraph) {
          for (const element of content.paragraph.elements) {
            if (element.textRun?.content) {
              endIndex += element.textRun.content.length;
            }
          }
        }
      }

      // Append text at the end (endIndex - 1 because Docs reserves last index for doc end marker)
      await googleApi(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
        method: "POST",
        body: {
          requests: [
            {
              insertText: {
                location: { index: endIndex - 1 },
                text: "\n" + text,
              },
            },
          ],
        },
        account,
      });
    },

    /**
     * Replace all content in a Google Doc with new text
     */
    async replaceContent(documentId: string, newContent: string): Promise<void> {
      // Get document to find content range
      const doc = await this.getDocument(documentId);

      // Calculate the total content length
      let endIndex = 1;
      for (const content of doc.body.content) {
        if (content.paragraph) {
          for (const element of content.paragraph.elements) {
            if (element.textRun?.content) {
              endIndex += element.textRun.content.length;
            }
          }
        }
      }

      const requests: unknown[] = [];

      // Delete existing content (if any exists beyond the initial newline)
      if (endIndex > 1) {
        requests.push({
          deleteContentRange: {
            range: {
              startIndex: 1,
              endIndex: endIndex,
            },
          },
        });
      }

      // Insert new content
      requests.push({
        insertText: {
          location: { index: 1 },
          text: newContent,
        },
      });

      await googleApi(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
        method: "POST",
        body: { requests },
        account,
      });
    },

    /**
     * Find and replace text in a Google Doc
     */
    async findAndReplace(
      documentId: string,
      find: string,
      replace: string,
      matchCase = false
    ): Promise<{ occurrencesChanged: number }> {
      interface BatchUpdateResponse {
        replies: { replaceAllText?: { occurrencesChanged: number } }[];
      }
      const result = await googleApi<BatchUpdateResponse>(
        `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
        {
          method: "POST",
          body: {
            requests: [
              {
                replaceAllText: {
                  containsText: {
                    text: find,
                    matchCase,
                  },
                  replaceText: replace,
                },
              },
            ],
          },
          account,
        }
      );

      return {
        occurrencesChanged: result.replies[0]?.replaceAllText?.occurrencesChanged || 0,
      };
    },

    /**
     * Insert text at a specific position in the document
     */
    async insertAt(documentId: string, index: number, text: string): Promise<void> {
      await googleApi(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
        method: "POST",
        body: {
          requests: [
            {
              insertText: {
                location: { index },
                text,
              },
            },
          ],
        },
        account,
      });
    },
  };
}

// Default helpers (use default account)
export const gmail = createGmailHelpers();
export const calendar = createCalendarHelpers();
export const drive = createDriveHelpers();
export const docs = createDocsHelpers();

// Factory for account-specific helpers
export function forAccount(account: string) {
  return withAccount(account);
}
