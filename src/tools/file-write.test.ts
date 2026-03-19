import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { fileWriteTool, fileReadTool } from "./file-write.js";
import type { ToolContext } from "./registry.js";

function makeCtx(): ToolContext {
  const workDir = path.join(os.tmpdir(), `test-file-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  return {
    taskId: 1,
    workDir,
    timeoutMs: 5000,
    maxOutputSize: 1024 * 1024,
    onProgress: () => {},
  };
}

describe("file-write tool", () => {
  it("writes a file to workspace", async () => {
    const ctx = makeCtx();
    try {
      const result = await fileWriteTool.execute({ filename: "test.txt", content: "hello world" }, ctx);
      expect(result.success).toBe(true);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts![0].name).toBe("test.txt");
      const written = readFileSync(path.join(ctx.workDir, "test.txt"), "utf-8");
      expect(written).toBe("hello world");
    } finally {
      rmSync(ctx.workDir, { recursive: true, force: true });
    }
  });

  it("creates subdirectories", async () => {
    const ctx = makeCtx();
    try {
      const result = await fileWriteTool.execute({ filename: "src/app.js", content: "const x = 1;" }, ctx);
      expect(result.success).toBe(true);
      const written = readFileSync(path.join(ctx.workDir, "src", "app.js"), "utf-8");
      expect(written).toBe("const x = 1;");
    } finally {
      rmSync(ctx.workDir, { recursive: true, force: true });
    }
  });

  it("rejects empty filename", async () => {
    const ctx = makeCtx();
    const result = await fileWriteTool.execute({ filename: "", content: "x" }, ctx);
    expect(result.success).toBe(false);
    rmSync(ctx.workDir, { recursive: true, force: true });
  });

  // SECURITY: path traversal
  it("blocks path traversal with ..", async () => {
    const ctx = makeCtx();
    const result = await fileWriteTool.execute({ filename: "../../evil.txt", content: "pwned" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("path traversal");
    rmSync(ctx.workDir, { recursive: true, force: true });
  });

  it("blocks absolute path", async () => {
    const ctx = makeCtx();
    const result = await fileWriteTool.execute({ filename: "/etc/passwd", content: "pwned" }, ctx);
    expect(result.success).toBe(false);
    rmSync(ctx.workDir, { recursive: true, force: true });
  });

  it("blocks Windows absolute path", async () => {
    const ctx = makeCtx();
    const result = await fileWriteTool.execute({ filename: "C:\\Windows\\evil.txt", content: "pwned" }, ctx);
    expect(result.success).toBe(false);
    rmSync(ctx.workDir, { recursive: true, force: true });
  });
});

describe("file-read tool", () => {
  it("reads a file from workspace", async () => {
    const ctx = makeCtx();
    try {
      await fileWriteTool.execute({ filename: "data.txt", content: "read me" }, ctx);
      const result = await fileReadTool.execute({ filename: "data.txt" }, ctx);
      expect(result.success).toBe(true);
      expect(result.result).toBe("read me");
    } finally {
      rmSync(ctx.workDir, { recursive: true, force: true });
    }
  });

  it("returns error for missing file", async () => {
    const ctx = makeCtx();
    const result = await fileReadTool.execute({ filename: "nope.txt" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
    rmSync(ctx.workDir, { recursive: true, force: true });
  });

  it("blocks path traversal on read", async () => {
    const ctx = makeCtx();
    const result = await fileReadTool.execute({ filename: "../../etc/passwd" }, ctx);
    expect(result.success).toBe(false);
    rmSync(ctx.workDir, { recursive: true, force: true });
  });
});
