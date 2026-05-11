import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import type { OuiAdapterRegistry } from "../adapters/registry.ts";
import { evaluateAdapterExecutionPolicy } from "../security/adapter-policy.ts";
import { createDefaultOuiFeatureFlags } from "../shared/feature-flags.ts";
import type {
  OuiAgentRecord,
  OuiArtifactKind,
  OuiArtifactRecord,
  OuiCompanyDetail,
  OuiCompanyRecord,
  OuiCompanySummary,
  OuiControlRoomNode,
  OuiControlRoomReadModel,
  OuiConversationRecord,
  OuiInboxResolutionAction,
  OuiInboxItemStatus,
  OuiInboxItemType,
  OuiMeetingDiscussionState,
  OuiMeetingMessageRecord,
  OuiMeetingModeratorDocument,
  OuiMeetingParticipant,
  OuiMeetingRecord,
  OuiMessageRecord,
  OuiProductStore,
  OuiRoutineConcurrencyPolicy,
  OuiRoutineStatus,
  OuiRoutineTriggerKind,
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
  OuiRunRecord,
} from "../shared/types.ts";
import { OuiCeoService, type OuiCeoRuntime } from "./ceo-service.ts";
import { OuiCompanyService } from "./company-service.ts";
import { OuiExecutionService, type OuiExecutionInboxResult } from "./execution-service.ts";
import { OuiRunDispatcher } from "./run-dispatcher.ts";

