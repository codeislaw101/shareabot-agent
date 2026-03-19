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

  // Security: strict URL validation
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { success: false, result: "", error: "Invalid URL", durationMs: 0 };
  }

  // Protocol allowlist — only http and https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { success: false, result: "", error: `Blocked protocol: ${parsed.protocol}`, durationMs: 0 };
  }

  // Block internal/private IPs, loopback, link-local, metadata endpoints
  const host = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const blockedHosts = [
    "localhost", "127.0.0.1", "0.0.0.0", "::1", "0:0:0:0:0:0:0:1",
    "169.254.169.254", "metadata.google.internal",
  ];
  if (blockedHosts.includes(host)) {
    return { success: false, result: "", error: "Blocked: internal address", durationMs: 0 };
  }

  // Block private IP ranges (10.x, 172.16-31.x, 192.168.x, link-local)
  const ipMatch = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 169) {
      return { success: false, result: "", error: "Blocked: private IP range", durationMs: 0 };
    }
  }

  // Block IPv6 loopback variants
  if (host.startsWith("::") || host.startsWith("0:") || host.includes("ffff:127")) {
    return { success: false, result: "", error: "Blocked: IPv6 loopback", durationMs: 0 };
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
