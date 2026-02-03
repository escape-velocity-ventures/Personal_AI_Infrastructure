#!/usr/bin/env bun
import { gmailTools, handleGmailTool } from "./tools/gmail";
import { calendarTools, handleCalendarTool } from "./tools/calendar";
import { driveTools, handleDriveTool, docsTools, handleDocsTool } from "./tools/drive";
import type { McpRequest, McpResponse, CallToolParams, ToolDefinition } from "./types";

const SERVER_NAME = "pai-google-workspace";
const SERVER_VERSION = "1.0.0";

const allTools: ToolDefinition[] = [...gmailTools, ...calendarTools, ...driveTools, ...docsTools];

function createResponse(id: number | string, result: unknown): McpResponse {
  return { jsonrpc: "2.0", id, result };
}

function createError(id: number | string, code: number, message: string): McpResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRequest(request: McpRequest): Promise<McpResponse> {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return createResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });

    case "notifications/initialized":
      // This is a notification, no response needed
      return createResponse(id, {});

    case "tools/list":
      return createResponse(id, {
        tools: allTools,
      });

    case "tools/call": {
      const { name, arguments: args = {} } = params as CallToolParams;

      try {
        let result: unknown;

        if (name.startsWith("gmail_")) {
          result = await handleGmailTool(name, args);
        } else if (name.startsWith("calendar_")) {
          result = await handleCalendarTool(name, args);
        } else if (name.startsWith("drive_")) {
          result = await handleDriveTool(name, args);
        } else if (name.startsWith("docs_")) {
          result = await handleDocsTool(name, args);
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }

        return createResponse(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createResponse(id, {
          content: [
            {
              type: "text",
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        });
      }
    }

    default:
      return createError(id, -32601, `Method not found: ${method}`);
  }
}

async function main() {
  const decoder = new TextDecoder();
  let buffer = "";

  process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} started\n`);

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk);

    // Process complete JSON-RPC messages
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (buffer.length < messageEnd) break;

      const messageJson = buffer.slice(messageStart, messageEnd);
      buffer = buffer.slice(messageEnd);

      try {
        const request = JSON.parse(messageJson) as McpRequest;
        const response = await handleRequest(request);

        // Skip response for notifications
        if (request.method.startsWith("notifications/")) {
          continue;
        }

        const responseJson = JSON.stringify(response);
        const responseMessage = `Content-Length: ${Buffer.byteLength(responseJson)}\r\n\r\n${responseJson}`;
        process.stdout.write(responseMessage);
      } catch (error) {
        process.stderr.write(`Error processing message: ${error}\n`);
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
