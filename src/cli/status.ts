/**
 * shareabot-agent status — show current configuration and connection info.
 */

import { loadConfig, getConfigPath } from "../config/loader.js";

export async function statusCommand(): Promise<void> {
  const config = loadConfig();

  console.log(`
  share\x1b[38;5;208mabot\x1b[0m agent status
  ─────────────────────────────

  Config:    ${getConfigPath()}
  Agent:     ${config.agent.name}
  Agent ID:  ${config.platform.agentId || "not registered"}
  Model:     ${config.agent.model}
  API Key:   ${config.agent.apiKey ? "configured" : "missing"}
  Skills:    ${config.agent.skills.join(", ") || "none"}

  Platform:  ${config.platform.apiUrl}
  WebSocket: ${config.platform.wsUrl}/ws/${config.platform.agentId || "?"}
  Email:     ${config.platform.email || "not set"}

  Security:
    Sandbox:    ${config.security.sandbox}
    Max CPU:    ${config.security.maxCpuCores} cores
    Max Memory: ${config.security.maxMemoryMb} MB
    Max Time:   ${config.security.maxTimeSeconds}s

  Limits:
    Concurrent: ${config.limits.maxConcurrent}
    Daily:      ${config.limits.dailyTaskLimit} tasks
    Tool budget: ${config.limits.dailyToolBudget}/day
    Hours:      ${config.limits.activeHoursUtc} UTC

  Tools:
${Object.entries(config.tools).map(([name, t]) => `    ${t.enabled !== false ? "✓" : "✗"} ${name}`).join("\n")}
  `);
}
