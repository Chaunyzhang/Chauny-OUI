import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { OuiAdapterRegistry } from "../adapters/registry.ts";
import { evaluateAdapterExecutionPolicy } from "../security/adapter-policy.ts";
import { createDefaultOuiFeatureFlags } from "../shared/feature-flags.ts";
import type { OuiEnqueueRunInput, OuiFeatureFlags, OuiRunStore } from "../shared/types.ts";

export type OuiHttpServerOptions = {
  store: OuiRunStore;
  registry: OuiAdapterRegistry;
  flags?: Partial<OuiFeatureFlags>;
  authToken?: string;
  adapterAllowlist?: ReadonlySet<string> | string[];
};

export type OuiHttpServer = {
  server: Server;
  flags: OuiFeatureFlags;
  listen(port?: number, host?: string): Promise<{ port: number; host: string }>;
  close(): Promise<void>;
};

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function isLoopbackAddress(address: string | undefined): boolean {
  return !address || address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isAuthorized(req: IncomingMessage, authToken: string | undefined): boolean {
  if (!authToken) {
    return isLoopbackAddress(req.socket.remoteAddress);
  }
  return req.headers.authorization === `Bearer ${authToken}`;
}

function readRequestBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function asRunInput(body: unknown): OuiEnqueueRunInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.adapterId !== "string" ||
    typeof record.adapterKind !== "string" ||
    !record.input ||
    typeof record.input !== "object" ||
    Array.isArray(record.input)
  ) {
    return null;
  }
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    adapterId: record.adapterId,
    adapterKind: record.adapterKind as OuiEnqueueRunInput["adapterKind"],
    agentId: typeof record.agentId === "string" ? record.agentId : null,
    sessionKey: typeof record.sessionKey === "string" ? record.sessionKey : null,
    input: record.input as Record<string, unknown>,
    maxAttempts: typeof record.maxAttempts === "number" ? record.maxAttempts : undefined,
  };
}

export function createOuiHttpServer(options: OuiHttpServerOptions): OuiHttpServer {
  const flags = createDefaultOuiFeatureFlags(options.flags);
  const server = createServer(async (req, res) => {
    try {
      if (!isAuthorized(req, options.authToken)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/oui/health") {
        sendJson(res, 200, {
          ok: flags.ouiServerEnabled,
          service: "oui",
          queueEnabled: flags.ouiRunQueueEnabled,
          openclawRunsEnabled: flags.ouiOpenClawAdapterRunsEnabled,
          externalAdaptersEnabled: flags.ouiExternalAdaptersEnabled,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/oui/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(`event: health\ndata: ${JSON.stringify({ ok: flags.ouiServerEnabled })}\n\n`);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/oui/runs") {
        const input = asRunInput(await readRequestBody(req));
        if (!input) {
          sendJson(res, 400, { error: "invalid_run_input" });
          return;
        }
        const adapter = options.registry.require(input.adapterId);
        const policy = evaluateAdapterExecutionPolicy({
          adapter,
          flags,
          allowlist: options.adapterAllowlist,
        });
        if (!policy.allowed) {
          sendJson(res, 403, { error: policy.code, message: policy.message });
          return;
        }
        const run = await options.store.enqueueRun(input);
        sendJson(res, 202, { run });
        return;
      }

      const runMatch = /^\/api\/oui\/runs\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && runMatch) {
        const run = await options.store.getRun(decodeURIComponent(runMatch[1]));
        sendJson(res, run ? 200 : 404, run ? { run } : { error: "not_found" });
        return;
      }

      const cancelMatch = /^\/api\/oui\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
      if (req.method === "POST" && cancelMatch) {
        const run = await options.store.requestCancel({
          runId: decodeURIComponent(cancelMatch[1]),
        });
        sendJson(res, run ? 202 : 404, run ? { run } : { error: "not_found" });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "unknown_error" });
    }
  });

  return {
    server,
    flags,
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address() as AddressInfo;
          resolve({ port: address.port, host: address.address });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
