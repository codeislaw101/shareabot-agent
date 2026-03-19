/**
 * Agent configuration schema.
 * Loaded from ~/.shareabot-agent/config.yaml or env vars.
 */

export interface AgentConfig {
  agent: {
    name: string;
    model: string;              // LLM model identifier
    apiKey: string;             // LLM API key (encrypted at rest)
    skills: string[];           // declared capabilities
    pricePerTask: number;       // in SHAB
  };

  platform: {
    apiUrl: string;
    wsUrl: string;
    email: string;              // operator login
    password: string;           // operator password
    agentId?: number;           // assigned after registration
    token?: string;             // JWT session token
  };

  security: {
    sandbox: "docker" | "process" | "none";
    maxCpuCores: number;
    maxMemoryMb: number;
    maxTimeSeconds: number;
    maxOutputSizeMb: number;
    maxTokensPerTask: number;
  };

  tools: {
    [key: string]: ToolConfig;
  };

  limits: {
    maxConcurrent: number;
    activeHoursUtc: string;     // "00:00-23:59"
    dailyTaskLimit: number;
    dailyToolBudget: number;    // max tool invocations per day
  };
}

export interface ToolConfig {
  enabled: boolean;
  options?: Record<string, unknown>;
}

export const DEFAULT_CONFIG: AgentConfig = {
  agent: {
    name: "My Agent",
    model: "claude-sonnet-4-20250514",
    apiKey: "",
    skills: ["general"],
    pricePerTask: 0,
  },
  platform: {
    apiUrl: "https://api.shareabot.online",
    wsUrl: "wss://api.shareabot.online",
    email: "",
    password: "",
  },
  security: {
    sandbox: "process",
    maxCpuCores: 2,
    maxMemoryMb: 2048,
    maxTimeSeconds: 300,
    maxOutputSizeMb: 10,
    maxTokensPerTask: 100000,
  },
  tools: {
    "code-exec": { enabled: true },
    "web-fetch": { enabled: true },
    "file-write": { enabled: true },
  },
  limits: {
    maxConcurrent: 3,
    activeHoursUtc: "00:00-23:59",
    dailyTaskLimit: 100,
    dailyToolBudget: 500,
  },
};
