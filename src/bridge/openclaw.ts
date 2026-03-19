/**
 * OpenClaw Bridge — connects local OpenClaw instance to Share a Bot marketplace.
 *
 * Implements the OpenClaw gateway protocol:
 *   1. Connect WS
 *   2. Send "connect" request with auth token
 *   3. Handle "connect.challenge" — resend with nonce
 *   4. Receive hello.ok — authenticated
 *   5. Forward tasks as "agent.run" requests
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";
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
  let authenticated = false;
  let connectNonce: string | null = null;

  // Pending request/response tracking
  const pending = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  // Pending agent responses (streamed)
  const agentResponses = new Map<string, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    chunks: string[];
  }>();

  function sendRaw(data: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function sendConnect() {
    const id = `connect-${randomUUID().slice(0, 8)}`;
    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "node-host",
        displayName: "Share a Bot Agent Bridge",
        version: "0.1.0",
        platform: process.platform,
        mode: "backend",
      },
      auth: gatewayToken ? { token: gatewayToken } : undefined,
      role: "operator",
      scopes: ["operator.admin"],
    };

    sendRaw({ type: "req", method: "connect", id, params });

    // Track the connect response
    pending.set(id, {
      resolve: (payload) => {
        authenticated = true;
        console.log("[openclaw] authenticated with gateway");
      },
      reject: (err) => {
        console.error("[openclaw] connect failed:", err.message);
      },
    });
  }

  function handleMessage(raw: string) {
    try {
      const msg = JSON.parse(raw);

      // Event frame
      if (msg.type === "event") {
        if (msg.event === "connect.challenge") {
          // Challenge-response: save nonce and resend connect
          connectNonce = msg.payload?.nonce || null;
          if (connectNonce) {
            console.log("[openclaw] received challenge, sending auth...");
            sendConnect();
          }
          return;
        }

        // Agent streaming events
        if (msg.event === "agent.delta" || msg.event === "message.delta") {
          const sessionKey = msg.sessionKey || msg.meta?.sessionKey;
          if (sessionKey) {
            const resp = agentResponses.get(sessionKey);
            if (resp && msg.text) resp.chunks.push(msg.text);
          }
        }

        if (msg.event === "agent.end" || msg.event === "message.end") {
          const sessionKey = msg.sessionKey || msg.meta?.sessionKey;
          if (sessionKey) {
            const resp = agentResponses.get(sessionKey);
            if (resp) {
              const text = msg.text || msg.content || resp.chunks.join("");
              resp.resolve(text);
              agentResponses.delete(sessionKey);
            }
          }
        }
        return;
      }

      // Response frame (type: "res" in OpenClaw protocol)
      if (msg.type === "res" || msg.type === "response" || (msg.id && msg.ok !== undefined)) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.ok !== false) {
            p.resolve(msg.payload || msg.result || msg);
          } else {
            p.reject(new Error(msg.error?.message || "gateway error"));
          }
          return;
        }

        // Could be an agent response (non-streaming)
        if (msg.payload?.text || msg.payload?.content || msg.result) {
          const sessionKey = msg.meta?.sessionKey || msg.id;
          const resp = agentResponses.get(sessionKey);
          if (resp) {
            resp.resolve(msg.payload?.text || msg.payload?.content || JSON.stringify(msg.result));
            agentResponses.delete(sessionKey);
          }
        }
      }
    } catch {}
  }

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(gatewayUrl);

      const authTimeout = setTimeout(() => {
        if (!authenticated) {
          console.error("[openclaw] auth timeout");
          reject(new Error("Gateway auth timeout"));
        }
      }, 10000);

      ws.on("open", () => {
        console.log(`[openclaw] connected to ${gatewayUrl}`);
        // Start the connect handshake
        connectNonce = null;
        sendConnect();
      });

      ws.on("message", (data) => {
        handleMessage(data.toString());
        if (authenticated) {
          clearTimeout(authTimeout);
          resolve();
        }
      });

      ws.on("close", (code, reason) => {
        authenticated = false;
        const r = reason?.toString() || "";
        console.log(`[openclaw] disconnected: ${code} ${r}`);
        // Reject all pending
        for (const [id, p] of pending) {
          p.reject(new Error("disconnected"));
          pending.delete(id);
        }
        for (const [id, p] of agentResponses) {
          const partial = p.chunks.join("");
          if (partial) p.resolve(partial);
          else p.reject(new Error("disconnected"));
          agentResponses.delete(id);
        }
      });

      ws.on("error", (err) => {
        if (!authenticated) reject(err);
      });
    });
  }

  async function send(message: string, sessionId?: string): Promise<string> {
    if (!ws || !authenticated) {
      throw new Error("Not connected to OpenClaw gateway");
    }

    const id = randomUUID().slice(0, 12);
    const sessionKey = `shareabot:${sessionId || id}`;

    return new Promise((resolve, reject) => {
      agentResponses.set(sessionKey, { resolve, reject, chunks: [] });

      // Also track as a regular request in case it returns non-streamed
      pending.set(id, {
        resolve: (payload) => {
          const text = payload?.text || payload?.content || JSON.stringify(payload);
          if (agentResponses.has(sessionKey)) {
            agentResponses.get(sessionKey)!.resolve(text);
            agentResponses.delete(sessionKey);
          }
        },
        reject: (err) => {
          if (agentResponses.has(sessionKey)) {
            agentResponses.get(sessionKey)!.reject(err);
            agentResponses.delete(sessionKey);
          }
        },
      });

      sendRaw({
        type: "req",
        method: "agent.run",
        id,
        params: {
          message,
          sessionKey,
          stream: true,
        },
      });

      // Timeout
      const timeout = (config.security?.maxTimeSeconds || 300) * 1000;
      setTimeout(() => {
        if (agentResponses.has(sessionKey)) {
          const resp = agentResponses.get(sessionKey)!;
          const partial = resp.chunks.join("");
          if (partial) resp.resolve(partial);
          else resp.reject(new Error("OpenClaw response timed out"));
          agentResponses.delete(sessionKey);
        }
        pending.delete(id);
      }, timeout);
    });
  }

  async function getSkills(): Promise<string[]> {
    // OpenClaw skills are discovered through the config/agent setup
    // For now return empty — skills come from the agent's config
    return [];
  }

  await connect();

  return {
    send,
    getSkills,
    isConnected: () => authenticated,
    disconnect: () => {
      if (ws) { ws.close(); ws = null; }
      authenticated = false;
    },
  };
}
