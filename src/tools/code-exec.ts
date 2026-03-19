/**
 * Code execution tool — runs code in an isolated subprocess.
 * Supports JavaScript/TypeScript and Python.
 */

import { execFile } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolInput, ToolContext, ToolOutput } from "./registry.js";

async function executeCode(input: ToolInput, ctx: ToolContext): Promise<ToolOutput> {
  const language = (input.language as string) || "javascript";
  const code = input.code as string;
  const filename = input.filename as string || (language === "python" ? "script.py" : "script.js");

  if (!code) {
    return { success: false, result: "", error: "No code provided", durationMs: 0 };
  }

  // Security: prevent path traversal
  const normalized = path.normalize(filename);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return { success: false, result: "", error: "Invalid filename: path traversal blocked", durationMs: 0 };
  }

  // Write code to workspace
  await mkdir(ctx.workDir, { recursive: true });
  const filePath = path.resolve(ctx.workDir, normalized);
  const rel = path.relative(ctx.workDir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { success: false, result: "", error: "Invalid filename: outside workspace", durationMs: 0 };
  }
  await writeFile(filePath, code, "utf-8");

  ctx.onProgress("executing", `Running ${language} code...`);

  // Determine runtime
  let command: string;
  let args: string[];

  switch (language) {
    case "python":
    case "python3":
      command = "python3";
      args = [filePath];
      break;
    case "javascript":
    case "js":
    case "node":
      command = "node";
      args = [filePath];
      break;
    case "typescript":
    case "ts":
      command = "npx";
      args = ["tsx", filePath];
      break;
    default:
      return { success: false, result: "", error: `Unsupported language: ${language}`, durationMs: 0 };
  }

  return new Promise((resolve) => {
    const timeout = Math.min(ctx.timeoutMs, 60000); // max 60s for code execution
    const proc = execFile(command, args, {
      cwd: ctx.workDir,
      timeout,
      maxBuffer: ctx.maxOutputSize,
      env: {
        // Allowlist: only safe env vars — no secrets leak
        PATH: process.env.PATH || "",
        HOME: ctx.workDir,
        TMPDIR: ctx.workDir,
        TEMP: ctx.workDir,
        LANG: process.env.LANG || "en_US.UTF-8",
        NODE_ENV: "sandbox",
      },
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          success: false,
          result: stdout || "",
          error: stderr || err.message,
          durationMs: 0,
        });
      } else {
        resolve({
          success: true,
          result: stdout,
          durationMs: 0,
        });
      }
    });

    // Kill on timeout
    setTimeout(() => {
      try { proc.kill("SIGTERM"); } catch {}
    }, timeout);
  });
}

export const codeExecTool: ToolDefinition = {
  name: "code_exec",
  description: "Execute code in a sandboxed environment. Supports JavaScript, TypeScript, and Python. Returns stdout. Use this to run scripts, process data, or test logic.",
  parameters: {
    code: { type: "string", description: "The code to execute", required: true },
    language: { type: "string", description: "Programming language: javascript, typescript, or python" },
    filename: { type: "string", description: "Filename to save the code as" },
  },
  execute: executeCode,
};
