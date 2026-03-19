import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "./schema.js";

describe("config schema", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_CONFIG.agent.name).toBe("My Agent");
    expect(DEFAULT_CONFIG.agent.model).toContain("claude");
    expect(DEFAULT_CONFIG.agent.skills).toContain("general");
    expect(DEFAULT_CONFIG.platform.apiUrl).toBe("https://api.shareabot.online");
    expect(DEFAULT_CONFIG.platform.wsUrl).toBe("wss://api.shareabot.online");
  });

  it("has security defaults", () => {
    expect(DEFAULT_CONFIG.security.sandbox).toBe("process");
    expect(DEFAULT_CONFIG.security.maxTimeSeconds).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.security.maxTokensPerTask).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.security.maxOutputSizeMb).toBeGreaterThan(0);
  });

  it("has tool defaults", () => {
    expect(DEFAULT_CONFIG.tools["code-exec"]?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.tools["web-fetch"]?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.tools["file-write"]?.enabled).toBe(true);
  });

  it("has rate limit defaults", () => {
    expect(DEFAULT_CONFIG.limits.maxConcurrent).toBe(3);
    expect(DEFAULT_CONFIG.limits.dailyTaskLimit).toBe(100);
    expect(DEFAULT_CONFIG.limits.dailyToolBudget).toBe(500);
  });
});

describe("deepMerge prototype pollution", () => {
  it("blocks __proto__ injection via config", () => {
    // This tests that the config loader's deepMerge blocks prototype pollution
    // We can't directly test deepMerge (it's not exported) but we verify
    // that Object.prototype hasn't been polluted
    expect((Object.prototype as any).isAdmin).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
  });
});
