/**
 * Config loader — reads from ~/.shareabot-agent/config.yaml, env vars, and CLI args.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { DEFAULT_CONFIG, type AgentConfig } from "./schema.js";

const CONFIG_DIR = path.join(os.homedir(), ".shareabot-agent");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): AgentConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  // Load from file
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = parseYaml(raw);
      deepMerge(config, parsed);
    } catch (err) {
      console.error(`[config] failed to parse ${CONFIG_FILE}:`, err);
    }
  }

  // Override with env vars
  if (process.env.SHAREABOT_API_KEY) config.agent.apiKey = process.env.SHAREABOT_API_KEY;
  if (process.env.SHAREABOT_MODEL) config.agent.model = process.env.SHAREABOT_MODEL;
  if (process.env.SHAREABOT_EMAIL) config.platform.email = process.env.SHAREABOT_EMAIL;
  if (process.env.SHAREABOT_PASSWORD) config.platform.password = process.env.SHAREABOT_PASSWORD;
  if (process.env.SHAREABOT_API_URL) config.platform.apiUrl = process.env.SHAREABOT_API_URL;
  if (process.env.SHAREABOT_WS_URL) config.platform.wsUrl = process.env.SHAREABOT_WS_URL;
  if (process.env.ANTHROPIC_API_KEY) config.agent.apiKey = process.env.ANTHROPIC_API_KEY;

  return config;
}

export function saveConfig(config: AgentConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // Don't save secrets to disk in plain text
  const safe = structuredClone(config);
  if (safe.agent.apiKey) safe.agent.apiKey = "***";
  if (safe.platform.password) safe.platform.password = "***";
  if (safe.platform.token) safe.platform.token = "***";
  fs.writeFileSync(CONFIG_FILE, stringifyYaml(safe), "utf-8");
}

export function saveConfigFull(config: AgentConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // Redact secrets — store only non-sensitive config. Secrets come from env vars.
  const safe = structuredClone(config);
  if (safe.agent.apiKey) safe.agent.apiKey = "***";
  if (safe.platform.password) safe.platform.password = "***";
  // Keep token for WS auth (it's a session JWT, not a long-lived credential)
  fs.writeFileSync(CONFIG_FILE, stringifyYaml(safe), { encoding: "utf-8", mode: 0o600 });
}

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function deepMerge(target: Record<string, any>, source: Record<string, any>): void {
  for (const key of Object.keys(source)) {
    if (BLOCKED_KEYS.has(key)) continue;
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
}
