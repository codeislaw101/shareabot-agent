/**
 * Tool loader — registers all enabled tools.
 */

import { registry } from "./registry.js";
import { codeExecTool } from "./code-exec.js";
import { webFetchTool } from "./web-fetch.js";
import { fileWriteTool, fileReadTool } from "./file-write.js";
import { gen3DTool } from "./gen-3d.js";
import type { AgentConfig } from "../config/schema.js";

export function loadTools(config: AgentConfig): void {
  const tools = config.tools;

  if (tools["code-exec"]?.enabled !== false) {
    registry.register(codeExecTool);
  }

  if (tools["web-fetch"]?.enabled !== false) {
    registry.register(webFetchTool);
  }

  if (tools["file-write"]?.enabled !== false) {
    registry.register(fileWriteTool);
    registry.register(fileReadTool);
  }

  if (tools["gen-3d"]?.enabled) {
    registry.register(gen3DTool);
  }

  registry.setDailyLimit(config.limits.dailyToolBudget);

  // Auto-derive skills from enabled tools
  const TOOL_SKILL_MAP: Record<string, string> = {
    code_exec: "code-execution",
    web_fetch: "web-research",
    file_write: "file-generation",
    gen_3d: "3d-generation",
    gen_image: "image-generation",
    gen_video: "video-generation",
    gen_audio: "audio-generation",
  };

  for (const toolName of registry.listNames()) {
    const skill = TOOL_SKILL_MAP[toolName];
    if (skill && !config.agent.skills.includes(skill)) {
      config.agent.skills.push(skill);
    }
  }

  console.log(`[tools] loaded ${registry.listNames().length} tools: ${registry.listNames().join(", ")}`);
}

export { registry };
