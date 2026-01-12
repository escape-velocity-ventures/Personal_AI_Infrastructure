// index.ts - TELOS Metrics Dashboard Server
// HTTP + WebSocket server on port 4100

import {
  startWatching,
  getDashboardData,
  getKpisForGoal,
  getRecentMetrics,
  type DashboardData
} from "./metrics-api";

const PORT = 4100;
const wsClients = new Set<any>();

// Start file watching with WebSocket broadcast
startWatching((data: DashboardData) => {
  const message = JSON.stringify({ type: "update", data });
  wsClients.forEach(client => {
    try {
      client.send(message);
    } catch (err) {
      wsClients.delete(client);
    }
  });
});

const server = Bun.serve({
  port: PORT,

  async fetch(req: Request) {
    const url = new URL(req.url);

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", timestamp: Date.now() }),
        { headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // API: Get all dashboard data
    if (url.pathname === "/api/dashboard") {
      const data = getDashboardData();
      return new Response(JSON.stringify(data), {
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    // API: Get goals
    if (url.pathname === "/api/goals") {
      const data = getDashboardData();
      return new Response(JSON.stringify(data.goals), {
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    // API: Get all KPIs with progress
    if (url.pathname === "/api/kpis") {
      const data = getDashboardData();
      return new Response(JSON.stringify(data.kpis), {
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    // API: Get KPIs for a specific goal
    if (url.pathname.startsWith("/api/goals/") && url.pathname.endsWith("/kpis")) {
      const goalId = url.pathname.split("/")[3];
      const kpis = getKpisForGoal(goalId);
      return new Response(JSON.stringify(kpis), {
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    // API: Get recent metrics
    if (url.pathname === "/api/metrics/recent") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const metrics = getRecentMetrics(limit);
      return new Response(JSON.stringify(metrics), {
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    // WebSocket upgrade
    if (url.pathname === "/stream") {
      const success = server.upgrade(req);
      if (success) {
        return undefined;
      }
    }

    // Default response
    return new Response("TELOS Metrics Dashboard Server", {
      headers: { ...headers, "Content-Type": "text/plain" }
    });
  },

  websocket: {
    open(ws) {
      console.log("📱 WebSocket client connected");
      wsClients.add(ws);

      // Send initial data
      const data = getDashboardData();
      ws.send(JSON.stringify({ type: "initial", data }));
    },

    message(ws, message) {
      console.log("Received message:", message);
    },

    close(ws) {
      console.log("📱 WebSocket client disconnected");
      wsClients.delete(ws);
    },

    error(ws, error) {
      console.error("WebSocket error:", error);
      wsClients.delete(ws);
    }
  }
});

console.log(`🚀 TELOS Metrics Server running on http://localhost:${server.port}`);
console.log(`📊 WebSocket endpoint: ws://localhost:${server.port}/stream`);
console.log(`📈 Dashboard API: http://localhost:${server.port}/api/dashboard`);
