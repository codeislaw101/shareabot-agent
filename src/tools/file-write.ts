/**
 * File write tool — writes files to the task workspace.
 * Used to produce artifacts (code files, configs, etc).
 */

import { writeFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolInput, ToolContext, ToolOutput } from "./registry.js";

async function executeFileWrite(input: ToolInput, ctx: ToolContext): Promise<ToolOutput> {
  const filename = input.filename as string;
  const content = input.content as string;

  if (!filename || !content) {
    return { success: false, result: "", error: "filename and content are required", durationMs: 0 };
  }

  // Security: prevent path traversal
  const normalized = path.normalize(filename);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return { success: false, result: "", error: "Invalid filename: path traversal blocked", durationMs: 0 };
  }

  const filePath = path.resolve(ctx.workDir, normalized);
  const rel = path.relative(ctx.workDir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { success: false, result: "", error: "Invalid filename: outside workspace", durationMs: 0 };
  }

  ctx.onProgress("writing", `Writing ${filename}...`);

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
    return {
      success: true,
      result: `Written ${content.length} bytes to ${filename}`,
      artifacts: [{
        name: filename,
        content,
        mimeType: guessMimeType(filename),
      }],
      durationMs: 0,
    };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Write failed",
      durationMs: 0,
    };
  }
}

async function executeFileRead(input: ToolInput, ctx: ToolContext): Promise<ToolOutput> {
  const filename = input.filename as string;
  if (!filename) {
    return { success: false, result: "", error: "filename is required", durationMs: 0 };
  }

  const normalized = path.normalize(filename);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return { success: false, result: "", error: "Invalid filename", durationMs: 0 };
  }

  const filePath = path.resolve(ctx.workDir, normalized);
  const rel = path.relative(ctx.workDir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { success: false, result: "", error: "Outside workspace", durationMs: 0 };
  }

  try {
    const content = await readFile(filePath, "utf-8");
    return { success: true, result: content, durationMs: 0 };
  } catch {
    return { success: false, result: "", error: `File not found: ${filename}`, durationMs: 0 };
  }
}

function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".ts": "application/typescript", ".json": "application/json", ".md": "text/markdown",
    ".py": "text/x-python", ".txt": "text/plain", ".svg": "image/svg+xml",
    ".yaml": "application/x-yaml", ".yml": "application/x-yaml",
  };
  return map[ext] || "text/plain";
}

export const fileWriteTool: ToolDefinition = {
  name: "file_write",
  description: "Write a file to the task workspace. Use to create source code, configs, HTML pages, or any text file. Returns the file path and size.",
  parameters: {
    filename: { type: "string", description: "File path relative to workspace (e.g. 'index.html', 'src/app.js')", required: true },
    content: { type: "string", description: "File content", required: true },
  },
  execute: executeFileWrite,
};

export const fileReadTool: ToolDefinition = {
  name: "file_read",
  description: "Read a file from the task workspace. Returns the file content.",
  parameters: {
    filename: { type: "string", description: "File path relative to workspace", required: true },
  },
  execute: executeFileRead,
};
