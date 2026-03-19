/**
 * Web fetch tool — fetches content from URLs.
 * Used for research, API calls, data gathering.
 */

import type { ToolDefinition, ToolInput, ToolContext, ToolOutput } from "./registry.js";

async function executeFetch(input: ToolInput, ctx: ToolContext): Promise<ToolOutput> {
  const url = input.url as string;
  const method = (input.method as string) || "GET";
  const headers = (input.headers as Record<string, string>) || {};
  const body = input.body as string | undefined;

  if (!url) {
    return { success: false, result: "", error: "No URL provided", durationMs: 0 };
  }

  // Security: block internal/private IPs
  try {
    const parsed = new URL(url);
    const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "[::1]"];
    if (blockedHosts.includes(parsed.hostname)) {
      return { success: false, result: "", error: "Blocked: cannot fetch internal addresses", durationMs: 0 };
    }
  } catch {
    return { success: false, result: "", error: "Invalid URL", durationMs: 0 };
  }

  ctx.onProgress("executing", `Fetching ${url}...`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(ctx.timeoutMs, 30000));

    const res = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = res.headers.get("content-type") || "";
    let result: string;

    if (contentType.includes("json")) {
      result = JSON.stringify(await res.json(), null, 2);
    } else {
      result = await res.text();
    }

    // Truncate if too large
    if (result.length > ctx.maxOutputSize) {
      result = result.substring(0, ctx.maxOutputSize) + "\n[truncated]";
    }

    return {
      success: res.ok,
      result,
      error: res.ok ? undefined : `HTTP ${res.status}: ${res.statusText}`,
      durationMs: 0,
    };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Fetch failed",
      durationMs: 0,
    };
  }
}

export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch content from a URL. Supports GET, POST, PUT, DELETE. Returns the response body. Use for API calls, research, and data gathering.",
  parameters: {
    url: { type: "string", description: "The URL to fetch", required: true },
    method: { type: "string", description: "HTTP method (GET, POST, PUT, DELETE)" },
    headers: { type: "object", description: "Request headers" },
    body: { type: "string", description: "Request body (for POST/PUT)" },
  },
  execute: executeFetch,
};
