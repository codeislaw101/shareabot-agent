/**
 * shareabot-agent init — interactive setup wizard.
 */

import readline from "node:readline";
import { loadConfig, saveConfigFull, getConfigPath } from "../config/loader.js";

function ask(rl: readline.Interface, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` (${defaultVal})` : "";
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

export async function initCommand(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │   share\x1b[38;5;208mabot\x1b[0m agent                                │
  │                                                      │
  │   Turn your AI into a freelance business   v0.1.0    │
  │   https://shareabot.online                           │
  │                                                      │
  └──────────────────────────────────────────────────────┘
  `);

  const config = loadConfig();

  console.log("  Step 1/4: Agent Details\n");
  config.agent.name = await ask(rl, "Agent name", config.agent.name);
  config.agent.model = await ask(rl, "LLM model", config.agent.model);
  config.agent.apiKey = await ask(rl, "Anthropic API key", config.agent.apiKey ? "***" : "");
  if (config.agent.apiKey === "***") config.agent.apiKey = loadConfig().agent.apiKey;

  const skillsInput = await ask(rl, "Skills (comma-separated)", config.agent.skills.join(", "));
  config.agent.skills = skillsInput.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  console.log("\n  Step 2/4: Platform Connection\n");
  config.platform.email = await ask(rl, "Share a Bot email", config.platform.email);
  config.platform.password = await ask(rl, "Share a Bot password");

  // Authenticate
  console.log("\n  Connecting to Share a Bot...");
  try {
    const loginRes = await fetch(`${config.platform.apiUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: config.platform.email, password: config.platform.password }),
    });

    if (!loginRes.ok) {
      // Try signup
      console.log("  Account not found, creating...");
      const signupRes = await fetch(`${config.platform.apiUrl}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: config.platform.email, password: config.platform.password, name: config.agent.name }),
      });
      if (!signupRes.ok) {
        const err = await signupRes.json().catch(() => ({}));
        console.error(`  ✗ Failed: ${(err as any).error || "Unknown error"}`);
        rl.close();
        return;
      }
      const signupData = await signupRes.json() as { token: string };
      config.platform.token = signupData.token;
      console.log("  ✓ Account created");
    } else {
      const loginData = await loginRes.json() as { token: string };
      config.platform.token = loginData.token;
      console.log("  ✓ Authenticated");
    }

    // Register agent
    console.log("  Registering agent...");
    const regRes = await fetch(`${config.platform.apiUrl}/agents/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.platform.token}`,
      },
      body: JSON.stringify({
        name: config.agent.name,
        skills: config.agent.skills,
        model: config.agent.model,
        tools: ["code-exec", "web-fetch", "file-write"],
      }),
    });

    if (regRes.ok) {
      const regData = await regRes.json() as { agentId: number; wsUrl: string };
      config.platform.agentId = regData.agentId;
      console.log(`  ✓ Registered as Agent #${regData.agentId}`);
      console.log(`  ✓ WebSocket: ${regData.wsUrl}`);
    } else {
      const err = await regRes.json().catch(() => ({}));
      console.error(`  ✗ Registration failed: ${(err as any).error || "Unknown error"}`);
    }
  } catch (err) {
    console.error(`  ✗ Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }

  console.log("\n  Step 3/4: Security\n");
  const sandbox = await ask(rl, "Sandbox mode (process/docker/none)", config.security.sandbox);
  config.security.sandbox = sandbox as any;
  const maxTime = await ask(rl, "Max task time (seconds)", String(config.security.maxTimeSeconds));
  config.security.maxTimeSeconds = parseInt(maxTime) || 300;

  console.log("\n  Step 4/4: Limits\n");
  const maxConcurrent = await ask(rl, "Max concurrent tasks", String(config.limits.maxConcurrent));
  config.limits.maxConcurrent = parseInt(maxConcurrent) || 3;
  const dailyLimit = await ask(rl, "Daily task limit", String(config.limits.dailyTaskLimit));
  config.limits.dailyTaskLimit = parseInt(dailyLimit) || 100;

  // Save
  saveConfigFull(config);
  console.log(`\n  ✓ Config saved to ${getConfigPath()}`);

  console.log(`
  ┌──────────────────────────────────────────────────────┐
  │  Setup Complete!                                     │
  │                                                      │
  │  Agent: ${config.agent.name.padEnd(44)}│
  │  ID: ${String(config.platform.agentId || "pending").padEnd(47)}│
  │  Skills: ${config.agent.skills.join(", ").substring(0, 42).padEnd(42)}│
  │  Model: ${config.agent.model.substring(0, 43).padEnd(43)}│
  │                                                      │
  │  Run: shareabot-agent start                          │
  └──────────────────────────────────────────────────────┘
  `);

  rl.close();
}
