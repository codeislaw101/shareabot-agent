/**
 * WebSocket transport — connects to Share a Bot platform.
 * Handles: task_assigned, heartbeat, reconnection.
 * Sends: task_accepted, work_submitted, progress, heartbeat.
 */

import WebSocket from "ws";
import type { AgentConfig } from "../config/schema.js";
import { executeTask, type TaskData, type Deliverable } from "../agent/worker.js";

export interface ConnectionCallbacks {
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onTaskReceived: (task: TaskData) => void;
  onError: (error: string) => void;
}

export class PlatformConnection {
  private ws: WebSocket | null = null;
  private config: AgentConfig;
  private callbacks: ConnectionCallbacks;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private activeTasks = new Map<number, boolean>();

  constructor(config: AgentConfig, callbacks: ConnectionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  connect(): void {
    const agentId = this.config.platform.agentId;
    if (!agentId) {
      this.callbacks.onError("No agent ID configured. Run 'shareabot-agent init' first.");
      return;
    }

    const token = this.config.platform.token || "";
    const url = `${this.config.platform.wsUrl}/ws/${agentId}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    console.log(`[ws] connecting to ${url.split("?")[0]}...`);

    // Clean up old socket if exists
    if (this.ws) {
      try { this.ws.removeAllListeners(); this.ws.close(); } catch {}
      this.ws = null;
    }

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log(`[ws] connected as agent #${agentId}`);
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.callbacks.onConnected();
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (err) {
        console.error("[ws] invalid message:", err);
      }
    });

    this.ws.on("close", (code, reason) => {
      const r = reason?.toString() || "unknown";
      console.log(`[ws] disconnected: ${code} ${r}`);
      this.stopHeartbeat();
      this.callbacks.onDisconnected(r);
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error("[ws] error:", err.message);
      this.callbacks.onError(err.message);
    });
  }

  private handleMessage(msg: any): void {
    switch (msg.event) {
      case "task_assigned":
        this.onTaskAssigned(msg);
        break;
      case "heartbeat_ack":
        // ok
        break;
      case "client_message":
      case "steering_update":
        console.log(`[ws] ${msg.event}: ${msg.content}`);
        break;
      default:
        console.log(`[ws] unhandled event: ${msg.event}`);
    }
  }

  private async onTaskAssigned(msg: any): Promise<void> {
    const taskId = msg.taskId;
    console.log(`[task] received task #${taskId}: ${msg.description?.substring(0, 80)}...`);

    // Guard: duplicate task ID
    if (this.activeTasks.has(taskId)) {
      console.log(`[task] duplicate task #${taskId}, ignoring`);
      return;
    }

    // Check capacity
    if (this.activeTasks.size >= this.config.limits.maxConcurrent) {
      console.log(`[task] at capacity (${this.activeTasks.size}/${this.config.limits.maxConcurrent}), skipping task #${taskId}`);
      return;
    }

    // Accept the task — reserve slot immediately
    this.activeTasks.set(taskId, true);
    this.send({ event: "task_accepted", taskId });
    console.log(`[task] accepted task #${taskId}`);

    // Send progress updates
    const sendProgress = (stage: string, detail: string) => {
      this.send({ event: "progress", taskId, stage, detail, agentName: this.config.agent.name });
    };

    try {
      sendProgress("thinking", "Analyzing task...");

      const task: TaskData = {
        taskId,
        description: msg.description || "",
        budget: msg.budget || 0,
        files: msg.files || [],
        context: msg.context || [],
        classification: msg.classification || { skill: "general", complexity: "simple" },
        skillKnowledge: msg.skillKnowledge || "",
        workspaceId: msg.workspaceId || null,
      };

      this.callbacks.onTaskReceived(task);

      // Execute the task
      const deliverable = await executeTask(task, this.config, sendProgress);

      sendProgress("reviewing", "Finalizing deliverable...");

      // Submit the work
      this.send({
        event: "work_submitted",
        taskId,
        deliverable: {
          format: deliverable.format,
          summary: deliverable.summary,
          content: deliverable.content,
          artifacts: deliverable.artifacts,
          tokensUsed: deliverable.tokensUsed,
          toolCalls: deliverable.toolCalls,
          toolsUsed: deliverable.toolsUsed,
          executionTime: deliverable.executionTime,
          model: deliverable.model,
        },
      });

      console.log(`[task] submitted work for task #${taskId} (${deliverable.artifacts.length} artifacts, ${deliverable.tokensUsed} tokens)`);
    } catch (err) {
      console.error(`[task] failed on task #${taskId}:`, err);
      this.send({
        event: "task_failed",
        taskId,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  send(data: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.send({ event: "heartbeat" });
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 10) {
      console.error("[ws] max reconnection attempts reached");
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[ws] reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getActiveTasks(): number {
    return this.activeTasks.size;
  }
}
