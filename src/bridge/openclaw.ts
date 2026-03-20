/**
 * OpenClaw Bridge — connects local OpenClaw instance to Share a Bot marketplace.
 *
 * Implements the OpenClaw gateway protocol v3:
 *   1. Connect WS with auth
 *   2. Handle "connect.challenge" — resend with nonce
 *   3. Receive hello-ok — authenticated
 *   4. Forward tasks as "agent" requests (with idempotencyKey)
 *   5. Collect streamed "agent" events (assistant text + lifecycle end)
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

  // Pending request/response tracking (by request id)
  const pending = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  // Pending agent runs — keyed by runId, accumulates streamed text
  const agentRuns = new Map<string, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    chunks: string[];
    sessionKey: string;
  }>();

  // Map sessionKey → runId (set when first "accepted" response arrives)
  const sessionToRun = new Map<string, string>();

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
        id: "shareabot-bridge",
        displayName: "Share a Bot Agent Bridge",
        version: "0.2.0",
        platform: process.platform,
        mode: "backend",
      },
      auth: gatewayToken ? { token: gatewayToken } : undefined,
      role: "operator",
      scopes: ["operator.admin"],
    };

    sendRaw({ type: "req", method: "connect", id, params });

    pending.set(id, {
      resolve: () => {
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

      // ── Event frames ──
      if (msg.type === "event") {
        if (msg.event === "connect.challenge") {
          console.log("[openclaw] received challenge, sending auth...");
          sendConnect();
          return;
        }

        // Agent streaming: broadcast "agent" events carry streamed output
        if (msg.event === "agent") {
          const runId = msg.runId;
          const run = runId ? agentRuns.get(runId) : undefined;
          if (!run) return;

          // Collect assistant text chunks
          if (msg.stream === "assistant" && msg.data?.text) {
            run.chunks.push(msg.data.text);
          }

          // Lifecycle end = agent finished
          if (msg.stream === "lifecycle" && msg.data?.phase === "end") {
            const text = run.chunks.join("");
            run.resolve(text);
            agentRuns.delete(runId);
            sessionToRun.delete(run.sessionKey);
          }

          // Lifecycle error
          if (msg.stream === "lifecycle" && msg.data?.phase === "error") {
            run.reject(new Error(msg.data?.error || "OpenClaw agent error"));
            agentRuns.delete(runId);
            sessionToRun.delete(run.sessionKey);
          }
        }
        return;
      }

      // ── Response frames ──
      if (msg.type === "res" || (msg.id && msg.ok !== undefined)) {
        const p = pending.get(msg.id);

        if (msg.ok === false) {
          // Error response
          const err = new Error(msg.error?.message || "gateway error");
          if (p) { pending.delete(msg.id); p.reject(err); }
          return;
        }

        const payload = msg.payload || msg.result || {};

        // First response: "accepted" — register the runId for streaming
        if (payload.status === "accepted" && payload.runId) {
          const runId = payload.runId;
          // Find the agentRun by matching the request id → sessionKey
          // The pending handler was set up in send() to link these
          if (p) {
            pending.delete(msg.id);
            p.resolve(payload); // triggers the runId linking in send()
          }
          return;
        }

        // Second response: "completed" — agent finished (non-streaming or final)
        if (payload.status === "completed" && payload.runId) {
          const run = agentRuns.get(payload.runId);
          if (run) {
            const text = payload.result?.text || payload.result?.content ||
              run.chunks.join("") || JSON.stringify(payload.result || {});
            run.resolve(text);
            agentRuns.delete(payload.runId);
            sessionToRun.delete(run.sessionKey);
          }
          if (p) { pending.delete(msg.id); }
          return;
        }

        // Second response: "error"
        if (payload.status === "error" && payload.runId) {
          const run = agentRuns.get(payload.runId);
          if (run) {
            run.reject(new Error(payload.summary || "OpenClaw agent error"));
            agentRuns.delete(payload.runId);
            sessionToRun.delete(run.sessionKey);
          }
          if (p) { pending.delete(msg.id); }
          return;
        }

        // Generic response (e.g. connect hello-ok)
        if (p) {
          pending.delete(msg.id);
          p.resolve(payload);
        }
      }
    } catch (err) {
      console.error("[openclaw] failed to parse message:", err);
    }
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
        for (const [, p] of pending) p.reject(new Error("disconnected"));
        pending.clear();
        for (const [, run] of agentRuns) {
          const partial = run.chunks.join("");
          if (partial) run.resolve(partial);
          else run.reject(new Error("disconnected"));
        }
        agentRuns.clear();
        sessionToRun.clear();
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
    const idempotencyKey = randomUUID();

    return new Promise((resolve, reject) => {
      // Pre-register the agentRun with a placeholder runId (will be set on "accepted")
      const runPlaceholder = { resolve, reject, chunks: [] as string[], sessionKey };

      // Track the initial request to get the runId from the "accepted" response
      pending.set(id, {
        resolve: (payload) => {
          if (payload.runId) {
            agentRuns.set(payload.runId, runPlaceholder);
            sessionToRun.set(sessionKey, payload.runId);
            console.log(`[openclaw] agent run ${payload.runId} accepted for session ${sessionKey}`);
          } else {
            // No runId — treat as immediate response
            const text = payload?.text || payload?.content || JSON.stringify(payload);
            resolve(text);
          }
        },
        reject,
      });

      sendRaw({
        type: "req",
        method: "agent",
        id,
        params: {
          message,
          sessionKey,
          idempotencyKey,
        },
      });

      // Timeout
      const timeout = (config.security?.maxTimeSeconds || 300) * 1000;
      setTimeout(() => {
        const runId = sessionToRun.get(sessionKey);
        const run = runId ? agentRuns.get(runId) : undefined;
        if (run) {
          const partial = run.chunks.join("");
          if (partial) run.resolve(partial);
          else run.reject(new Error("OpenClaw response timed out"));
          agentRuns.delete(runId!);
          sessionToRun.delete(sessionKey);
        }
        pending.delete(id);
      }, timeout);
    });
  }

  async function getSkills(): Promise<string[]> {
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
