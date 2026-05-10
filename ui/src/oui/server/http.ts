import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { OuiAdapterRegistry } from "../adapters/registry.ts";
import { evaluateAdapterExecutionPolicy } from "../security/adapter-policy.ts";
import { createDefaultOuiFeatureFlags } from "../shared/feature-flags.ts";
import type { OuiProductStore, OuiTaskReviewState } from "../shared/product-types.ts";
import type { OuiEnqueueRunInput, OuiFeatureFlags, OuiRunStore } from "../shared/types.ts";
import { OuiCompanyService } from "./company-service.ts";

export type OuiHttpServerOptions = {
  store: OuiRunStore;
  productStore?: OuiProductStore;
  companyService?: OuiCompanyService;
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

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function requireProductStore(productStore: OuiProductStore | undefined, res: ServerResponse) {
  if (!productStore) {
    sendJson(res, 404, { error: "oui_product_store_unavailable" });
    return null;
  }
  return productStore;
}

function requireCompanyService(companyService: OuiCompanyService | null, res: ServerResponse) {
  if (!companyService) {
    sendJson(res, 404, { error: "oui_company_service_unavailable" });
    return null;
  }
  return companyService;
}

export function createOuiHttpServer(options: OuiHttpServerOptions): OuiHttpServer {
  const flags = createDefaultOuiFeatureFlags(options.flags);
  const companyService =
    options.companyService ??
    (options.productStore
      ? new OuiCompanyService({
          productStore: options.productStore,
          runStore: options.store,
          registry: options.registry,
          flags,
          adapterAllowlist: options.adapterAllowlist,
        })
      : null);
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

      if (req.method === "GET" && url.pathname === "/api/oui/adapters/previews") {
        const service = requireCompanyService(companyService, res);
        if (!service) {
          return;
        }
        sendJson(res, 200, { adapters: service.listEmployeeAdapterPreviews() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/oui/companies/default") {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        const leader = asObject(body.openclawLeader);
        const result = await productStore.ensureDefaultCompany({
          companyId: typeof body.companyId === "string" ? body.companyId : undefined,
          name: typeof body.name === "string" ? body.name : undefined,
          openclawLeader: body.openclawLeader
            ? {
                id: typeof leader.id === "string" ? leader.id : undefined,
                label: typeof leader.label === "string" ? leader.label : undefined,
                openclawAgentId:
                  typeof leader.openclawAgentId === "string" ? leader.openclawAgentId : null,
                adapterId: typeof leader.adapterId === "string" ? leader.adapterId : undefined,
                modelRef: typeof leader.modelRef === "string" ? leader.modelRef : null,
              }
            : undefined,
        });
        sendJson(res, 200, result);
        return;
      }

      const companyMatch = /^\/api\/oui\/companies\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && companyMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(companyMatch[1]);
        const company = await productStore.getCompany(companyId);
        sendJson(
          res,
          company ? 200 : 404,
          company
            ? { company, agents: await productStore.listAgents(companyId) }
            : { error: "not_found" },
        );
        return;
      }

      const companyAgentsMatch = /^\/api\/oui\/companies\/([^/]+)\/agents$/.exec(url.pathname);
      if (companyAgentsMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(companyAgentsMatch[1]);
        if (req.method === "GET") {
          sendJson(res, 200, { agents: await productStore.listAgents(companyId) });
          return;
        }
        if (req.method === "POST") {
          const body = asObject(await readRequestBody(req));
          const agent = await productStore.createAgent({
            id: typeof body.id === "string" ? body.id : undefined,
            companyId,
            adapterId: typeof body.adapterId === "string" ? body.adapterId : "",
            adapterKind:
              typeof body.adapterKind === "string" ? (body.adapterKind as never) : "fake",
            label: typeof body.label === "string" ? body.label : "Agent",
            reportsToAgentId:
              typeof body.reportsToAgentId === "string" ? body.reportsToAgentId : null,
            openclawAgentId: typeof body.openclawAgentId === "string" ? body.openclawAgentId : null,
            modelRef: typeof body.modelRef === "string" ? body.modelRef : null,
          });
          sendJson(res, 201, { agent });
          return;
        }
      }

      const companyTasksMatch = /^\/api\/oui\/companies\/([^/]+)\/tasks$/.exec(url.pathname);
      if (req.method === "POST" && companyTasksMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        if (typeof body.title !== "string") {
          sendJson(res, 400, { error: "invalid_task_input" });
          return;
        }
        const task = await productStore.createTask({
          id: typeof body.id === "string" ? body.id : undefined,
          companyId: decodeURIComponent(companyTasksMatch[1]),
          title: body.title,
          description: typeof body.description === "string" ? body.description : null,
          assignedAgentId: typeof body.assignedAgentId === "string" ? body.assignedAgentId : null,
          priority: typeof body.priority === "number" ? body.priority : undefined,
        });
        sendJson(res, 201, { task });
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

      const taskMatch = /^\/api\/oui\/tasks\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && taskMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const task = await productStore.getTask(decodeURIComponent(taskMatch[1]));
        sendJson(res, task ? 200 : 404, task ? { task } : { error: "not_found" });
        return;
      }

      const assignMatch = /^\/api\/oui\/tasks\/([^/]+)\/assign$/.exec(url.pathname);
      if (req.method === "POST" && assignMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        if (typeof body.agentId !== "string") {
          sendJson(res, 400, { error: "invalid_assignment_input" });
          return;
        }
        const task = await productStore.assignTask(
          decodeURIComponent(assignMatch[1]),
          body.agentId,
        );
        sendJson(res, 200, { task });
        return;
      }

      const dependencyMatch = /^\/api\/oui\/tasks\/([^/]+)\/dependencies$/.exec(url.pathname);
      if (req.method === "POST" && dependencyMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        if (typeof body.dependsOnTaskId !== "string") {
          sendJson(res, 400, { error: "invalid_dependency_input" });
          return;
        }
        const dependency = await productStore.addTaskDependency(
          decodeURIComponent(dependencyMatch[1]),
          body.dependsOnTaskId,
        );
        sendJson(res, 201, { dependency });
        return;
      }

      const readinessMatch = /^\/api\/oui\/tasks\/([^/]+)\/readiness$/.exec(url.pathname);
      if (req.method === "GET" && readinessMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const readiness = await productStore.getTaskReadiness(
          decodeURIComponent(readinessMatch[1]),
        );
        sendJson(res, 200, { readiness });
        return;
      }

      const reviewMatch = /^\/api\/oui\/tasks\/([^/]+)\/review$/.exec(url.pathname);
      if (req.method === "POST" && reviewMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        if (typeof body.reviewState !== "string") {
          sendJson(res, 400, { error: "invalid_review_input" });
          return;
        }
        const task = await productStore.transitionTaskReview(
          decodeURIComponent(reviewMatch[1]),
          body.reviewState as OuiTaskReviewState,
        );
        sendJson(res, 200, { task });
        return;
      }

      const taskRunMatch = /^\/api\/oui\/tasks\/([^/]+)\/runs$/.exec(url.pathname);
      if (req.method === "POST" && taskRunMatch) {
        const service = requireCompanyService(companyService, res);
        if (!service) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        const result = await service.queueTaskRun({
          taskId: decodeURIComponent(taskRunMatch[1]),
          runId: typeof body.runId === "string" ? body.runId : undefined,
          message: typeof body.message === "string" ? body.message : undefined,
          sessionKey: typeof body.sessionKey === "string" ? body.sessionKey : null,
          adapterId: typeof body.adapterId === "string" ? body.adapterId : undefined,
          maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : undefined,
        });
        sendJson(res, result.status === "queued" ? 202 : 409, result);
        return;
      }

      const timelineMatch = /^\/api\/oui\/tasks\/([^/]+)\/timeline$/.exec(url.pathname);
      if (req.method === "GET" && timelineMatch) {
        const service = requireCompanyService(companyService, res);
        if (!service) {
          return;
        }
        sendJson(res, 200, await service.getTaskTimeline(decodeURIComponent(timelineMatch[1])));
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
