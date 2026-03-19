/**
 * Agent worker — the core execution loop.
 * Receives a task → plans with LLM → executes tools → delivers result.
 *
 * Uses Claude's tool_use capability for agentic execution:
 * 1. Send task description + available tools to Claude
 * 2. Claude decides which tools to call
 * 3. We execute those tools and return results
 * 4. Claude continues until it has a final answer
 * 5. We package the result as a deliverable
 */

import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import { registry, type ToolOutput } from "../tools/registry.js";
import type { AgentConfig } from "../config/schema.js";

export interface TaskData {
  taskId: number;
  description: string;
  budget: number;
  files: string[];
  context: Array<{ type: string; name: string; content: string }>;
  classification: { skill: string; complexity: string };
  skillKnowledge: string;
  workspaceId: string | null;
}

export interface Deliverable {
  format: "html" | "code" | "document" | "data" | "mixed";
  summary: string;
  content: string;
  artifacts: Array<{ name: string; content: string; mimeType: string }>;
  tokensUsed: number;
  toolCalls: number;
  toolsUsed: string[];
  executionTime: number;     // ms
  model: string;
}

interface ProgressCallback {
  (stage: string, detail: string): void;
}

export async function executeTask(
  task: TaskData,
  config: AgentConfig,
  onProgress: ProgressCallback,
): Promise<Deliverable> {
  const client = new Anthropic({ apiKey: config.agent.apiKey });
  const model = config.agent.model;

  // Create isolated workspace for this task
  const workDir = path.join(os.tmpdir(), "shareabot-tasks", String(task.taskId));
  await mkdir(workDir, { recursive: true });

  const toolDefs = registry.toClaudeTools();
  const allArtifacts: Array<{ name: string; content: string; mimeType: string }> = [];
  let totalTokens = 0;
  let totalToolCalls = 0;
  const toolsUsedSet = new Set<string>();
  const startTime = Date.now();

  // Build system prompt
  const systemPrompt = `You are an AI agent on the Share a Bot platform. You have been assigned a task by a client. Your job is to complete it thoroughly using the tools available to you.

## Your tools
${toolDefs.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

## Rules
- Use tools to accomplish real work — write files, execute code, fetch data.
- For web apps: use file_write to create complete HTML/CSS/JS files, then use code_exec to validate if needed.
- For code tasks: write the code with file_write, test it with code_exec, fix any errors.
- For research: use web_fetch to gather information from real sources.
- Always produce a concrete deliverable — files, code, or structured output. Never just describe what you would do.
- When you're done, summarize what you built and list the files you created.

${task.skillKnowledge ? `## Skill knowledge\n${task.skillKnowledge}` : ""}
${task.context.length > 0 ? `## Context files\n${task.context.map((c) => `### ${c.name}\n${c.content}`).join("\n\n")}` : ""}`;

  // Conversation loop
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: task.description },
  ];

  onProgress("thinking", "Analyzing task...");

  const MAX_TURNS = 20; // prevent infinite loops

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: systemPrompt,
      tools: toolDefs as any,
      messages,
    });

    totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    // Check if Claude wants to use tools
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls — Claude is done. Extract final answer.
      const finalText = textBlocks.map((b) => b.text).join("\n");

      // Determine output format
      const format = detectFormat(finalText, allArtifacts);

      // If we have HTML artifacts, use the first one as content
      const htmlArtifact = allArtifacts.find((a) => a.mimeType === "text/html");
      const content = htmlArtifact ? htmlArtifact.content : finalText;

      return {
        format,
        summary: finalText.substring(0, 200),
        content,
        artifacts: allArtifacts,
        tokensUsed: totalTokens,
        toolCalls: totalToolCalls,
        toolsUsed: Array.from(toolsUsedSet),
        executionTime: Date.now() - startTime,
        model,
      };
    }

    // Execute tool calls
    totalToolCalls += toolUseBlocks.length;
    toolUseBlocks.forEach((t) => toolsUsedSet.add(t.name));
    onProgress("executing", `Using ${toolUseBlocks.length} tool${toolUseBlocks.length > 1 ? "s" : ""}...`);

    // Add assistant message with tool use
    messages.push({ role: "assistant", content: response.content });

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const toolName = toolUse.name;
      const toolInput = toolUse.input as Record<string, unknown>;

      onProgress("executing", `Running ${toolName}...`);

      const result: ToolOutput = await registry.execute(toolName, toolInput, {
        taskId: task.taskId,
        workDir,
        timeoutMs: config.security.maxTimeSeconds * 1000,
        maxOutputSize: config.security.maxOutputSizeMb * 1024 * 1024,
        onProgress,
      });

      // Collect artifacts
      if (result.artifacts) {
        allArtifacts.push(...result.artifacts);
      }

      // Truncate large results for the LLM
      let resultText = result.success
        ? result.result
        : `ERROR: ${result.error}`;

      if (resultText.length > 10000) {
        resultText = resultText.substring(0, 10000) + "\n[output truncated]";
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: resultText,
        is_error: !result.success,
      });
    }

    // Add tool results
    messages.push({ role: "user", content: toolResults });

    onProgress("thinking", "Processing results...");
  }

  // Hit max turns — return what we have
  return {
    format: allArtifacts.length > 0 ? detectFormat("", allArtifacts) : "document",
    summary: "Task completed (max iterations reached)",
    content: allArtifacts.find((a) => a.mimeType === "text/html")?.content || "Max iterations reached. Check artifacts.",
    artifacts: allArtifacts,
    tokensUsed: totalTokens,
    toolCalls: totalToolCalls,
    toolsUsed: Array.from(toolsUsedSet),
    executionTime: Date.now() - startTime,
    model,
  };
}

function detectFormat(text: string, artifacts: Array<{ mimeType: string }>): Deliverable["format"] {
  if (artifacts.some((a) => a.mimeType === "text/html")) return "html";
  if (artifacts.some((a) => a.mimeType.startsWith("application/"))) return "code";
  if (text.includes("```") || artifacts.some((a) => a.mimeType.includes("python") || a.mimeType.includes("javascript"))) return "code";
  return "document";
}
