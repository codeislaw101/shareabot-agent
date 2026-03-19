/**
 * OpenClaw Bridge — connects local OpenClaw instance to Share a Bot marketplace.
 *
 * Instead of running its own LLM + tools, shareabot-agent delegates all work
 * to the operator's OpenClaw instance. OpenClaw has the real skills, tools,
 * LLM config, and agent personality.
 *
 * Flow:
 *   1. Share a Bot sends task → shareabot-agent receives via WS
 *   2. shareabot-agent forwards to local OpenClaw gateway (localhost:18789)
 *   3. OpenClaw processes with its full skill/tool stack
 *   4. shareabot-agent captures the response
 *   5. shareabot-agent packages and sends deliverable back to Share a Bot
 */

import WebSocket from "ws";
import type { AgentConfig } from "../config/schema.js";

export interface OpenClawConnection {
  send(message: string, sessionId?: string): Promise<string>;
  getSkills(): Promise<string[]>;
  isConnected(): boolean;
  disconnect(): void;
}

export async function connectToOpenClaw(config: AgentConfig): Promise<OpenClawConnection> {
  const gatewayUrl = config.openclaw?.gatewayUrl || "ws://127.0.0.1:18789";
  const gatewayToken = config.openclaw?.gatewayToken || "";

  let ws: WebSocket | null = null;
  let connected = false;
  const pendingResponses = new Map<string, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    chunks: string[];
  }>();

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = gatewayToken ? `${gatewayUrl}?token=${encodeURIComponent(gatewayToken)}` : gatewayUrl;
      ws = new WebSocket(url);

      ws.on("open", () => {
        connected = true;
        console.log(`[openclaw] connected to gateway at ${gatewayUrl}`);

        // Send connect handshake
        ws!.send(JSON.stringify({
          type: "connect",
          auth: gatewayToken ? { token: gatewayToken } : undefined,
          client: {
            name: "shareabot-agent",
            mode: "node-host",
            version: "0.1.0",
          },
        }));

        resolve();
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          handleMessage(msg);
        } catch {}
      });

      ws.on("close", () => {
        connected = false;
        console.log("[openclaw] disconnected from gateway");
      });

      ws.on("error", (err) => {
        if (!connected) reject(err);
        console.error("[openclaw] gateway error:", err.message);
      });
    });
  }

  function handleMessage(msg: any) {
    // Handle streamed agent responses
    if (msg.type === "agent.message.delta" || msg.type === "message.delta") {
      const sessionId = msg.sessionId || msg.id || "default";
      const pending = pendingResponses.get(sessionId);
      if (pending && msg.text) {
        pending.chunks.push(msg.text);
      }
    }

    if (msg.type === "agent.message.end" || msg.type === "message.end" || msg.type === "agent.response") {
      const sessionId = msg.sessionId || msg.id || "default";
      const pending = pendingResponses.get(sessionId);
      if (pending) {
        const fullText = msg.text || msg.content || pending.chunks.join("");
        pending.resolve(fullText);
        pendingResponses.delete(sessionId);
      }
    }

    // Handle errors
    if (msg.type === "error") {
      for (const [id, pending] of pendingResponses) {
        pending.reject(new Error(msg.message || "OpenClaw error"));
        pendingResponses.delete(id);
      }
    }
  }

  async function send(message: string, sessionId?: string): Promise<string> {
    if (!ws || !connected) {
      throw new Error("Not connected to OpenClaw gateway");
    }

    const id = sessionId || `shareabot-${Date.now()}`;

    return new Promise((resolve, reject) => {
      pendingResponses.set(id, { resolve, reject, chunks: [] });

      // Send as a chat message to OpenClaw
      ws!.send(JSON.stringify({
        type: "request",
        method: "agent.run",
        id,
        params: {
          message,
          sessionKey: `shareabot:${id}`,
          stream: true,
        },
      }));

      // Timeout after maxTimeSeconds
      const timeout = (config.security?.maxTimeSeconds || 300) * 1000;
      setTimeout(() => {
        if (pendingResponses.has(id)) {
          const pending = pendingResponses.get(id)!;
          const partial = pending.chunks.join("");
          if (partial) {
            pending.resolve(partial);
          } else {
            pending.reject(new Error("OpenClaw response timed out"));
          }
          pendingResponses.delete(id);
        }
      }, timeout);
    });
  }

  async function getSkills(): Promise<string[]> {
    if (!ws || !connected) return [];

    return new Promise((resolve) => {
      const id = `skills-${Date.now()}`;

      const handler = (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === id && msg.result) {
            resolve(msg.result.skills || msg.result || []);
            ws!.off("message", handler);
          }
        } catch {}
      };

      ws!.on("message", handler);
      ws!.send(JSON.stringify({
        type: "request",
        method: "skills.list",
        id,
        params: {},
      }));

      // Timeout
      setTimeout(() => {
        ws!.off("message", handler);
        resolve([]);
      }, 5000);
    });
  }

  // Connect
  await connect();

  return {
    send,
    getSkills,
    isConnected: () => connected,
    disconnect: () => {
      if (ws) { ws.close(); ws = null; }
      connected = false;
    },
  };
}
