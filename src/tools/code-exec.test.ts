import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { codeExecTool } from "./code-exec.js";
import type { ToolContext } from "./registry.js";

function makeCtx(taskId = 1): ToolContext {
  const workDir = path.join(os.tmpdir(), `test-code-exec-${taskId}-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  return {
    taskId,
    workDir,
    timeoutMs: 10000,
    maxOutputSize: 1024 * 1024,
    onProgress: () => {},
  };
}

describe("code-exec tool", () => {
  it("executes javascript", async () => {
    const ctx = makeCtx();
    try {
      const result = await codeExecTool.execute({ code: "console.log('hello')", language: "javascript" }, ctx);
      expect(result.success).toBe(true);
      expect(result.result.trim()).toBe("hello");
    } finally {
      rmSync(ctx.workDir, { recursive: true, force: true });
    }
  });

  it("returns error on bad code", async () => {
    const ctx = makeCtx();
    try {
      const result = await codeExecTool.execute({ code: "throw new Error('boom')", language: "javascript" }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("boom");
    } finally {
      rmSync(ctx.workDir, { recursive: true, force: true });
    }
  });

  it("rejects empty code", async () => {
    const ctx = makeCtx();
    const result = await codeExecTool.execute({ code: "", language: "javascript" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No code");
    rmSync(ctx.workDir, { recursive: true, force: true });
  });

  it("rejects unsupported language", async () => {
    const ctx = makeCtx();
    const result = await codeExecTool.execute({ code: "print('hi')", language: "ruby" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported language");
    rmSync(ctx.workDir, { recursive: true, force: true });
  });

  // SECURITY: path traversal
  it("blocks path traversal in filename", async () => {
    const ctx = makeCtx();
    try {
      const result = await codeExecTool.execute({
        code: "console.log('pwned')",
        language: "javascript",
        filename: "../../evil.js",
      }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("path traversal");
    } finally {
      rmSync(ctx.workDir, { recursive: true, force: true });
    }
  });

  it("blocks absolute path in filename", async () => {
    const ctx = makeCtx();
    const result = await codeExecTool.execute({
      code: "x",
      language: "javascript",
      filename: "/etc/passwd",
    }, ctx);
    expect(result.success).toBe(false);
    rmSync(ctx.workDir, { recursive: true, force: true });
  });

  // SECURITY: env vars not leaked
  it("does not leak ANTHROPIC_API_KEY to child process", async () => {
    const ctx = makeCtx();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-secret";
    try {
      const result = await codeExecTool.execute({
        code: "console.log(process.env.ANTHROPIC_API_KEY || 'SAFE')",
        language: "javascript",
      }, ctx);
      expect(result.success).toBe(true);
      expect(result.result.trim()).toBe("SAFE");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      rmSync(ctx.workDir, { recursive: true, force: true });
    }
  });

  it("does not leak arbitrary env vars to child process", async () => {
    const ctx = makeCtx();
    process.env.MY_SECRET_KEY = "super-secret";
    try {
      const result = await codeExecTool.execute({
        code: "console.log(process.env.MY_SECRET_KEY || 'SAFE')",
        language: "javascript",
      }, ctx);
      expect(result.success).toBe(true);
      expect(result.result.trim()).toBe("SAFE");
    } finally {
      delete process.env.MY_SECRET_KEY;
      rmSync(ctx.workDir, { recursive: true, force: true });
    }
  });
});
