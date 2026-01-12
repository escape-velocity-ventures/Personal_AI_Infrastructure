import { getValidAccessToken } from "../auth/token-manager";

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
}

export async function googleApi<T>(
  endpoint: string,
  options: GoogleApiOptions = {}
): Promise<T> {
  await waitForRateLimit();

  const accessToken = await getValidAccessToken();
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

// Gmail API helpers
export const gmail = {
  async search(query: string, maxResults = 10) {
    interface MessagesResponse {
      messages?: { id: string; threadId: string }[];
    }
    const result = await googleApi<MessagesResponse>("/gmail/v1/users/me/messages", {
      params: { q: query, maxResults },
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
    });
  },

  async listLabels() {
    interface LabelsResponse {
      labels: { id: string; name: string; type: string }[];
    }
    const result = await googleApi<LabelsResponse>("/gmail/v1/users/me/labels");
    return result.labels;
  },
};

// Calendar API helpers
export const calendar = {
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
      }
    );
    return result.items || [];
  },

  async getEvent(eventId: string, calendarId = "primary") {
    return googleApi(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`);
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
    });
  },
};

// Drive API helpers
export const drive = {
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
    });
    return result.files || [];
  },

  async getFile(fileId: string) {
    return googleApi(`/drive/v3/files/${fileId}`, {
      params: { fields: "id,name,mimeType,modifiedTime,size,webViewLink" },
    });
  },

  async readContent(fileId: string) {
    const accessToken = await getValidAccessToken();
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
