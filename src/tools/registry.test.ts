import { describe, it, expect, beforeEach } from "vitest";
import { registry, type ToolDefinition, type ToolContext, type ToolOutput } from "./registry.js";

// Rebuild registry for each test since it's a singleton
describe("tool registry", () => {
  it("registers and retrieves tools", () => {
    const tool: ToolDefinition = {
      name: "test_tool",
      description: "a test tool",
      parameters: { input: { type: "string", description: "test", required: true } },
      execute: async () => ({ success: true, result: "ok", durationMs: 0 }),
    };
    registry.register(tool);
    expect(registry.get("test_tool")).toBe(tool);
    expect(registry.listNames()).toContain("test_tool");
  });

  it("returns undefined for unknown tool", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("formats tools for Claude API", () => {
    const tools = registry.toClaudeTools();
    expect(Array.isArray(tools)).toBe(true);
    for (const t of tools) {
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("input_schema");
      expect(t.input_schema.type).toBe("object");
    }
  });

  it("enforces daily budget", async () => {
    registry.setDailyLimit(2);
    const ctx: ToolContext = {
      taskId: 1,
      workDir: "/tmp",
      timeoutMs: 1000,
      maxOutputSize: 1024,
      onProgress: () => {},
    };

    // Register a simple tool
    registry.register({
      name: "budget_test",
      description: "test",
      parameters: {},
      execute: async () => ({ success: true, result: "ok", durationMs: 0 }),
    });

    await registry.execute("budget_test", {}, ctx);
    await registry.execute("budget_test", {}, ctx);
    const third = await registry.execute("budget_test", {}, ctx);
    expect(third.success).toBe(false);
    expect(third.error).toContain("budget exceeded");

    // Reset
    registry.resetDailyUsage();
    const afterReset = await registry.execute("budget_test", {}, ctx);
    expect(afterReset.success).toBe(true);

    // Restore
    registry.setDailyLimit(500);
  });

  it("returns error for unknown tool execution", async () => {
    const ctx: ToolContext = {
      taskId: 1,
      workDir: "/tmp",
      timeoutMs: 1000,
      maxOutputSize: 1024,
      onProgress: () => {},
    };
    const result = await registry.execute("does_not_exist", {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });
});
