import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { OuiAdapterRegistry } from "../adapters/registry.ts";
import { evaluateAdapterExecutionPolicy } from "../security/adapter-policy.ts";
import { createDefaultOuiFeatureFlags } from "../shared/feature-flags.ts";
import type {
  OuiAgentRecord,
  OuiCompanyDetail,
  OuiCompanyRecord,
  OuiCompanySummary,
  OuiControlRoomNode,
  OuiControlRoomReadModel,
  OuiConversationRecord,
  OuiInboxResolutionAction,
  OuiInboxItemStatus,
  OuiInboxItemType,
  OuiMessageRecord,
  OuiProductStore,
  OuiRunbookKind,
  OuiRunbookRecord,
  OuiRunbookSourceType,
  OuiRunbookVersionRecord,
  OuiTaskReviewState,
  OuiWorkNodeRecord,
} from "../shared/product-types.ts";
import type {
  OuiEnqueueRunInput,
  OuiFeatureFlags,
  OuiJsonObject,
  OuiRunStore,
} from "../shared/types.ts";
import { OuiCeoService } from "./ceo-service.ts";
import { OuiCompanyService } from "./company-service.ts";

export type OuiHttpServerOptions = {
  store: OuiRunStore;
  productStore?: OuiProductStore;
  companyService?: OuiCompanyService;
  ceoService?: OuiCeoService;
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

export type OuiHttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export type OuiHttpRuntime = {
  flags: OuiFeatureFlags;
  handle: OuiHttpRequestHandler;
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

function asJsonObjectArray(value: unknown): OuiJsonObject[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is OuiJsonObject =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const RUNBOOK_SOURCE_TYPES = new Set<OuiRunbookSourceType>([
  "ceo_chat",
  "meeting_minutes",
  "imported_markdown",
  "manual",
]);

const RUNBOOK_KINDS = new Set<OuiRunbookKind>(["project", "routine"]);

const INBOX_ITEM_TYPES = new Set<OuiInboxItemType>([
  "choice",
  "approval",
  "revision",
  "blocked",
  "exception",
  "report_ack",
]);

const INBOX_ITEM_STATUSES = new Set<OuiInboxItemStatus>([
  "open",
  "resolved",
  "rejected",
  "stopped",
]);

const INBOX_RESOLUTION_ACTIONS = new Set<OuiInboxResolutionAction>([
  "approve",
  "reject",
  "stop",
  "reply",
]);

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

async function listCompanySummaries(productStore: OuiProductStore): Promise<OuiCompanySummary[]> {
  const companies = await productStore.listCompanies();
  const summaries: OuiCompanySummary[] = [];
  for (const company of companies) {
    const agents = await productStore.listAgents(company.id);
    const tasks = await productStore.listTasks(company.id);
    const runbooks = await productStore.listRunbooks(company.id);
    const activeRunbook =
      runbooks.find((runbook) => runbook.activeVersionId === company.currentRunbookVersionId) ??
      runbooks.find((runbook) => runbook.status === "active" || runbook.status === "approved") ??
      runbooks[0] ??
      null;
    summaries.push({
      company,
      ceo:
        agents.find((agent) => agent.id === company.ceoAgentId) ??
        agents.find((agent) => agent.id === company.defaultLeaderAgentId) ??
        agents.find((agent) => agent.isLeader) ??
        null,
      taskCount: tasks.length,
      openInboxCount: (await productStore.listInboxItems(company.id, "open")).length,
      activeRunbook,
      latestActivityAt: company.updatedAt,
    });
  }
  return summaries;
}

function resolveCompanyCeo(
  company: OuiCompanyRecord,
  agents: OuiAgentRecord[],
): OuiAgentRecord | null {
  return (
    agents.find((agent) => agent.id === company.ceoAgentId) ??
    agents.find((agent) => agent.id === company.defaultLeaderAgentId) ??
    agents.find((agent) => agent.isLeader) ??
    null
  );
}

function resolveActiveRunbook(
  company: OuiCompanyRecord,
  runbooks: OuiRunbookRecord[],
  activeVersion: OuiRunbookVersionRecord | null,
): OuiRunbookRecord | null {
  return (
    runbooks.find((runbook) => activeVersion && runbook.activeVersionId === activeVersion.id) ??
    runbooks.find((runbook) => runbook.activeVersionId === company.currentRunbookVersionId) ??
    runbooks.find((runbook) => runbook.status === "active" || runbook.status === "approved") ??
    runbooks[0] ??
    null
  );
}

function stageLabel(stage: OuiJsonObject, index: number): string {
  for (const key of ["title", "name", "id"]) {
    const value = stage[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return `Stage ${index + 1}`;
}

function stageAssigneeLabel(stage: OuiJsonObject, agents: OuiAgentRecord[]): string | null {
  for (const key of ["agentId", "assigneeAgentId", "assignee", "role"]) {
    const value = stage[key];
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    return agents.find((agent) => agent.id === value)?.label ?? value.trim();
  }
  return null;
}

function stageSummary(stage: OuiJsonObject): string | null {
  for (const key of ["summary", "output", "description"]) {
    const value = stage[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function workNodeStatusToControlNodeStatus(
  status: OuiWorkNodeRecord["status"],
): OuiControlRoomNode["status"] {
  switch (status) {
    case "ready":
    case "running":
      return "current";
    case "waiting_user":
      return "waiting_user";
    case "blocked":
      return "blocked";
    case "done":
    case "skipped":
      return "done";
    case "pending":
      return "queued";
  }
}

function workNodeAssigneeLabel(
  workNode: OuiWorkNodeRecord,
  agents: OuiAgentRecord[],
): string | null {
  return workNode.assignedAgentId
    ? (agents.find((agent) => agent.id === workNode.assignedAgentId)?.label ??
        workNode.assignedAgentId)
    : null;
}

function buildControlRoomNodes(
  company: OuiCompanyRecord,
  agents: OuiAgentRecord[],
  activeVersion: OuiRunbookVersionRecord | null,
  workNodes: OuiWorkNodeRecord[],
): OuiControlRoomNode[] {
  if (workNodes.length) {
    return workNodes
      .toSorted((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
      .map((workNode) => ({
        id: workNode.id,
        title: workNode.title,
        status: workNodeStatusToControlNodeStatus(workNode.status),
        kind: "stage",
        assigneeLabel: workNodeAssigneeLabel(workNode, agents),
        summary: workNode.summary,
        sourceStatus: workNode.status,
        updatedAt: workNode.updatedAt,
      }));
  }
  if (!activeVersion) {
    return [];
  }
  const currentIndex = company.currentStage
    ? activeVersion.stages.findIndex(
        (stage, index) =>
          stageLabel(stage, index).toLowerCase() === company.currentStage?.toLowerCase(),
      )
    : 0;
  const effectiveCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  return activeVersion.stages.map((stage, index) => {
    const title = stageLabel(stage, index);
    const status: OuiControlRoomNode["status"] =
      index === effectiveCurrentIndex
        ? "current"
        : index < effectiveCurrentIndex
          ? "done"
          : "queued";
    return {
      id:
        typeof stage.id === "string" && stage.id.trim()
          ? stage.id.trim()
          : `${activeVersion.id}:stage:${index + 1}`,
      title,
      status,
      kind: "stage",
      assigneeLabel: stageAssigneeLabel(stage, agents),
      summary: stageSummary(stage),
      updatedAt: activeVersion.updatedAt,
    };
  });
}

function newestTimestamp(values: string[]): string {
  return values
    .filter(Boolean)
    .toSorted((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

function buildControlRoomReadModel(input: {
  company: OuiCompanyRecord;
  agents: OuiAgentRecord[];
  tasks: Awaited<ReturnType<OuiProductStore["listTasks"]>>;
  runbooks: OuiRunbookRecord[];
  activeVersion: OuiRunbookVersionRecord | null;
  workNodes: OuiWorkNodeRecord[];
  inboxItems: Awaited<ReturnType<OuiProductStore["listInboxItems"]>>;
}): OuiControlRoomReadModel {
  const { company, agents, tasks, runbooks, activeVersion, workNodes, inboxItems } = input;
  const openInboxItems = inboxItems.filter((item) => item.status === "open");
  const activeRunbook = resolveActiveRunbook(company, runbooks, activeVersion);
  const nodes = buildControlRoomNodes(company, agents, activeVersion, workNodes);
  const nextStep = openInboxItems.length
    ? "Review the open inbox items before the company continues."
    : workNodes.some((node) => node.status === "ready" || node.status === "running")
      ? "Runbook is active. First work node is ready."
      : activeVersion
        ? "Confirm this runbook to create work nodes."
        : "Talk to the CEO and approve a runbook before the company starts work.";
  return {
    companyId: company.id,
    status: company.status,
    ceo: resolveCompanyCeo(company, agents),
    currentObjective: company.currentObjective,
    currentStage: company.currentStage,
    activeRunbook,
    activeRunbookVersion: activeVersion,
    openInboxItems,
    nodes,
    nextStep:
      company.status === "running" && !openInboxItems.length && !nodes.length
        ? "Watch current stage and wait for the next CEO report."
        : nextStep,
    updatedAt: newestTimestamp([
      company.updatedAt,
      ...tasks.map((task) => task.updatedAt),
      ...runbooks.map((runbook) => runbook.updatedAt),
      ...workNodes.map((node) => node.updatedAt),
      ...inboxItems.map((item) => item.updatedAt),
      ...(activeVersion ? [activeVersion.updatedAt] : []),
    ]),
  };
}

async function getCompanyDetail(
  productStore: OuiProductStore,
  companyId: string,
): Promise<OuiCompanyDetail | null> {
  const company = await productStore.getCompany(companyId);
  if (!company) {
    return null;
  }
  const [agents, ceoConversations, tasks, runbooks, runbookVersions, workNodes, inboxItems] =
    await Promise.all([
      productStore.listAgents(companyId),
      productStore.listCeoConversations(companyId),
      productStore.listTasks(companyId),
      productStore.listRunbooks(companyId),
      productStore.listRunbookVersions(companyId),
      productStore.listWorkNodes(companyId),
      productStore.listInboxItems(companyId),
    ]);
  const ceoMessages = ceoConversations[0]
    ? await productStore.listConversationMessages(ceoConversations[0].id, 50)
    : [];
  const activeRunbookVersion = company.currentRunbookVersionId
    ? (runbookVersions.find((version) => version.id === company.currentRunbookVersionId) ??
      (await productStore.getRunbookVersion(company.currentRunbookVersionId)))
    : (runbookVersions.find((version) => version.status === "active") ?? null);
  const activeWorkNodes = activeRunbookVersion
    ? workNodes.filter((node) => node.runbookVersionId === activeRunbookVersion.id)
    : [];
  return {
    company,
    agents,
    ceoConversations,
    ceoMessages,
    tasks,
    runbooks,
    runbookVersions,
    activeRunbookVersion,
    workNodes,
    inboxItems,
    controlRoom: buildControlRoomReadModel({
      company,
      agents,
      tasks,
      runbooks,
      activeVersion: activeRunbookVersion,
      workNodes: activeWorkNodes,
      inboxItems,
    }),
  };
}

export function createOuiHttpRuntime(options: OuiHttpServerOptions): OuiHttpRuntime {
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
  const ceoService =
    options.ceoService ?? (options.productStore ? new OuiCeoService(options.productStore) : null);
  const handle: OuiHttpRequestHandler = async (req, res) => {
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

      if (url.pathname === "/api/oui/companies") {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        if (req.method === "GET") {
          const summaries = await listCompanySummaries(productStore);
          sendJson(res, 200, {
            companies: summaries.map((summary) => summary.company),
            summaries,
          });
          return;
        }
        if (req.method === "POST") {
          const body = asObject(await readRequestBody(req));
          const leader = asObject(body.openclawLeader);
          if (
            typeof body.name !== "string" ||
            typeof leader.label !== "string" ||
            typeof leader.openclawAgentId !== "string"
          ) {
            sendJson(res, 400, { error: "invalid_company_input" });
            return;
          }
          const result = await productStore.createCompany({
            id: typeof body.id === "string" ? body.id : undefined,
            name: body.name,
            description: typeof body.description === "string" ? body.description : null,
            openclawCeo: {
              id: typeof leader.id === "string" ? leader.id : undefined,
              label: leader.label,
              openclawAgentId: leader.openclawAgentId,
              adapterId: typeof leader.adapterId === "string" ? leader.adapterId : undefined,
              modelRef: typeof leader.modelRef === "string" ? leader.modelRef : null,
            },
          });
          sendJson(res, 201, result);
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const companyMatch = /^\/api\/oui\/companies\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && companyMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(companyMatch[1]);
        const detail = await getCompanyDetail(productStore, companyId);
        sendJson(res, detail ? 200 : 404, detail ?? { error: "not_found" });
        return;
      }

      const ceoConversationsMatch = /^\/api\/oui\/companies\/([^/]+)\/ceo\/conversations$/.exec(
        url.pathname,
      );
      if (req.method === "GET" && ceoConversationsMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(ceoConversationsMatch[1]);
        const company = await productStore.getCompany(companyId);
        if (!company) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        sendJson(res, 200, {
          conversations: await productStore.listCeoConversations(companyId),
        });
        return;
      }

      const ceoMessagesMatch = /^\/api\/oui\/companies\/([^/]+)\/ceo\/messages$/.exec(url.pathname);
      if (ceoMessagesMatch) {
        const service = ceoService;
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        if (!service) {
          sendJson(res, 404, { error: "oui_ceo_service_unavailable" });
          return;
        }
        const companyId = decodeURIComponent(ceoMessagesMatch[1]);
        const company = await productStore.getCompany(companyId);
        if (!company) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        if (req.method === "GET") {
          const conversations = await productStore.listCeoConversations(companyId);
          const requestedConversationId = optionalString(url.searchParams.get("conversationId"));
          const conversation: OuiConversationRecord | null =
            conversations.find((entry) => entry.id === requestedConversationId) ??
            conversations[0] ??
            null;
          const messages: OuiMessageRecord[] = conversation
            ? await productStore.listConversationMessages(conversation.id)
            : [];
          sendJson(res, 200, {
            conversation,
            messages,
            context: await service.buildContext(companyId, conversation?.id ?? null),
          });
          return;
        }
        if (req.method === "POST") {
          const body = asObject(await readRequestBody(req));
          const text = optionalString(body.text);
          if (!text) {
            sendJson(res, 400, { error: "invalid_ceo_message_input" });
            return;
          }
          const result = await service.sendMessage({
            companyId,
            conversationId: optionalString(body.conversationId),
            text,
          });
          const detail = await getCompanyDetail(productStore, companyId);
          sendJson(res, 201, { ...result, detail });
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const ceoGenerateRunbookMatch =
        /^\/api\/oui\/companies\/([^/]+)\/ceo\/generate-runbook$/.exec(url.pathname);
      if (req.method === "POST" && ceoGenerateRunbookMatch) {
        const service = ceoService;
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        if (!service) {
          sendJson(res, 404, { error: "oui_ceo_service_unavailable" });
          return;
        }
        const companyId = decodeURIComponent(ceoGenerateRunbookMatch[1]);
        if (!(await productStore.getCompany(companyId))) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        const body = asObject(await readRequestBody(req));
        const result = await service.generateRunbookDraft({
          companyId,
          conversationId: optionalString(body.conversationId),
          objective: optionalString(body.objective),
        });
        const detail = await getCompanyDetail(productStore, companyId);
        sendJson(res, 201, { ...result, detail });
        return;
      }

      const companyControlRoomMatch = /^\/api\/oui\/companies\/([^/]+)\/control-room$/.exec(
        url.pathname,
      );
      if (req.method === "GET" && companyControlRoomMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const detail = await getCompanyDetail(
          productStore,
          decodeURIComponent(companyControlRoomMatch[1]),
        );
        sendJson(
          res,
          detail ? 200 : 404,
          detail ? { controlRoom: detail.controlRoom } : { error: "not_found" },
        );
        return;
      }

      const companyRunbooksMatch = /^\/api\/oui\/companies\/([^/]+)\/runbooks$/.exec(url.pathname);
      if (companyRunbooksMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(companyRunbooksMatch[1]);
        const company = await productStore.getCompany(companyId);
        if (!company) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        if (req.method === "GET") {
          const runbooks = await productStore.listRunbooks(companyId);
          const versions = await productStore.listRunbookVersions(companyId);
          const workNodes = await productStore.listWorkNodes(companyId);
          const activeVersion = company.currentRunbookVersionId
            ? (versions.find((version) => version.id === company.currentRunbookVersionId) ??
              (await productStore.getRunbookVersion(company.currentRunbookVersionId)))
            : (versions.find((version) => version.status === "active") ?? null);
          sendJson(res, 200, { runbooks, versions, activeVersion, workNodes });
          return;
        }
        if (req.method === "POST") {
          const body = asObject(await readRequestBody(req));
          if (typeof body.title !== "string" || typeof body.objective !== "string") {
            sendJson(res, 400, { error: "invalid_runbook_input" });
            return;
          }
          const sourceType = RUNBOOK_SOURCE_TYPES.has(body.sourceType as OuiRunbookSourceType)
            ? (body.sourceType as OuiRunbookSourceType)
            : "manual";
          const operatingMode = RUNBOOK_KINDS.has(body.operatingMode as OuiRunbookKind)
            ? (body.operatingMode as OuiRunbookKind)
            : undefined;
          const result = await productStore.createRunbookDraft({
            id: typeof body.id === "string" ? body.id : undefined,
            versionId: typeof body.versionId === "string" ? body.versionId : undefined,
            companyId,
            title: body.title,
            sourceType,
            sourceRef: typeof body.sourceRef === "string" ? body.sourceRef : null,
            objective: body.objective,
            operatingMode,
            stages: asJsonObjectArray(body.stages),
            decisionPoints: asJsonObjectArray(body.decisionPoints),
            artifactPolicy: asObject(body.artifactPolicy),
            pausePolicy: asObject(body.pausePolicy),
            reportPolicy: asObject(body.reportPolicy),
            markdownPath: typeof body.markdownPath === "string" ? body.markdownPath : null,
          });
          sendJson(res, 201, result);
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const companyInboxMatch = /^\/api\/oui\/companies\/([^/]+)\/inbox$/.exec(url.pathname);
      if (companyInboxMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(companyInboxMatch[1]);
        const company = await productStore.getCompany(companyId);
        if (!company) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        if (req.method === "GET") {
          const rawStatus = url.searchParams.get("status");
          const status =
            rawStatus && INBOX_ITEM_STATUSES.has(rawStatus as OuiInboxItemStatus)
              ? (rawStatus as OuiInboxItemStatus)
              : undefined;
          sendJson(res, 200, { items: await productStore.listInboxItems(companyId, status) });
          return;
        }
        if (req.method === "POST") {
          const body = asObject(await readRequestBody(req));
          const itemType = INBOX_ITEM_TYPES.has(body.itemType as OuiInboxItemType)
            ? (body.itemType as OuiInboxItemType)
            : null;
          if (!itemType || typeof body.title !== "string") {
            sendJson(res, 400, { error: "invalid_inbox_input" });
            return;
          }
          const item = await productStore.createInboxItem({
            id: typeof body.id === "string" ? body.id : undefined,
            companyId,
            itemType,
            title: body.title,
            summary: optionalString(body.summary),
            runbookVersionId: optionalString(body.runbookVersionId),
            taskId: optionalString(body.taskId),
            runId: optionalString(body.runId),
            payload: asObject(body.payload),
            createdBy: optionalString(body.createdBy),
          });
          sendJson(res, 201, { item });
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
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
      if (companyTasksMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(companyTasksMatch[1]);
        if (req.method === "GET") {
          sendJson(res, 200, { tasks: await productStore.listTasks(companyId) });
          return;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "method_not_allowed" });
          return;
        }
        const body = asObject(await readRequestBody(req));
        if (typeof body.title !== "string") {
          sendJson(res, 400, { error: "invalid_task_input" });
          return;
        }
        const task = await productStore.createTask({
          id: typeof body.id === "string" ? body.id : undefined,
          companyId,
          title: body.title,
          description: typeof body.description === "string" ? body.description : null,
          assignedAgentId: typeof body.assignedAgentId === "string" ? body.assignedAgentId : null,
          priority: typeof body.priority === "number" ? body.priority : undefined,
        });
        sendJson(res, 201, { task });
        return;
      }

      const startRunbookMatch = /^\/api\/oui\/runbook-versions\/([^/]+)\/start$/.exec(url.pathname);
      if (req.method === "POST" && startRunbookMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        const result = await productStore.startRunbookVersion(
          decodeURIComponent(startRunbookMatch[1]),
          optionalString(body.startedBy) ?? "user",
        );
        const detail = await getCompanyDetail(productStore, result.company.id);
        sendJson(res, 200, {
          ...result,
          detail,
          controlRoom: detail?.controlRoom ?? null,
        });
        return;
      }

      const approveRunbookMatch = /^\/api\/oui\/runbook-versions\/([^/]+)\/approve$/.exec(
        url.pathname,
      );
      if (req.method === "POST" && approveRunbookMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        const version = await productStore.approveRunbookVersion(
          decodeURIComponent(approveRunbookMatch[1]),
          optionalString(body.approvedBy) ?? "user",
        );
        const detail = await getCompanyDetail(productStore, version.companyId);
        sendJson(res, 200, {
          version,
          company: detail?.company ?? null,
          controlRoom: detail?.controlRoom ?? null,
        });
        return;
      }

      const resolveInboxMatch = /^\/api\/oui\/inbox\/([^/]+)\/resolve$/.exec(url.pathname);
      if (req.method === "POST" && resolveInboxMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        const action = optionalString(body.action);
        if (!action || !INBOX_RESOLUTION_ACTIONS.has(action as OuiInboxResolutionAction)) {
          sendJson(res, 400, { error: "invalid_inbox_resolution" });
          return;
        }
        const item = await productStore.resolveInboxItem({
          itemId: decodeURIComponent(resolveInboxMatch[1]),
          action: action as OuiInboxResolutionAction,
          responseText: optionalString(body.responseText),
          actorId: optionalString(body.actorId) ?? "user",
        });
        sendJson(res, 200, { item });
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
  };

  return { flags, handle };
}

export function createOuiHttpServer(options: OuiHttpServerOptions): OuiHttpServer {
  const runtime = createOuiHttpRuntime(options);
  const server = createServer(runtime.handle);

  return {
    server,
    flags: runtime.flags,
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
