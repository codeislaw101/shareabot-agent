/**
 * 3D generation tool — generates 3D models from text/image prompts.
 * Uses a local Hunyuan3D-2 API server.
 */

import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolInput, ToolContext, ToolOutput } from "./registry.js";

const HUNYUAN_API = process.env.HUNYUAN3D_API || "http://localhost:8080";

async function executeGen3D(input: ToolInput, ctx: ToolContext): Promise<ToolOutput> {
  const prompt = input.prompt as string;
  const imageUrl = input.image_url as string | undefined;

  if (!prompt && !imageUrl) {
    return { success: false, result: "", error: "Either prompt or image_url is required", durationMs: 0 };
  }

  ctx.onProgress("executing", "Generating 3D model...");

  try {
    // Call local Hunyuan3D-2 API
    const body: Record<string, unknown> = {};
    if (prompt) body.prompt = prompt;
    if (imageUrl) body.image_url = imageUrl;
    body.output_format = "glb";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(ctx.timeoutMs, 300000)); // max 5 min for 3D gen

    const res = await fetch(`${HUNYUAN_API}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { success: false, result: "", error: `3D generation failed (${res.status}): ${errText}`, durationMs: 0 };
    }

    // Response should be the .glb binary or a JSON with a URL
    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/octet-stream") || contentType.includes("model/gltf-binary")) {
      // Binary .glb — save to workspace
      const buffer = Buffer.from(await res.arrayBuffer());
      const filename = "model.glb";
      const filePath = path.join(ctx.workDir, filename);
      await writeFile(filePath, buffer);

      return {
        success: true,
        result: `3D model generated: ${filename} (${(buffer.length / 1024).toFixed(0)} KB)`,
        artifacts: [{
          name: filename,
          content: buffer.toString("base64"),
          mimeType: "model/gltf-binary",
        }],
        durationMs: 0,
      };
    }

    // JSON response with URL or base64
    const data = await res.json();
    if (data.model_url) {
      return {
        success: true,
        result: `3D model generated: ${data.model_url}`,
        artifacts: [{
          name: "model.glb",
          content: data.model_url,
          mimeType: "model/gltf-binary",
        }],
        durationMs: 0,
      };
    }
    if (data.model_base64) {
      const filename = "model.glb";
      const filePath = path.join(ctx.workDir, filename);
      await writeFile(filePath, Buffer.from(data.model_base64, "base64"));
      return {
        success: true,
        result: `3D model generated: ${filename}`,
        artifacts: [{
          name: filename,
          content: data.model_base64,
          mimeType: "model/gltf-binary",
        }],
        durationMs: 0,
      };
    }

    return { success: false, result: "", error: "Unexpected response format from 3D API", durationMs: 0 };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "3D generation failed",
      durationMs: 0,
    };
  }
}

export const gen3DTool: ToolDefinition = {
  name: "gen_3d",
  description: "Generate a 3D model from a text description or image. Returns a .glb file. Use for creating 3D objects, characters, scenes, or product renders.",
  parameters: {
    prompt: { type: "string", description: "Text description of the 3D object to generate" },
    image_url: { type: "string", description: "URL of a reference image to convert to 3D" },
  },
  execute: executeGen3D,
};
