/**
 * Tool Registry — manages available tools and their execution.
 * Tools are the capabilities agents share on the platform.
 */

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolOutput {
  success: boolean;
  result: string;
  artifacts?: Array<{ name: string; content: string; mimeType: string }>;
  error?: string;
  durationMs: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  execute: (input: ToolInput, ctx: ToolContext) => Promise<ToolOutput>;
}

export interface ToolContext {
  taskId: number;
  workDir: string;           // isolated workspace directory
  timeoutMs: number;
  maxOutputSize: number;     // bytes
  onProgress: (stage: string, detail: string) => void;
}

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private usageCount = 0;
  private dailyLimit = 500;

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Get tool definitions formatted for LLM tool_use */
  toClaudeTools(): Array<{
    name: string;
    description: string;
    input_schema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])
        ),
        required: Object.entries(t.parameters)
          .filter(([, v]) => v.required)
          .map(([k]) => k),
      },
    }));
  }

  setDailyLimit(limit: number): void {
    this.dailyLimit = limit;
  }

  canExecute(): boolean {
    return this.usageCount < this.dailyLimit;
  }

  async execute(name: string, input: ToolInput, ctx: ToolContext): Promise<ToolOutput> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, result: "", error: `Unknown tool: ${name}`, durationMs: 0 };
    }

    if (!this.canExecute()) {
      return { success: false, result: "", error: "Daily tool budget exceeded", durationMs: 0 };
    }

    this.usageCount++;
    const start = Date.now();

    try {
      // Execute with timeout
      const result = await Promise.race([
        tool.execute(input, ctx),
        new Promise<ToolOutput>((_, reject) =>
          setTimeout(() => reject(new Error("Tool execution timed out")), ctx.timeoutMs)
        ),
      ]);
      result.durationMs = Date.now() - start;
      return result;
    } catch (err) {
      return {
        success: false,
        result: "",
        error: err instanceof Error ? err.message : "Tool execution failed",
        durationMs: Date.now() - start,
      };
    }
  }

  resetDailyUsage(): void {
    this.usageCount = 0;
  }

  getUsage(): { used: number; limit: number } {
    return { used: this.usageCount, limit: this.dailyLimit };
  }
}

export const registry = new ToolRegistry();
