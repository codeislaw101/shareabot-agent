import { describe, it, expect } from "vitest";
import { webFetchTool } from "./web-fetch.js";
import type { ToolContext } from "./registry.js";

const ctx: ToolContext = {
  taskId: 1,
  workDir: "/tmp/test",
  timeoutMs: 5000,
  maxOutputSize: 1024 * 1024,
  onProgress: () => {},
};

describe("web-fetch tool", () => {
  // SECURITY: SSRF protection
  it("blocks localhost", async () => {
    const result = await webFetchTool.execute({ url: "http://localhost:3000" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks 127.0.0.1", async () => {
    const result = await webFetchTool.execute({ url: "http://127.0.0.1/" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks 0.0.0.0", async () => {
    const result = await webFetchTool.execute({ url: "http://0.0.0.0/" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks ::1 (IPv6 loopback)", async () => {
    const result = await webFetchTool.execute({ url: "http://[::1]/" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks AWS metadata endpoint", async () => {
    const result = await webFetchTool.execute({ url: "http://169.254.169.254/latest/meta-data/" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("blocks private IP 10.x.x.x", async () => {
    const result = await webFetchTool.execute({ url: "http://10.0.0.1/" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("private IP");
  });

  it("blocks private IP 192.168.x.x", async () => {
    const result = await webFetchTool.execute({ url: "http://192.168.1.1/" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("private IP");
  });

  it("blocks private IP 172.16.x.x", async () => {
    const result = await webFetchTool.execute({ url: "http://172.16.0.1/" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("private IP");
  });

  it("blocks file:// protocol", async () => {
    const result = await webFetchTool.execute({ url: "file:///etc/passwd" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked protocol");
  });

  it("blocks ftp:// protocol", async () => {
    const result = await webFetchTool.execute({ url: "ftp://evil.com/file" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked protocol");
  });

  it("rejects invalid URL", async () => {
    const result = await webFetchTool.execute({ url: "not a url" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid URL");
  });

  it("rejects empty URL", async () => {
    const result = await webFetchTool.execute({ url: "" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No URL");
  });

  // Functional
  it("fetches a real URL", async () => {
    const result = await webFetchTool.execute({ url: "https://httpbin.org/get" }, ctx);
    expect(result.success).toBe(true);
    expect(result.result).toContain("httpbin.org");
  }, 10000);
});