export type OuiHttpServerOptions = {
  store: OuiRunStore;
  productStore?: OuiProductStore;
  companyService?: OuiCompanyService;
  ceoService?: OuiCeoService;
  registry: OuiAdapterRegistry;
  flags?: Partial<OuiFeatureFlags>;
  authToken?: string;
  adapterAllowlist?: ReadonlySet<string> | string[];
  artifactRoot?: string;
  dispatcher?: OuiRunDispatcher;
  ceoRuntime?: OuiCeoRuntime;
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
  close?: () => void;
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

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalMeetingThinkingIntensity(
  value: unknown,
): OuiMeetingParticipant["thinkingIntensity"] {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function sortMeetingParticipants(participants: readonly OuiMeetingParticipant[]) {
  return [...participants].sort((left, right) => {
    const leftOrder =
      typeof left.speakingOrder === "number" && Number.isFinite(left.speakingOrder)
        ? left.speakingOrder
        : Number.MAX_SAFE_INTEGER;
    const rightOrder =
      typeof right.speakingOrder === "number" && Number.isFinite(right.speakingOrder)
        ? right.speakingOrder
        : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.label.localeCompare(right.label);
  });
}

function safePathSegment(value: string): string {
  const safe = value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "artifact";
}

const RUNBOOK_SOURCE_TYPES = new Set<OuiRunbookSourceType>([
  "ceo_chat",
  "meeting_minutes",
  "imported_markdown",
  "manual",
]);

const RUNBOOK_KINDS = new Set<OuiRunbookKind>(["project", "routine"]);

const ROUTINE_TRIGGER_KINDS = new Set<OuiRoutineTriggerKind>([
  "manual",
  "schedule",
  "api",
  "webhook",
]);

const ROUTINE_STATUSES = new Set<OuiRoutineStatus>(["active", "paused", "disabled"]);

const ROUTINE_CONCURRENCY_POLICIES = new Set<OuiRoutineConcurrencyPolicy>([
  "coalesce_if_active",
  "skip_if_active",
  "always_enqueue",
]);

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

const ARTIFACT_KINDS = new Set<OuiArtifactKind>([
  "runbook",
  "meeting_minutes",
  "report",
  "document",
  "code_patch",
  "media",
  "dataset",
  "stage_output",
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

function numericUsageValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function sumUsageKeys(usage: OuiJsonObject, keys: string[]): number {
  return keys.reduce((total, key) => total + (numericUsageValue(usage[key]) ?? 0), 0);
}

function tokenUsageFromEvent(usage: OuiJsonObject): number {
  for (const key of ["totalTokens", "total_tokens", "tokens", "total"]) {
    const value = numericUsageValue(usage[key]);
    if (value !== null) {
      return value;
    }
  }
  return sumUsageKeys(usage, [
    "inputTokens",
    "outputTokens",
    "promptTokens",
    "completionTokens",
    "input_tokens",
    "output_tokens",
    "prompt_tokens",
    "completion_tokens",
  ]);
}

async function summarizeTaskRunTokenUsage(
  productStore: OuiProductStore,
  tasks: Awaited<ReturnType<OuiProductStore["listTasks"]>>,
): Promise<number> {
  const seenRunIds = new Set<string>();
  let tokenUsageTotal = 0;
  for (const task of tasks) {
    const runLinks = await productStore.listTaskRunLinks(task.id);
    for (const link of runLinks) {
      if (seenRunIds.has(link.runId)) {
        continue;
      }
      seenRunIds.add(link.runId);
      const costEvents = await productStore.listCostEventsForRun(link.runId);
      tokenUsageTotal += costEvents.reduce(
        (total, event) => total + tokenUsageFromEvent(event.usage),
        0,
      );
    }
  }
  return tokenUsageTotal;
}

async function listCompanySummaries(productStore: OuiProductStore): Promise<OuiCompanySummary[]> {
  const companies = await productStore.listCompanies();
  const summaries: OuiCompanySummary[] = [];
  for (const company of companies) {
    const agents = await productStore.listAgents(company.id);
    const tasks = await productStore.listTasks(company.id);
    const tokenUsageTotal = await summarizeTaskRunTokenUsage(productStore, tasks);
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
      completedTaskCount: tasks.filter((task) => task.status === "done").length,
      openInboxCount: (await productStore.listInboxItems(company.id, "open")).length,
      tokenUsageTotal,
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

function asMeetingParticipants(value: unknown): OuiMeetingParticipant[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const participants: OuiMeetingParticipant[] = [];
  for (const entry of value) {
    const record = asObject(entry);
    const id = optionalString(record.id);
    const label = optionalString(record.label);
    const adapterKind = optionalString(record.adapterKind);
    if (!id || !label || !adapterKind) {
      continue;
    }
    participants.push({
      id,
      label,
      adapterKind: adapterKind as OuiMeetingParticipant["adapterKind"],
      adapterId: optionalString(record.adapterId),
      agentId: optionalString(record.agentId),
      openclawAgentId: optionalString(record.openclawAgentId),
      modelRef: optionalString(record.modelRef),
      role: optionalString(record.role),
      muted: optionalBoolean(record.muted),
      speakingOrder: optionalNumber(record.speakingOrder),
      thinkingIntensity: optionalMeetingThinkingIntensity(record.thinkingIntensity),
    });
  }
  return participants;
}

function formatMeetingMinutes(input: {
  meeting: OuiMeetingRecord;
  messages: OuiMeetingMessageRecord[];
}): string {
  const lines = [
    `# ${input.meeting.title}`,
    "",
    `- Status: ${input.meeting.status}`,
    input.meeting.objective ? `- Objective: ${input.meeting.objective}` : null,
    `- Created: ${input.meeting.createdAt}`,
    input.meeting.startedAt ? `- Started: ${input.meeting.startedAt}` : null,
    input.meeting.endedAt ? `- Ended: ${input.meeting.endedAt}` : null,
    "",
    "## Participants",
    "",
    ...(input.meeting.participants.length
      ? sortMeetingParticipants(input.meeting.participants).map((participant) => {
          const detail = [
            participant.adapterKind,
            participant.modelRef,
            participant.speakingOrder ? `#${participant.speakingOrder}` : null,
            participant.muted ? "muted" : null,
            participant.thinkingIntensity ? `thinking:${participant.thinkingIntensity}` : null,
          ]
            .filter(Boolean)
            .join(" / ");
          return `- ${participant.label} (${detail})`;
        })
      : ["- No participants recorded."]),
    "",
    "## Transcript",
    "",
    ...(input.messages.length
      ? input.messages.flatMap((message) => {
          const participant = input.meeting.participants.find(
            (entry) => entry.id === message.participantId,
          );
          const speaker =
            message.role === "owner"
              ? "Owner"
              : (participant?.label ?? (message.role === "system" ? "System" : "Participant"));
          return [`### ${speaker} - ${message.createdAt}`, "", message.content, ""];
        })
      : ["No messages recorded.", ""]),
  ].filter((line): line is string => line != null);
  return `${lines.join("\n")}\n`;
}

async function createMeetingMinutesArtifact(input: {
  productStore: OuiProductStore;
  artifactRoot: string;
  meetingId: string;
}): Promise<OuiArtifactRecord> {
  const meeting = await input.productStore.getMeeting(input.meetingId);
  if (!meeting) {
    throw new Error(`OUI meeting not found: ${input.meetingId}`);
  }
  const messages = await input.productStore.listMeetingMessages(meeting.id);
  const markdown = formatMeetingMinutes({ meeting, messages });
  const directory = path.join(input.artifactRoot, "meeting-minutes");
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${safePathSegment(meeting.id)}.md`);
  await writeFile(filePath, markdown, "utf8");
  const artifact = await input.productStore.createArtifact({
    id: `${meeting.id}:minutes`,
    meetingId: meeting.id,
    kind: "meeting_minutes",
    title: `${meeting.title} minutes`,
    summary: meeting.objective,
    path: filePath,
    contentType: "text/markdown",
    content: { markdown },
    metadata: { source: "meeting_room", messageCount: messages.length },
  });
  await input.productStore.updateMeetingStatus({
    meetingId: meeting.id,
    status: "ended",
    minutesArtifactId: artifact.id,
  });
  await input.productStore.updateMeetingDiscussion({
    meetingId: meeting.id,
    discussion: {
      ...meetingDiscussionState(meeting),
      phase: "ended",
    },
  });
  return artifact;
}

function meetingDiscussionState(meeting: OuiMeetingRecord): OuiMeetingDiscussionState {
  return meeting.discussion?.activeDocument
    ? meeting.discussion
    : {
        phase: meeting.status === "ended" ? "ended" : "drafting",
        currentRound: 0,
        activeDocument: {
          round: 0,
          text: [
            `Meeting topic: ${meeting.title}`,
            meeting.objective ? `Context: ${meeting.objective}` : null,
          ]
            .filter((line): line is string => line != null)
            .join("\n"),
          updatedAt: meeting.updatedAt || meeting.createdAt,
          updatedBy: "seed",
        },
        roundHistory: [],
      };
}

function updateMeetingDocument(
  discussion: OuiMeetingDiscussionState,
  input: {
    text: string;
    round: number;
    updatedAt: string;
    updatedBy: OuiMeetingModeratorDocument["updatedBy"];
    phase?: OuiMeetingDiscussionState["phase"];
    appendRoundHistory?: OuiMeetingDiscussionState["roundHistory"][number] | null;
  },
): OuiMeetingDiscussionState {
  return {
    phase: input.phase ?? discussion.phase,
    currentRound: Math.max(discussion.currentRound, input.round),
    activeDocument: {
      round: input.round,
      text: input.text,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    },
    roundHistory: input.appendRoundHistory
      ? [...discussion.roundHistory, input.appendRoundHistory]
      : discussion.roundHistory,
  };
}

async function executeMeetingAdapterRun(input: {
  adapterId: string;
  agentId: string;
  sessionKey: string;
  runId: string;
  message: string;
  store: OuiRunStore;
  dispatcher: OuiRunDispatcher;
  now?: Date;
}): Promise<OuiRunRecord> {
  const run = await input.store.enqueueRun({
    id: input.runId,
    adapterId: input.adapterId,
    adapterKind: "openclaw",
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    input: {
      sessionKey: input.sessionKey,
      message: input.message,
    },
    maxAttempts: 1,
    now: input.now,
  });
  const dispatch = await input.dispatcher.dispatchRun(run.id);
  return dispatch.status === "finished" || dispatch.status === "blocked"
    ? dispatch.run
    : ((await input.store.getRun(run.id)) ?? run);
}

async function waitForTerminalMeetingRun(input: {
  store: OuiRunStore;
  runId: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<OuiRunRecord | null> {
  const timeoutMs = input.timeoutMs ?? 45_000;
  const pollMs = input.pollMs ?? 500;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const run = await input.store.getRun(input.runId);
    if (!run) {
      return null;
    }
    if (isTerminalRunStatus(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return input.store.getRun(input.runId);
}

async function createMeetingModeratorDocument(input: {
  meeting: OuiMeetingRecord;
  store: OuiRunStore;
  dispatcher: OuiRunDispatcher;
  registry: OuiAdapterRegistry;
  previousDocumentText: string;
  round: number;
  participantMessages: OuiMeetingMessageRecord[];
  userInstruction?: string | null;
}): Promise<{
  text: string;
  metadata: OuiJsonObject;
}> {
  const moderator = pickMeetingModeratorParticipant(input.meeting);
  if (!moderator || moderator.adapterKind !== "openclaw" || !moderator.adapterId) {
    return {
      text: formatModeratorFallbackDocument({
        meeting: input.meeting,
        round: input.round,
        previousDocumentText: input.previousDocumentText,
        participantMessages: input.participantMessages,
        userInstruction: input.userInstruction,
      }),
      metadata: {
        source: "meeting_moderator_fallback",
        round: input.round,
      },
    };
  }
  try {
    input.registry.require(moderator.adapterId);
    const initialRun = await executeMeetingAdapterRun({
      adapterId: moderator.adapterId,
      agentId: moderator.agentId ?? moderator.id,
      sessionKey: meetingModeratorSessionKey(moderator, input.meeting.id),
      runId: `oui-meeting:${input.meeting.id}:moderator:${input.round}:${Date.now()}`,
      message: input.userInstruction
        ? buildMeetingModeratorRevisionMessage({
            meeting: input.meeting,
            currentDocumentText: input.previousDocumentText,
            instruction: input.userInstruction,
          })
        : buildMeetingModeratorRoundMessage({
            meeting: input.meeting,
            round: input.round,
            previousDocumentText: input.previousDocumentText,
            participantMessages: input.participantMessages,
          }),
      store: input.store,
      dispatcher: input.dispatcher,
    });
    const run = isTerminalRunStatus(initialRun.status)
      ? initialRun
      : ((await waitForTerminalMeetingRun({
          store: input.store,
          runId: initialRun.id,
        })) ?? initialRun);
    return {
      text: runSummary(run),
      metadata: {
        source: "meeting_moderator_openclaw",
        round: input.round,
        runId: run.id,
        runStatus: run.status,
      },
    };
  } catch {
    return {
      text: formatModeratorFallbackDocument({
        meeting: input.meeting,
        round: input.round,
        previousDocumentText: input.previousDocumentText,
        participantMessages: input.participantMessages,
        userInstruction: input.userInstruction,
      }),
      metadata: {
        source: "meeting_moderator_fallback",
        round: input.round,
      },
    };
  }
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
  artifacts: OuiArtifactRecord[];
}): OuiControlRoomReadModel {
  const { company, agents, tasks, runbooks, activeVersion, workNodes, inboxItems, artifacts } =
    input;
  const openInboxItems = inboxItems.filter((item) => item.status === "open");
  const activeRunbook = resolveActiveRunbook(company, runbooks, activeVersion);
  const nodes = buildControlRoomNodes(company, agents, activeVersion, workNodes);
  const hasReadyOrRunningNode = workNodes.some(
    (node) => node.status === "ready" || node.status === "running",
  );
  const hasIncompleteNode = workNodes.some(
    (node) => node.status !== "done" && node.status !== "skipped",
  );
  const nextStep = openInboxItems.length
    ? "Review the open inbox items before the company continues."
    : hasReadyOrRunningNode
      ? "Runbook is active. Work nodes are running or ready."
      : activeVersion && workNodes.length && !hasIncompleteNode
        ? "Runbook completed. Review the artifacts and CEO report."
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
    artifactCount: artifacts.length,
    updatedAt: newestTimestamp([
      company.updatedAt,
      ...tasks.map((task) => task.updatedAt),
      ...runbooks.map((runbook) => runbook.updatedAt),
      ...workNodes.map((node) => node.updatedAt),
      ...inboxItems.map((item) => item.updatedAt),
      ...artifacts.map((artifact) => artifact.updatedAt),
      ...(activeVersion ? [activeVersion.updatedAt] : []),
    ]),
  };
}

function isTerminalRunStatus(status: OuiRunRecord["status"]): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "timed_out" ||
    status === "blocked"
  );
}

function extractText(value: unknown, depth = 0): string | null {
  if (depth > 4) {
    return null;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return (
      value
        .map((entry) => extractText(entry, depth + 1))
        .filter((entry): entry is string => Boolean(entry))
        .join("\n")
        .trim() || null
    );
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["summary", "text", "content", "message", "output", "final", "result"]) {
    const text = extractText(record[key], depth + 1);
    if (text) {
      return text;
    }
  }
  return null;
}

function runSummary(run: OuiRunRecord): string {
  const result = asObject(run.result);
  return (
    optionalString(result.summary) ??
    extractText(result.resultJson) ??
    optionalString(result.error) ??
    optionalString(run.error) ??
    `Run ${run.id} finished with status ${run.status}.`
  );
}

function openClawAgentMainSessionKey(agentId: string | null | undefined): string {
  const raw = (agentId || "main").trim();
  return raw.startsWith("agent:") ? raw : `agent:${raw}:main`;
}

function openClawMainSessionKey(agent: OuiAgentRecord): string {
  return openClawAgentMainSessionKey(agent.openclawAgentId || agent.id);
}

function meetingModeratorSessionKey(participant: OuiMeetingParticipant, meetingId: string): string {
  const agentId = participant.openclawAgentId ?? participant.agentId ?? participant.id;
  return openClawAgentMainSessionKey(agentId);
}

function pickMeetingModeratorParticipant(meeting: OuiMeetingRecord): OuiMeetingParticipant | null {
  return (
    sortMeetingParticipants(meeting.participants).find(
      (participant) => participant.adapterKind === "openclaw" && participant.muted !== true,
    ) ??
    sortMeetingParticipants(meeting.participants).find(
      (participant) => participant.muted !== true,
    ) ??
    sortMeetingParticipants(meeting.participants)[0] ??
    null
  );
}

function buildMeetingParticipantRoundMessage(input: {
  meeting: OuiMeetingRecord;
  participant: OuiMeetingParticipant;
  round: number;
  documentText: string;
}): string {
  return [
    `You are ${input.participant.label}, participating in round ${input.round} of an OUI meeting room.`,
    "Your goal is to improve the discussion, not to win.",
    "Read the moderator document below, then contribute a distinct perspective, corrections, and remaining uncertainty.",
    "Do not execute side effects.",
    input.meeting.objective ? `Meeting objective: ${input.meeting.objective}` : null,
    input.participant.thinkingIntensity
      ? `Reasoning preference: ${input.participant.thinkingIntensity}.`
      : null,
    "",
    "Moderator document:",
    input.documentText,
    "",
    "Respond with:",
    "- Your updated point of view",
    "- What in the document seems weakest or most incomplete",
    "- One correction or refinement",
    "- What remains uncertain",
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}

function formatModeratorFallbackDocument(input: {
  meeting: OuiMeetingRecord;
  round: number;
  previousDocumentText: string;
  participantMessages: OuiMeetingMessageRecord[];
  userInstruction?: string | null;
}): string {
  const participantLines = input.participantMessages.length
    ? input.participantMessages.map((message) => {
        const label =
          input.meeting.participants.find((participant) => participant.id === message.participantId)
            ?.label ??
          message.participantId ??
          "Participant";
        return `- ${label}: ${message.content}`;
      })
    : ["- No participant responses recorded."];
  return [
    `Round ${input.round} moderator document`,
    "",
    `Topic: ${input.meeting.title}`,
    input.meeting.objective ? `Context: ${input.meeting.objective}` : null,
    input.userInstruction ? `User guidance: ${input.userInstruction}` : null,
    "",
    "Previous document:",
    input.previousDocumentText,
    "",
    "Round contributions:",
    ...participantLines,
    "",
    "Next round focus:",
    "Carry forward the strongest ideas, preserve important disagreement, and correct weak or unsupported claims.",
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}

function buildMeetingModeratorRoundMessage(input: {
  meeting: OuiMeetingRecord;
  round: number;
  previousDocumentText: string;
  participantMessages: OuiMeetingMessageRecord[];
}): string {
  const contributions = input.participantMessages
    .map((message) => {
      const label =
        input.meeting.participants.find((participant) => participant.id === message.participantId)
          ?.label ??
        message.participantId ??
        "Participant";
      return `${label}:\n${message.content}`;
    })
    .join("\n\n");
  return [
    `You are the moderator of an OUI meeting room. Produce the document for round ${input.round}.`,
    "Do not decide who won. Preserve useful disagreement while moving the discussion forward.",
    "",
    `Meeting topic: ${input.meeting.title}`,
    input.meeting.objective ? `Meeting objective: ${input.meeting.objective}` : null,
    "",
    "Previous moderator document:",
    input.previousDocumentText,
    "",
    "Round contributions:",
    contributions || "No participant contributions recorded.",
    "",
    "Write the next-round document with:",
    "- A short current best understanding",
    "- Main disagreement or unresolved tension",
    "- Corrections to weak claims",
    "- What the next round should focus on",
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}

function buildMeetingModeratorRevisionMessage(input: {
  meeting: OuiMeetingRecord;
  currentDocumentText: string;
  instruction: string;
}): string {
  return [
    `You are the moderator of an OUI meeting room for "${input.meeting.title}".`,
    "Revise the moderator document based on the user's instruction without losing important disagreement.",
    input.meeting.objective ? `Meeting objective: ${input.meeting.objective}` : null,
    "",
    "Current document:",
    input.currentDocumentText,
    "",
    "User instruction:",
    input.instruction,
    "",
    "Return the full updated moderator document.",
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}

function resolveWorkNodeAgent(input: {
  company: OuiCompanyRecord;
  node: OuiWorkNodeRecord;
  agents: OuiAgentRecord[];
}): OuiAgentRecord | null {
  return (
    (input.node.assignedAgentId
      ? input.agents.find((agent) => agent.id === input.node.assignedAgentId)
      : null) ??
    (input.company.defaultLeaderAgentId
      ? input.agents.find((agent) => agent.id === input.company.defaultLeaderAgentId)
      : null) ??
    (input.company.ceoAgentId
      ? input.agents.find((agent) => agent.id === input.company.ceoAgentId)
      : null) ??
    input.agents.find((agent) => agent.isLeader) ??
    null
  );
}

function buildWorkNodeRunMessage(input: {
  company: OuiCompanyRecord;
  agent: OuiAgentRecord;
  version: OuiRunbookVersionRecord;
  node: OuiWorkNodeRecord;
}): string {
  return [
    `You are ${input.agent.label}, working inside the OUI company "${input.company.name}".`,
    "OUI is the control plane. OpenClaw is the lead agent runtime for this company.",
    "Complete only the current work node. Do not perform destructive or external side effects unless the owner explicitly approved them in the runbook.",
    "",
    `Company objective: ${input.version.objective}`,
    `Current stage: ${input.node.title}`,
    input.node.summary ? `Stage brief: ${input.node.summary}` : null,
    "",
    "Return a concise owner-facing report with: completed work, concrete output, risks, and recommended next step.",
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}

function buildMeetingParticipantRunMessage(input: {
  meeting: OuiMeetingRecord;
  participant: OuiMeetingParticipant;
  prompt: string;
  priorMessages: OuiMeetingMessageRecord[];
}): string {
  const transcript = input.priorMessages
    .slice(-12)
    .map((message) => {
      const speaker =
        message.role === "owner"
          ? "Owner"
          : (input.meeting.participants.find((entry) => entry.id === message.participantId)
              ?.label ?? message.role);
      return `${speaker}: ${message.content}`;
    })
    .join("\n");
  return [
    `You are ${input.participant.label}, invited into an OUI meeting room.`,
    "This is a free-agent discussion room. You are not automatically part of any company.",
    "Give a direct meeting contribution from your perspective. Do not execute side effects.",
    input.meeting.objective ? `Meeting objective: ${input.meeting.objective}` : null,
    input.participant.thinkingIntensity
      ? `Reasoning preference: ${input.participant.thinkingIntensity}.`
      : null,
    transcript ? `Current transcript:\n${transcript}` : null,
    "",
    `Owner agenda item: ${input.prompt}`,
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}

async function getCompanyDetail(
  productStore: OuiProductStore,
  companyId: string,
): Promise<OuiCompanyDetail | null> {
  const company = await productStore.getCompany(companyId);
  if (!company) {
    return null;
  }
  const [
    agents,
    ceoConversations,
    tasks,
    runbooks,
    runbookVersions,
    routines,
    workNodes,
    inboxItems,
    artifacts,
    auditLog,
  ] = await Promise.all([
    productStore.listAgents(companyId),
    productStore.listCeoConversations(companyId),
    productStore.listTasks(companyId),
    productStore.listRunbooks(companyId),
    productStore.listRunbookVersions(companyId),
    productStore.listRoutines(companyId),
    productStore.listWorkNodes(companyId),
    productStore.listInboxItems(companyId),
    productStore.listArtifacts({ companyId }),
    productStore.listAuditLog(companyId, 60),
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
    routines,
    activeRunbookVersion,
    workNodes,
    inboxItems,
    artifacts,
    auditLog,
    controlRoom: buildControlRoomReadModel({
      company,
      agents,
      tasks,
      runbooks,
      activeVersion: activeRunbookVersion,
      workNodes: activeWorkNodes,
      inboxItems,
      artifacts,
    }),
  };
}

async function syncRunningCompanyExecution(input: {
  productStore: OuiProductStore;
  executionService: OuiExecutionService | null;
  companyId: string;
}): Promise<void> {
  if (!input.executionService) {
    return;
  }
  const company = await input.productStore.getCompany(input.companyId);
  if (!company?.currentRunbookVersionId) {
    return;
  }
  const openInboxItems = await input.productStore.listInboxItems(company.id, "open");
  if (openInboxItems.length) {
    return;
  }
  if (company.status !== "running") {
    return;
  }
  const activeWorkNodes = await input.productStore.listWorkNodes(
    company.id,
    company.currentRunbookVersionId,
  );
  const hasAdvanceableNode = activeWorkNodes.some(
    (node) =>
      (node.status === "running" && node.runId) ||
      node.status === "ready" ||
      node.status === "pending",
  );
  if (!hasAdvanceableNode) {
    return;
  }
  await input.executionService.enqueueCompanyWakeup({
    id: `wakeup:${company.id}:running-sync`,
    companyId: company.id,
    reason: "running_sync",
    runbookVersionId: company.currentRunbookVersionId,
    payload: { source: "company_read" },
  });
  await input.executionService.drainWorkWakeups({ maxWakeups: 4 });
}

async function listCompanyRunIds(
  productStore: OuiProductStore,
  companyId: string,
): Promise<string[]> {
  const runIds = new Set<string>();
  const [tasks, workNodes, inboxItems, artifacts] = await Promise.all([
    productStore.listTasks(companyId),
    productStore.listWorkNodes(companyId),
    productStore.listInboxItems(companyId),
    productStore.listArtifacts({ companyId }),
  ]);
  for (const task of tasks) {
    const links = await productStore.listTaskRunLinks(task.id);
    for (const link of links) {
      runIds.add(link.runId);
    }
  }
  for (const node of workNodes) {
    if (node.runId) {
      runIds.add(node.runId);
    }
  }
  for (const item of inboxItems) {
    if (item.runId) {
      runIds.add(item.runId);
    }
  }
  for (const artifact of artifacts) {
    if (artifact.runId) {
      runIds.add(artifact.runId);
    }
  }
  return [...runIds];
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
    options.ceoService ??
    (options.productStore
      ? new OuiCeoService(options.productStore, { runtime: options.ceoRuntime })
      : null);
  const artifactRoot = options.artifactRoot ?? path.join(process.cwd(), ".artifacts", "oui");
  const dispatcher =
    options.dispatcher ??
    new OuiRunDispatcher({
      store: options.store,
      registry: options.registry,
      flags,
      workerId: "oui-http-inline",
      adapterAllowlist: options.adapterAllowlist,
    });
  const meetingDispatcher = new OuiRunDispatcher({
    store: options.store,
    registry: options.registry,
    flags,
    workerId: "oui-http-meeting-inline",
    leaseMs: 30_000,
    inlineWaitMs: 125_000,
    adapterAllowlist: options.adapterAllowlist,
  });
  const executionService = options.productStore
    ? new OuiExecutionService({
        productStore: options.productStore,
        runStore: options.store,
        registry: options.registry,
        flags,
        dispatcher,
        adapterAllowlist: options.adapterAllowlist,
      })
    : null;
  let backgroundDrainActive = false;
  const backgroundDrain = executionService
    ? setInterval(() => {
        if (backgroundDrainActive) {
          return;
        }
        backgroundDrainActive = true;
        const routineDispatch = flags.ouiRoutinesEnabled
          ? executionService.dispatchDueRoutines({ maxRoutines: 2 })
          : Promise.resolve([]);
        void routineDispatch
          .then(() => executionService.drainWorkWakeups({ maxWakeups: 3 }))
          .catch(() => {
            // The next HTTP read or interval will surface and retry failed wakeups.
          })
          .finally(() => {
            backgroundDrainActive = false;
          });
      }, 1_500)
    : null;
  (backgroundDrain as { unref?: () => void } | null)?.unref?.();
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
          routinesEnabled: flags.ouiRoutinesEnabled,
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

      if (url.pathname === "/api/oui/artifacts") {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        if (req.method === "GET") {
          sendJson(res, 200, {
            artifacts: await productStore.listArtifacts({
              companyId: optionalString(url.searchParams.get("companyId")),
              meetingId: optionalString(url.searchParams.get("meetingId")),
              runId: optionalString(url.searchParams.get("runId")),
            }),
          });
          return;
        }
        if (req.method === "POST") {
          const body = asObject(await readRequestBody(req));
          const kind = ARTIFACT_KINDS.has(body.kind as OuiArtifactKind)
            ? (body.kind as OuiArtifactKind)
            : null;
          if (!kind || typeof body.title !== "string") {
            sendJson(res, 400, { error: "invalid_artifact_input" });
            return;
          }
          const artifact = await productStore.createArtifact({
            id: optionalString(body.id) ?? undefined,
            companyId: optionalString(body.companyId),
            meetingId: optionalString(body.meetingId),
            runId: optionalString(body.runId),
            kind,
            title: body.title,
            summary: optionalString(body.summary),
            path: optionalString(body.path),
            contentType: optionalString(body.contentType) ?? undefined,
            content: asObject(body.content),
            metadata: asObject(body.metadata),
          });
          sendJson(res, 201, { artifact });
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      if (url.pathname === "/api/oui/meetings") {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        if (req.method === "GET") {
          sendJson(res, 200, { meetings: await productStore.listMeetings() });
          return;
        }
        if (req.method === "POST") {
          const body = asObject(await readRequestBody(req));
          if (typeof body.title !== "string") {
            sendJson(res, 400, { error: "invalid_meeting_input" });
            return;
          }
          const meeting = await productStore.createMeeting({
            id: optionalString(body.id) ?? undefined,
            title: body.title,
            objective: optionalString(body.objective),
            participants: asMeetingParticipants(body.participants),
          });
          sendJson(res, 201, { meeting });
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const meetingMatch = /^\/api\/oui\/meetings\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && meetingMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const meetingId = decodeURIComponent(meetingMatch[1]);
        const meeting = await productStore.getMeeting(meetingId);
        if (!meeting) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        sendJson(res, 200, {
          meeting,
          messages: await productStore.listMeetingMessages(meetingId),
          artifacts: await productStore.listArtifacts({ meetingId }),
        });
        return;
      }

      const meetingStatusMatch = /^\/api\/oui\/meetings\/([^/]+)\/(start|end)$/.exec(url.pathname);
      if (req.method === "POST" && meetingStatusMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        let meeting = await productStore.updateMeetingStatus({
          meetingId: decodeURIComponent(meetingStatusMatch[1]),
          status: meetingStatusMatch[2] === "start" ? "active" : "ended",
        });
        if (meetingStatusMatch[2] === "end") {
          meeting = await productStore.updateMeetingDiscussion({
            meetingId: meeting.id,
            discussion: {
              ...meeting.discussion,
              phase: "ended",
            },
          });
        }
        sendJson(res, 200, { meeting });
        return;
      }

      const meetingParticipantsMatch = /^\/api\/oui\/meetings\/([^/]+)\/participants$/.exec(
        url.pathname,
      );
      if (req.method === "PUT" && meetingParticipantsMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        sendJson(res, 200, {
          meeting: await productStore.updateMeetingParticipants({
            meetingId: decodeURIComponent(meetingParticipantsMatch[1]),
            participants: asMeetingParticipants(body.participants),
          }),
        });
        return;
      }

      const meetingDocumentMatch = /^\/api\/oui\/meetings\/([^/]+)\/document$/.exec(url.pathname);
      if (req.method === "PUT" && meetingDocumentMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const meetingId = decodeURIComponent(meetingDocumentMatch[1]);
        console.warn("[oui-meeting] PUT document", { meetingId });
        const meeting = await productStore.getMeeting(meetingId);
        if (!meeting) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        const body = asObject(await readRequestBody(req));
        const documentText = optionalString(body.document);
        if (!documentText) {
          sendJson(res, 400, { error: "invalid_meeting_document" });
          return;
        }
        const now = new Date().toISOString();
        const discussion = meetingDiscussionState(meeting);
        const updatedMeeting = await productStore.updateMeetingDiscussion({
          meetingId,
          discussion: updateMeetingDocument(meetingDiscussionState(meeting), {
            text: documentText,
            round: discussion.currentRound,
            updatedAt: now,
            updatedBy: "user",
            phase: meeting.status === "ended" ? "ended" : discussion.phase,
          }),
        });
        sendJson(res, 200, { meeting: updatedMeeting });
        return;
      }

      const meetingModeratorMatch = /^\/api\/oui\/meetings\/([^/]+)\/moderator\/revise$/.exec(
        url.pathname,
      );
      if (req.method === "POST" && meetingModeratorMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const meetingId = decodeURIComponent(meetingModeratorMatch[1]);
        console.warn("[oui-meeting] POST moderator revise", { meetingId });
        const meeting = await productStore.getMeeting(meetingId);
        if (!meeting) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        const body = asObject(await readRequestBody(req));
        const instruction = optionalString(body.instruction);
        if (!instruction) {
          sendJson(res, 400, { error: "invalid_moderator_instruction" });
          return;
        }
        const discussion = meetingDiscussionState(meeting);
        const ownerMessage = await productStore.appendMeetingMessage({
          meetingId,
          role: "owner",
          content: instruction,
          metadata: {
            source: "meeting_moderator_instruction",
            round: discussion.currentRound,
          },
        });
        const moderatorDocument = await createMeetingModeratorDocument({
          meeting,
          store: options.store,
          dispatcher: meetingDispatcher,
          registry: options.registry,
          previousDocumentText: discussion.activeDocument.text,
          round: discussion.currentRound,
          participantMessages: [],
          userInstruction: instruction,
        });
        const moderatorMessage = await productStore.appendMeetingMessage({
          meetingId,
          role: "system",
          content: moderatorDocument.text,
          metadata: moderatorDocument.metadata,
        });
        const updatedMeeting = await productStore.updateMeetingDiscussion({
          meetingId,
          discussion: updateMeetingDocument(discussion, {
            text: moderatorDocument.text,
            round: discussion.currentRound,
            updatedAt: new Date().toISOString(),
            updatedBy: "moderator",
            phase: meeting.status === "draft" ? "drafting" : "awaiting_user",
          }),
        });
        sendJson(res, 200, {
          meeting: updatedMeeting,
          ownerMessage,
          moderatorMessage,
          messages: await productStore.listMeetingMessages(meetingId),
        });
        return;
      }

      const meetingRoundsMatch = /^\/api\/oui\/meetings\/([^/]+)\/rounds\/next$/.exec(url.pathname);
      if (req.method === "POST" && meetingRoundsMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const meetingId = decodeURIComponent(meetingRoundsMatch[1]);
        console.warn("[oui-meeting] POST rounds next", { meetingId });
        let meeting = await productStore.getMeeting(meetingId);
        if (!meeting) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        if (meeting.status === "ended") {
          sendJson(res, 409, { error: "meeting_ended" });
          return;
        }
        const discussion = meetingDiscussionState(meeting);
        const round = discussion.currentRound + 1;
        const sourceDocumentText = discussion.activeDocument.text;
        if (meeting.status === "draft") {
          meeting = await productStore.updateMeetingStatus({ meetingId, status: "active" });
        }
        const participantMessages: OuiMeetingMessageRecord[] = [];
        const activeParticipants = sortMeetingParticipants(meeting.participants).filter(
          (participant) => participant.muted !== true,
        );
        for (const [index, participant] of activeParticipants.entries()) {
          let content = `${participant.label} did not complete round ${round}.`;
          let metadata: OuiJsonObject = {
            source: "meeting_round_preview",
            round,
            adapterKind: participant.adapterKind,
            execution: "preview_disabled",
          };
          const adapterId =
            participant.adapterId ??
            (participant.adapterKind === "openclaw" ? "openclaw-local" : null);
          if (participant.adapterKind === "openclaw" && adapterId) {
            try {
              const adapter = options.registry.require(adapterId);
              const policy = evaluateAdapterExecutionPolicy({
                adapter,
                flags,
                allowlist: options.adapterAllowlist,
              });
              if (policy.allowed) {
                const initialRun = await executeMeetingAdapterRun({
                  adapterId: adapter.id,
                  agentId: participant.agentId ?? participant.id,
                  sessionKey: openClawAgentMainSessionKey(
                    participant.openclawAgentId ?? participant.agentId ?? participant.id,
                  ),
                  runId: `oui-meeting:${meetingId}:round:${round}:${participant.id}:${Date.now() + index}`,
                  message: buildMeetingParticipantRoundMessage({
                    meeting,
                    participant,
                    round,
                    documentText: sourceDocumentText,
                  }),
                  store: options.store,
                  dispatcher: meetingDispatcher,
                  now: new Date(Date.now() + index + 1),
                });
                const run = isTerminalRunStatus(initialRun.status)
                  ? initialRun
                  : ((await waitForTerminalMeetingRun({
                      store: options.store,
                      runId: initialRun.id,
                    })) ?? initialRun);
                content = runSummary(run);
                metadata = {
                  source: "meeting_round_openclaw",
                  round,
                  adapterKind: participant.adapterKind,
                  execution: "openclaw_runtime",
                  runId: run.id,
                  runStatus: run.status,
                };
              } else {
                content = policy.message;
                metadata = {
                  source: "meeting_round_policy",
                  round,
                  adapterKind: participant.adapterKind,
                  execution: "blocked",
                  policyCode: policy.code,
                };
              }
            } catch (error) {
              content = error instanceof Error ? error.message : String(error);
              metadata = {
                source: "meeting_round_error",
                round,
                adapterKind: participant.adapterKind,
                execution: "failed",
              };
            }
          }
          participantMessages.push(
            await productStore.appendMeetingMessage({
              meetingId,
              role: "participant",
              participantId: participant.id,
              content,
              metadata,
            }),
          );
        }
        const moderatorDocument = await createMeetingModeratorDocument({
          meeting,
          store: options.store,
          dispatcher: meetingDispatcher,
          registry: options.registry,
          previousDocumentText: sourceDocumentText,
          round,
          participantMessages,
        });
        const moderatorMessage = await productStore.appendMeetingMessage({
          meetingId,
          role: "system",
          content: moderatorDocument.text,
          metadata: moderatorDocument.metadata,
        });
        const updatedMeeting = await productStore.updateMeetingDiscussion({
          meetingId,
          discussion: updateMeetingDocument(discussion, {
            text: moderatorDocument.text,
            round,
            updatedAt: new Date().toISOString(),
            updatedBy: "moderator",
            phase: "awaiting_user",
            appendRoundHistory: {
              round,
              sourceDocumentText,
              participantMessageIds: participantMessages.map((message) => message.id),
              moderatorMessageId: moderatorMessage.id,
              createdAt: new Date().toISOString(),
            },
          }),
        });
        sendJson(res, 201, {
          meeting: updatedMeeting,
          participantMessages,
          moderatorMessage,
          messages: await productStore.listMeetingMessages(meetingId),
        });
        return;
      }

      const meetingMessagesMatch = /^\/api\/oui\/meetings\/([^/]+)\/messages$/.exec(url.pathname);
      if (meetingMessagesMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const meetingId = decodeURIComponent(meetingMessagesMatch[1]);
        if (req.method === "GET") {
          sendJson(res, 200, {
            messages: await productStore.listMeetingMessages(meetingId),
          });
          return;
        }
        if (req.method === "POST") {
          const body = asObject(await readRequestBody(req));
          const role =
            body.role === "participant" || body.role === "system" || body.role === "owner"
              ? body.role
              : "owner";
          const content = optionalString(body.content);
          if (!content) {
            sendJson(res, 400, { error: "invalid_meeting_message_input" });
            return;
          }
          const message = await productStore.appendMeetingMessage({
            id: optionalString(body.id) ?? undefined,
            meetingId,
            role,
            participantId: optionalString(body.participantId),
            content,
            metadata: asObject(body.metadata),
          });
          sendJson(res, 201, { message });
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const meetingTurnMatch = /^\/api\/oui\/meetings\/([^/]+)\/turn$/.exec(url.pathname);
      if (req.method === "POST" && meetingTurnMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const meetingId = decodeURIComponent(meetingTurnMatch[1]);
        const meeting = await productStore.getMeeting(meetingId);
        if (!meeting) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        const body = asObject(await readRequestBody(req));
        const prompt = optionalString(body.prompt);
        if (!prompt) {
          sendJson(res, 400, { error: "invalid_meeting_turn_input" });
          return;
        }
        if (meeting.status === "draft") {
          await productStore.updateMeetingStatus({ meetingId, status: "active" });
        }
        const turnNow = new Date();
        const ownerMessage = await productStore.appendMeetingMessage({
          meetingId,
          role: "owner",
          content: prompt,
          metadata: { source: "meeting_turn" },
          now: turnNow,
        });
        const participantMessages: OuiMeetingMessageRecord[] = [];
        const priorMessages = await productStore.listMeetingMessages(meetingId);
        const activeParticipants = sortMeetingParticipants(meeting.participants).filter(
          (participant) => participant.muted !== true,
        );
        for (const [index, participant] of activeParticipants.entries()) {
          let content = `${participant.label} has recorded this agenda item for discussion. Adapter execution remains capability-gated.`;
          let metadata: OuiJsonObject = {
            source: "meeting_turn_preview",
            adapterKind: participant.adapterKind,
            execution: "preview_disabled",
          };
          const adapterId =
            participant.adapterId ??
            (participant.adapterKind === "openclaw" ? "openclaw-local" : null);
          if (participant.adapterKind === "openclaw" && adapterId) {
            try {
              const adapter = options.registry.require(adapterId);
              const policy = evaluateAdapterExecutionPolicy({
                adapter,
                flags,
                allowlist: options.adapterAllowlist,
              });
              if (policy.allowed) {
                const sessionKey = openClawAgentMainSessionKey(
                  participant.openclawAgentId ?? participant.agentId ?? participant.id,
                );
                const run = await options.store.enqueueRun({
                  id: `oui-meeting:${meetingId}:${participant.id}:${ownerMessage.id}`,
                  adapterId: adapter.id,
                  adapterKind: "openclaw",
                  agentId: participant.agentId ?? participant.id,
                  sessionKey,
                  input: {
                    sessionKey,
                    message: buildMeetingParticipantRunMessage({
                      meeting,
                      participant,
                      prompt,
                      priorMessages,
                    }),
                    meetingId,
                    participantId: participant.id,
                  },
                  maxAttempts: 1,
                  now: new Date(turnNow.getTime() + index + 1),
                });
                const dispatch = await dispatcher.dispatchRun(run.id);
                const latestRun =
                  dispatch.status === "finished" || dispatch.status === "blocked"
                    ? dispatch.run
                    : ((await options.store.getRun(run.id)) ?? run);
                content = runSummary(latestRun);
                metadata = {
                  source: "meeting_turn_openclaw",
                  adapterKind: participant.adapterKind,
                  execution: "openclaw_runtime",
                  runId: latestRun.id,
                  runStatus: latestRun.status,
                };
              } else {
                content = policy.message;
                metadata = {
                  source: "meeting_turn_policy",
                  adapterKind: participant.adapterKind,
                  execution: "blocked",
                  policyCode: policy.code,
                };
              }
            } catch (error) {
              content = error instanceof Error ? error.message : String(error);
              metadata = {
                source: "meeting_turn_error",
                adapterKind: participant.adapterKind,
                execution: "failed",
              };
            }
          }
          participantMessages.push(
            await productStore.appendMeetingMessage({
              meetingId,
              role: "participant",
              participantId: participant.id,
              content,
              metadata,
              now: new Date(turnNow.getTime() + index + 1),
            }),
          );
        }
        sendJson(res, 201, {
          ownerMessage,
          participantMessages,
          meeting: await productStore.getMeeting(meetingId),
        });
        return;
      }

      const meetingMinutesMatch = /^\/api\/oui\/meetings\/([^/]+)\/minutes$/.exec(url.pathname);
      if (req.method === "POST" && meetingMinutesMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const artifact = await createMeetingMinutesArtifact({
          productStore,
          artifactRoot,
          meetingId: decodeURIComponent(meetingMinutesMatch[1]),
        });
        sendJson(res, 201, {
          artifact,
          meeting: await productStore.getMeeting(decodeURIComponent(meetingMinutesMatch[1])),
        });
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
          await productStore.recordAuditLog({
            actorType: "owner",
            actorId: "user",
            companyId: result.company.id,
            entityType: "company",
            entityId: result.company.id,
            action: "company.created",
            details: { ceoAgentId: result.ceo.id },
          });
          sendJson(res, 201, result);
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const companyMatch = /^\/api\/oui\/companies\/([^/]+)$/.exec(url.pathname);
      if (companyMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(companyMatch[1]);
        if (req.method === "GET") {
          await syncRunningCompanyExecution({ productStore, executionService, companyId });
          const detail = await getCompanyDetail(productStore, companyId);
          sendJson(res, detail ? 200 : 404, detail ?? { error: "not_found" });
          return;
        }
        if (req.method === "DELETE") {
          const company = await productStore.getCompany(companyId);
          if (!company) {
            sendJson(res, 404, { error: "not_found" });
            return;
          }
          const runIds = await listCompanyRunIds(productStore, companyId);
          const deletedCompany = await productStore.deleteCompany(companyId);
          const deletedRunIds: string[] = [];
          for (const runId of runIds) {
            if (await options.store.deleteRun(runId)) {
              deletedRunIds.push(runId);
            }
          }
          sendJson(res, 200, {
            company: deletedCompany ?? company,
            deletedRunIds,
            summaries: await listCompanySummaries(productStore),
          });
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
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
        const companyId = decodeURIComponent(companyControlRoomMatch[1]);
        await syncRunningCompanyExecution({ productStore, executionService, companyId });
        const detail = await getCompanyDetail(productStore, companyId);
        sendJson(
          res,
          detail ? 200 : 404,
          detail ? { controlRoom: detail.controlRoom } : { error: "not_found" },
        );
        return;
      }

      const companyAuditMatch = /^\/api\/oui\/companies\/([^/]+)\/audit$/.exec(url.pathname);
      if (req.method === "GET" && companyAuditMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(companyAuditMatch[1]);
        const company = await productStore.getCompany(companyId);
        if (!company) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        sendJson(res, 200, { auditLog: await productStore.listAuditLog(companyId, 120) });
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
          await productStore.recordAuditLog({
            actorType: "owner",
            actorId: "user",
            companyId,
            entityType: "runbook_version",
            entityId: result.version.id,
            action: "runbook.draft_created",
            details: {
              runbookId: result.runbook.id,
              operatingMode: result.version.operatingMode,
              sourceType,
            },
          });
          sendJson(res, 201, result);
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const companyRoutinesMatch = /^\/api\/oui\/companies\/([^/]+)\/routines$/.exec(url.pathname);
      if (companyRoutinesMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        if (!flags.ouiRoutinesEnabled) {
          sendJson(res, 403, { error: "routines_disabled" });
          return;
        }
        const companyId = decodeURIComponent(companyRoutinesMatch[1]);
        const company = await productStore.getCompany(companyId);
        if (!company) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        if (req.method === "GET") {
          sendJson(res, 200, { routines: await productStore.listRoutines(companyId) });
          return;
        }
        if (req.method === "POST") {
          const body = asObject(await readRequestBody(req));
          const runbookVersionId =
            optionalString(body.runbookVersionId) ?? optionalString(body.versionId);
          const title = optionalString(body.title);
          if (!runbookVersionId || !title) {
            sendJson(res, 400, { error: "invalid_routine_input" });
            return;
          }
          const triggerKind = ROUTINE_TRIGGER_KINDS.has(body.triggerKind as OuiRoutineTriggerKind)
            ? (body.triggerKind as OuiRoutineTriggerKind)
            : "schedule";
          const concurrencyPolicy = ROUTINE_CONCURRENCY_POLICIES.has(
            body.concurrencyPolicy as OuiRoutineConcurrencyPolicy,
          )
            ? (body.concurrencyPolicy as OuiRoutineConcurrencyPolicy)
            : "skip_if_active";
          const status = ROUTINE_STATUSES.has(body.status as OuiRoutineStatus)
            ? (body.status as OuiRoutineStatus)
            : "active";
          const routine = await productStore.createRoutine({
            id: optionalString(body.id) ?? undefined,
            companyId,
            runbookVersionId,
            title,
            description: optionalString(body.description),
            triggerKind,
            schedule: asObject(body.schedule),
            concurrencyPolicy,
            status,
          });
          await productStore.recordAuditLog({
            actorType: "owner",
            actorId: "user",
            companyId,
            entityType: "routine",
            entityId: routine.id,
            action: "routine.created",
            details: {
              runbookVersionId,
              triggerKind,
              concurrencyPolicy,
            },
          });
          const detail = await getCompanyDetail(productStore, companyId);
          sendJson(res, 201, { routine, detail });
          return;
        }
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const routineTriggersMatch = /^\/api\/oui\/routines\/([^/]+)\/triggers$/.exec(url.pathname);
      if (req.method === "GET" && routineTriggersMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        if (!flags.ouiRoutinesEnabled) {
          sendJson(res, 403, { error: "routines_disabled" });
          return;
        }
        const routineId = decodeURIComponent(routineTriggersMatch[1]);
        const routine = await productStore.getRoutine(routineId);
        if (!routine) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        sendJson(res, 200, { triggers: await productStore.listRoutineTriggers(routineId) });
        return;
      }

      const routineTriggerMatch = /^\/api\/oui\/routines\/([^/]+)\/trigger$/.exec(url.pathname);
      if (req.method === "POST" && routineTriggerMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        if (!flags.ouiRoutinesEnabled) {
          sendJson(res, 403, { error: "routines_disabled" });
          return;
        }
        if (!executionService) {
          sendJson(res, 404, { error: "oui_execution_service_unavailable" });
          return;
        }
        const body = asObject(await readRequestBody(req));
        const triggerKind = ROUTINE_TRIGGER_KINDS.has(body.triggerKind as OuiRoutineTriggerKind)
          ? (body.triggerKind as OuiRoutineTriggerKind)
          : "manual";
        const result = await executionService.triggerRoutine({
          routineId: decodeURIComponent(routineTriggerMatch[1]),
          triggerKind,
          payload: asObject(body.payload),
          actorId: optionalString(body.actorId) ?? "user",
        });
        await productStore.recordAuditLog({
          actorType: "owner",
          actorId: optionalString(body.actorId) ?? "user",
          companyId: result.routine.companyId,
          entityType: "routine",
          entityId: result.routine.id,
          action: "routine.triggered",
          details: {
            triggerId: result.trigger.id,
            triggerStatus: result.trigger.status,
            triggerKind,
          },
        });
        const wakeupDispatches = result.wakeup
          ? await executionService.drainWorkWakeups({ maxWakeups: 6 })
          : [];
        const detail = await getCompanyDetail(productStore, result.routine.companyId);
        sendJson(res, 200, {
          ...result,
          wakeupDispatches,
          execution: wakeupDispatches.at(-1)?.advance ?? null,
          detail,
          controlRoom: detail?.controlRoom ?? null,
        });
        return;
      }

      const routineStatusMatch = /^\/api\/oui\/routines\/([^/]+)\/(pause|resume|disable)$/.exec(
        url.pathname,
      );
      if (req.method === "POST" && routineStatusMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        if (!flags.ouiRoutinesEnabled) {
          sendJson(res, 403, { error: "routines_disabled" });
          return;
        }
        const status: OuiRoutineStatus =
          routineStatusMatch[2] === "resume"
            ? "active"
            : routineStatusMatch[2] === "disable"
              ? "disabled"
              : "paused";
        const routine = await productStore.updateRoutineStatus({
          routineId: decodeURIComponent(routineStatusMatch[1]),
          status,
        });
        await productStore.recordAuditLog({
          actorType: "owner",
          actorId: "user",
          companyId: routine.companyId,
          entityType: "routine",
          entityId: routine.id,
          action: `routine.${status}`,
          details: { status },
        });
        const detail = await getCompanyDetail(productStore, routine.companyId);
        sendJson(res, 200, { routine, detail });
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

      const companyArtifactsMatch = /^\/api\/oui\/companies\/([^/]+)\/artifacts$/.exec(
        url.pathname,
      );
      if (req.method === "GET" && companyArtifactsMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const companyId = decodeURIComponent(companyArtifactsMatch[1]);
        if (!(await productStore.getCompany(companyId))) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        sendJson(res, 200, { artifacts: await productStore.listArtifacts({ companyId }) });
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
        await productStore.recordAuditLog({
          actorType: "owner",
          actorId: optionalString(body.startedBy) ?? "user",
          companyId: result.company.id,
          entityType: "runbook_version",
          entityId: result.version.id,
          action: "runbook.started",
          details: {
            runbookId: result.runbook.id,
            workNodeCount: result.workNodes.length,
          },
        });
        const wakeup = executionService
          ? await executionService.enqueueCompanyWakeup({
              id: `wakeup:${result.version.id}:start`,
              companyId: result.company.id,
              reason: "runbook_started",
              runbookVersionId: result.version.id,
              payload: { startedBy: optionalString(body.startedBy) ?? "user" },
            })
          : null;
        const wakeupDispatches = executionService
          ? await executionService.drainWorkWakeups({ maxWakeups: 6 })
          : [];
        const execution = wakeupDispatches.at(-1)?.advance ?? null;
        const detail = await getCompanyDetail(productStore, result.company.id);
        sendJson(res, 200, {
          ...result,
          wakeup,
          wakeupDispatches,
          execution,
          company: detail?.company ?? result.company,
          version: detail?.activeRunbookVersion ?? result.version,
          workNodes: detail?.workNodes ?? result.workNodes,
          detail,
          controlRoom: detail?.controlRoom ?? null,
        });
        return;
      }

      const runWorkNodeMatch = /^\/api\/oui\/work-nodes\/([^/]+)\/run$/.exec(url.pathname);
      if (req.method === "POST" && runWorkNodeMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        const nodeId = decodeURIComponent(runWorkNodeMatch[1]);
        const node = await productStore.getWorkNode(nodeId);
        if (!node) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        if (node.status === "done" || node.status === "skipped") {
          sendJson(res, 409, { error: "work_node_already_closed" });
          return;
        }
        if (executionService) {
          const wakeup = await executionService.enqueueCompanyWakeup({
            id: `wakeup:${node.id}:requested`,
            companyId: node.companyId,
            reason: "work_node_requested",
            runbookVersionId: node.runbookVersionId,
            workNodeId: node.id,
            payload: {
              requestedBy: optionalString(body.requestedBy) ?? "user",
              message: optionalString(body.message),
              sessionKey: optionalString(body.sessionKey),
            },
          });
          const wakeupDispatches = await executionService.drainWorkWakeups({ maxWakeups: 3 });
          const latestNode = await productStore.getWorkNode(node.id);
          const latestRun = latestNode?.runId ? await options.store.getRun(latestNode.runId) : null;
          const detail = await getCompanyDetail(productStore, node.companyId);
          sendJson(res, latestRun && isTerminalRunStatus(latestRun.status) ? 200 : 202, {
            node: latestNode,
            run: latestRun,
            wakeup,
            wakeupDispatches,
            execution: wakeupDispatches.at(-1)?.advance ?? null,
            detail,
            controlRoom: detail?.controlRoom ?? null,
          });
          return;
        }
        const [company, version, agents] = await Promise.all([
          productStore.getCompany(node.companyId),
          productStore.getRunbookVersion(node.runbookVersionId),
          productStore.listAgents(node.companyId),
        ]);
        if (!company || !version) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        if (node.status === "running") {
          const latestNode = await productStore.getWorkNode(node.id);
          const latestRun = latestNode?.runId ? await options.store.getRun(latestNode.runId) : null;
          const detail = await getCompanyDetail(productStore, company.id);
          sendJson(res, latestRun && isTerminalRunStatus(latestRun.status) ? 200 : 202, {
            node: latestNode,
            run: latestRun,
            execution: null,
            detail,
            controlRoom: detail?.controlRoom ?? null,
          });
          return;
        }
        const agent = resolveWorkNodeAgent({ company, node, agents });
        if (!agent || agent.status !== "active") {
          await productStore.updateWorkNodeRunState({
            nodeId: node.id,
            status: "blocked",
            summary: "No active agent is available for this work node.",
          });
          const detail = await getCompanyDetail(productStore, company.id);
          sendJson(res, 409, {
            error: "no_active_agent",
            detail,
            controlRoom: detail?.controlRoom ?? null,
          });
          return;
        }

        const adapter = options.registry.require(agent.adapterId);
        const policy = evaluateAdapterExecutionPolicy({
          adapter,
          flags,
          allowlist: options.adapterAllowlist,
        });
        if (!policy.allowed) {
          await productStore.updateWorkNodeRunState({
            nodeId: node.id,
            status: "blocked",
            summary: policy.message,
            output: { policyCode: policy.code },
          });
          const detail = await getCompanyDetail(productStore, company.id);
          sendJson(res, 403, {
            error: policy.code,
            message: policy.message,
            detail,
            controlRoom: detail?.controlRoom ?? null,
          });
          return;
        }

        const sessionKey =
          optionalString(body.sessionKey) ??
          (agent.adapterKind === "openclaw" ? openClawMainSessionKey(agent) : "main");
        const message =
          optionalString(body.message) ??
          buildWorkNodeRunMessage({ company, agent, version, node });
        const run = await options.store.enqueueRun({
          id:
            optionalString(body.runId) ??
            `${node.id}:run:${new Date().toISOString().replace(/[^0-9a-zA-Z]+/g, "")}`,
          adapterId: adapter.id,
          adapterKind: agent.adapterKind,
          agentId: agent.id,
          sessionKey,
          input: {
            sessionKey,
            message,
            companyId: company.id,
            workNodeId: node.id,
            runbookVersionId: version.id,
            objective: version.objective,
            stage: asObject(node.input.stage),
          },
          maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : 1,
        });
        await productStore.updateWorkNodeRunState({
          nodeId: node.id,
          status: "running",
          runId: run.id,
          summary: "Work node dispatched to its assigned agent.",
          output: { runId: run.id },
        });
        const dispatch = await dispatcher.dispatchRun(run.id);
        const latestRun =
          dispatch.status === "finished" || dispatch.status === "blocked"
            ? dispatch.run
            : await options.store.getRun(run.id);
        if (latestRun?.status === "succeeded") {
          const completed = await productStore.completeWorkNode({
            nodeId: node.id,
            completedBy: agent.id,
            summary: runSummary(latestRun),
            output: {
              runId: latestRun.id,
              runStatus: latestRun.status,
              result: latestRun.result ?? {},
            },
          });
          const detail = await getCompanyDetail(productStore, company.id);
          sendJson(res, 200, {
            ...completed,
            run: latestRun,
            dispatch,
            execution: null,
            detail,
            controlRoom: detail?.controlRoom ?? null,
          });
          return;
        }
        if (latestRun && isTerminalRunStatus(latestRun.status)) {
          const blockedNode = await productStore.updateWorkNodeRunState({
            nodeId: node.id,
            status: "blocked",
            runId: latestRun.id,
            summary: runSummary(latestRun),
            output: {
              runId: latestRun.id,
              runStatus: latestRun.status,
              result: latestRun.result ?? {},
              error: latestRun.error ?? null,
            },
          });
          const detail = await getCompanyDetail(productStore, company.id);
          sendJson(res, 200, {
            node: blockedNode,
            run: latestRun,
            dispatch,
            detail,
            controlRoom: detail?.controlRoom ?? null,
          });
          return;
        }
        const detail = await getCompanyDetail(productStore, company.id);
        sendJson(res, 202, {
          node: await productStore.getWorkNode(node.id),
          run: latestRun ?? run,
          dispatch,
          detail,
          controlRoom: detail?.controlRoom ?? null,
        });
        return;
      }

      const completeWorkNodeMatch = /^\/api\/oui\/work-nodes\/([^/]+)\/complete$/.exec(
        url.pathname,
      );
      if (req.method === "POST" && completeWorkNodeMatch) {
        const productStore = requireProductStore(options.productStore, res);
        if (!productStore) {
          return;
        }
        const body = asObject(await readRequestBody(req));
        const result = await productStore.completeWorkNode({
          nodeId: decodeURIComponent(completeWorkNodeMatch[1]),
          completedBy: optionalString(body.completedBy) ?? "user",
          summary: optionalString(body.summary),
          output: asObject(body.output),
        });
        const wakeup = executionService
          ? await executionService.enqueueCompanyWakeup({
              id: `wakeup:${result.node.id}:completed`,
              companyId: result.company.id,
              reason: "work_node_requested",
              runbookVersionId: result.version.id,
              workNodeId: result.nextNode?.id ?? result.node.id,
              payload: { completedNodeId: result.node.id },
            })
          : null;
        const wakeupDispatches = executionService
          ? await executionService.drainWorkWakeups({ maxWakeups: 4 })
          : [];
        const execution = wakeupDispatches.at(-1)?.advance ?? null;
        const detail = await getCompanyDetail(productStore, result.company.id);
        sendJson(res, 200, {
          ...result,
          wakeup,
          wakeupDispatches,
          execution,
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
        await productStore.recordAuditLog({
          actorType: "owner",
          actorId: optionalString(body.approvedBy) ?? "user",
          companyId: version.companyId,
          entityType: "runbook_version",
          entityId: version.id,
          action: "runbook.approved",
          details: { runbookId: version.runbookId },
        });
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
        const itemId = decodeURIComponent(resolveInboxMatch[1]);
        const result: OuiExecutionInboxResult = executionService
          ? await executionService.resolveInboxAndAdvance({
              itemId,
              action: action as OuiInboxResolutionAction,
              responseText: optionalString(body.responseText),
              actorId: optionalString(body.actorId) ?? "user",
            })
          : {
              item: await productStore.resolveInboxItem({
                itemId,
                action: action as OuiInboxResolutionAction,
                responseText: optionalString(body.responseText),
                actorId: optionalString(body.actorId) ?? "user",
              }),
              completedNode: null,
              advance: null,
            };
        const wakeupDispatches =
          executionService && result.wakeup
            ? await executionService.drainWorkWakeups({ maxWakeups: 6 })
            : [];
        if (executionService && result.wakeup && !result.advance) {
          result.advance = wakeupDispatches.at(-1)?.advance ?? null;
        }
        await productStore.recordAuditLog({
          actorType: "owner",
          actorId: optionalString(body.actorId) ?? "user",
          companyId: result.item.companyId,
          entityType: "inbox_item",
          entityId: result.item.id,
          action: `inbox.${action}`,
          details: {
            itemType: result.item.itemType,
            wakeupId: result.wakeup?.id ?? null,
            stopReason: result.advance?.stopReason ?? null,
          },
        });
        const detail = await getCompanyDetail(productStore, result.item.companyId);
        sendJson(res, 200, {
          ...result,
          wakeupDispatches,
          detail,
          controlRoom: detail?.controlRoom ?? null,
        });
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
        if (result.status !== "queued") {
          sendJson(res, 409, result);
          return;
        }
        if (body.dispatch === false) {
          sendJson(res, 202, result);
          return;
        }
        const dispatch = await dispatcher.dispatchRun(result.run.id);
        const run =
          dispatch.status === "finished" || dispatch.status === "blocked"
            ? dispatch.run
            : ((await options.store.getRun(result.run.id)) ?? result.run);
        if (isTerminalRunStatus(run.status)) {
          await service.recordRunCostFromResult(result.task.id, run);
          if (options.productStore) {
            await options.productStore.updateTaskStatus(
              result.task.id,
              run.status === "succeeded" ? "review" : "blocked",
            );
          }
        }
        sendJson(res, isTerminalRunStatus(run.status) ? 200 : 202, {
          ...result,
          run,
          dispatch,
        });
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

      const dispatchRunMatch = /^\/api\/oui\/runs\/([^/]+)\/dispatch$/.exec(url.pathname);
      if (req.method === "POST" && dispatchRunMatch) {
        const runId = decodeURIComponent(dispatchRunMatch[1]);
        const dispatch = await dispatcher.dispatchRun(runId);
        const run =
          dispatch.status === "finished" || dispatch.status === "blocked"
            ? dispatch.run
            : await options.store.getRun(runId);
        sendJson(res, run ? 200 : 404, run ? { run, dispatch } : { error: "not_found" });
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

  return {
    flags,
    handle,
    close() {
      if (backgroundDrain) {
        clearInterval(backgroundDrain);
      }
    },
  };
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
          runtime.close?.();
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
