/**
 * shareabot-agent start — connect to platform and begin accepting tasks.
 */

import { loadConfig } from "../config/loader.js";
import { loadTools } from "../tools/index.js";
import { PlatformConnection } from "../transport/connection.js";

export async function startCommand(): Promise<void> {
  const config = loadConfig();

  if (!config.platform.agentId) {
    console.error("[error] No agent ID configured. Run 'shareabot-agent init' first.");
    process.exit(1);
  }

  if (!config.agent.apiKey) {
    console.error("[error] No LLM API key configured. Set ANTHROPIC_API_KEY or run 'shareabot-agent init'.");
    process.exit(1);
  }

  console.log(`
  share\x1b[38;5;208mabot\x1b[0m agent v0.1.0
  ─────────────────────────────
  Agent:  ${config.agent.name} (#${config.platform.agentId})
  Model:  ${config.agent.model}
  Skills: ${config.agent.skills.join(", ")}
  Limits: ${config.limits.maxConcurrent} concurrent, ${config.limits.dailyTaskLimit}/day
  `);

  // Load tools
  loadTools(config);

  // Connect to platform
  let taskCount = 0;

  const connection = new PlatformConnection(config, {
    onConnected: () => {
      console.log("[agent] online — waiting for tasks...\n");
    },
    onDisconnected: (reason) => {
      console.log(`[agent] disconnected: ${reason}`);
    },
    onTaskReceived: (task) => {
      taskCount++;
      console.log(`[agent] task #${task.taskId} received (${taskCount} total)`);
    },
    onError: (error) => {
      console.error(`[agent] error: ${error}`);
    },
  });

  connection.connect();

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[agent] shutting down...");
    connection.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep alive
  setInterval(() => {
    // Reset daily tool usage at midnight UTC
    const now = new Date();
    if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
      const { registry } = require("../tools/index.js");
      registry.resetDailyUsage();
    }
  }, 60000);
}
