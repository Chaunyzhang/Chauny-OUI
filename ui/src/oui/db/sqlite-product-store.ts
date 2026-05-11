import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  OuiAgentRecord,
  OuiAgentStatus,
  OuiAppendMeetingMessageInput,
  OuiArtifactRecord,
  OuiAuditLogRecord,
  OuiCompanyRecord,
  OuiCompanyStatus,
  OuiConversationRecord,
  OuiConversationStatus,
  OuiCostEventRecord,
  OuiAppendMessageInput,
  OuiCreateAgentInput,
  OuiMeetingDiscussionState,
  OuiMeetingModeratorDocument,
  OuiMeetingRoundRecord,
  OuiCreateArtifactInput,
  OuiCreateCompanyInput,
  OuiCreateInboxItemInput,
  OuiCreateMeetingInput,
  OuiCreateRoutineInput,
  OuiCreateRoutineTriggerInput,
  OuiCompleteWorkNodeInput,
  OuiCompleteWorkNodeResult,
  OuiCreateRunbookDraftInput,
  OuiCreateRunbookDraftResult,
  OuiCreateTaskInput,
  OuiGetOrCreateConversationInput,
  OuiInboxItemRecord,
  OuiInboxItemStatus,
  OuiListArtifactsFilter,
  OuiMeetingMessageRecord,
  OuiMeetingRecord,
  OuiMeetingStatus,
  OuiMessageRecord,
  OuiMessageRole,
  OuiProductStore,
  OuiRecordAuditLogInput,
  OuiResolveInboxItemInput,
  OuiRoleRecord,
  OuiRoutineRecord,
  OuiRoutineTriggerRecord,
  OuiRunbookRecord,
  OuiRunbookStatus,
  OuiRunbookVersionRecord,
  OuiStartRunbookVersionResult,
  OuiTaskDependencyRecord,
  OuiTaskReadiness,
  OuiTaskRecord,
  OuiTaskReviewState,
  OuiTaskRunLink,
  OuiTaskStatus,
  OuiUpdateMeetingParticipantsInput,
  OuiUpdateMeetingDiscussionInput,
  OuiUpdateMeetingStatusInput,
  OuiUpdateRoutineStatusInput,
  OuiMarkRoutineTriggeredInput,
  OuiUpdateWorkNodeRunStateInput,
  OuiClaimWorkWakeupInput,
  OuiEnqueueWorkWakeupInput,
  OuiFinishWorkWakeupInput,
  OuiHeartbeatWorkWakeupInput,
  OuiRecoverWorkWakeupsInput,
  OuiWorkWakeupLease,
  OuiWorkWakeupRecord,
  OuiWorkWakeupStatus,
  OuiWorkNodeRecord,
  OuiWorkNodeStatus,
} from "../shared/product-types.ts";
import type { OuiAdapterKind, OuiJsonObject } from "../shared/types.ts";
import { runOuiMigrations } from "./migrations.ts";

type SqlValue = null | number | string;
type SqlRow = Record<string, unknown>;

function toIsoDate(now: Date | undefined): string {
  return (now ?? new Date()).toISOString();
}

function parseJsonObject(value: unknown): OuiJsonObject {
  if (typeof value !== "string" || !value) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as OuiJsonObject)
    : {};
}

function parseJsonObjectArray(value: unknown): OuiJsonObject[] {
  if (typeof value !== "string" || !value) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter(
        (entry): entry is OuiJsonObject =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalMeetingThinkingIntensity(
  value: unknown,
): OuiMeetingRecord["participants"][number]["thinkingIntensity"] {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function createMeetingDiscussionState(input: {
  title: string;
  objective?: string | null;
  createdAt: string;
}): OuiMeetingDiscussionState {
  const text = [
    `Meeting topic: ${input.title}`,
    input.objective ? `Context: ${input.objective}` : null,
    "",
    "Carry the discussion forward by preserving useful disagreement, correcting weak claims, and refining the current best answer.",
  ]
    .filter((line): line is string => line != null)
    .join("\n");
  return {
    phase: "drafting",
    currentRound: 0,
    activeDocument: {
      round: 0,
      text,
      updatedAt: input.createdAt,
      updatedBy: "seed",
    },
    roundHistory: [],
  };
}

function parseMeetingModeratorDocument(
  value: unknown,
  fallback: OuiMeetingModeratorDocument,
): OuiMeetingModeratorDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  return {
    round: optionalNumber((value as Record<string, unknown>).round) ?? fallback.round,
    text: optionalString((value as Record<string, unknown>).text) ?? fallback.text,
    updatedAt: optionalString((value as Record<string, unknown>).updatedAt) ?? fallback.updatedAt,
    updatedBy:
      (optionalString((value as Record<string, unknown>).updatedBy) as
        | OuiMeetingModeratorDocument["updatedBy"]
        | null) ?? fallback.updatedBy,
  };
}

function parseMeetingRoundHistory(value: unknown): OuiMeetingRoundRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const history: OuiMeetingRoundRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const round = optionalNumber(record.round);
    const sourceDocumentText = optionalString(record.sourceDocumentText);
    const createdAt = optionalString(record.createdAt);
    if (round == null || !sourceDocumentText || !createdAt) {
      continue;
    }
    history.push({
      round,
      sourceDocumentText,
      participantMessageIds: Array.isArray(record.participantMessageIds)
        ? record.participantMessageIds.filter(
            (messageId): messageId is string =>
              typeof messageId === "string" && messageId.trim().length > 0,
          )
        : [],
      moderatorMessageId: optionalString(record.moderatorMessageId),
      createdAt,
    });
  }
  return history;
}

function parseMeetingDiscussion(
  value: unknown,
  fallback: OuiMeetingDiscussionState,
): OuiMeetingDiscussionState {
  if (typeof value !== "string" || !value) {
    return fallback;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fallback;
  }
  const record = parsed as Record<string, unknown>;
  return {
    phase:
      (optionalString(record.phase) as OuiMeetingDiscussionState["phase"] | null) ?? fallback.phase,
    currentRound: optionalNumber(record.currentRound) ?? fallback.currentRound,
    activeDocument: parseMeetingModeratorDocument(record.activeDocument, fallback.activeDocument),
    roundHistory: parseMeetingRoundHistory(record.roundHistory),
  };
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }
  return value;
}

function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") {
    throw new Error(`Expected number column: ${key}`);
  }
  return value;
}

function runChanges(result: unknown): number {
  if (result && typeof result === "object" && "changes" in result) {
    const changes = (result as { changes?: unknown }).changes;
    return typeof changes === "number" ? changes : 0;
  }
  return 0;
}

function readCompany(row: SqlRow): OuiCompanyRecord {
  return {
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    description: optionalString(row.description),
    mode: (optionalString(row.mode) ?? "project") as OuiCompanyRecord["mode"],
    status: (optionalString(row.status) ?? "idle") as OuiCompanyStatus,
    ceoAgentId: optionalString(row.ceo_agent_id),
    defaultLeaderAgentId: optionalString(row.default_leader_agent_id),
    currentRunbookVersionId: optionalString(row.current_runbook_version_id),
    currentObjective: optionalString(row.current_objective),
    currentStage: optionalString(row.current_stage),
    autonomyPolicy: parseJsonObject(row.autonomy_policy_json),
    reportingPreference: parseJsonObject(row.reporting_preference_json),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readRole(row: SqlRow): OuiRoleRecord {
  return {
    id: requiredString(row, "id"),
    companyId: requiredString(row, "company_id"),
    name: requiredString(row, "name"),
    parentRoleId: optionalString(row.parent_role_id),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readAgent(row: SqlRow): OuiAgentRecord {
  return {
    id: requiredString(row, "id"),
    companyId: requiredString(row, "company_id"),
    adapterId: requiredString(row, "adapter_id"),
    adapterKind: requiredString(row, "adapter_kind") as OuiAdapterKind,
    label: requiredString(row, "label"),
    roleId: optionalString(row.role_id),
    reportsToAgentId: optionalString(row.reports_to_agent_id),
    openclawAgentId: optionalString(row.openclaw_agent_id),
    modelRef: optionalString(row.model_ref),
    status: requiredString(row, "status") as OuiAgentStatus,
    isLeader: requiredNumber(row, "is_leader") === 1,
    config: parseJsonObject(row.config_json),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readConversation(row: SqlRow): OuiConversationRecord {
  return {
    id: requiredString(row, "id"),
    companyId: requiredString(row, "company_id"),
    ceoAgentId: optionalString(row.ceo_agent_id),
    title: optionalString(row.title),
    summary: optionalString(row.summary),
    status: requiredString(row, "status") as OuiConversationStatus,
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readMessage(row: SqlRow): OuiMessageRecord {
  return {
    id: requiredString(row, "id"),
    conversationId: requiredString(row, "conversation_id"),
    companyId: requiredString(row, "company_id"),
    role: requiredString(row, "role") as OuiMessageRole,
    content: requiredString(row, "content"),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: requiredString(row, "created_at"),
  };
}

function readTask(row: SqlRow): OuiTaskRecord {
  return {
    id: requiredString(row, "id"),
    companyId: requiredString(row, "company_id"),
    title: requiredString(row, "title"),
    description: optionalString(row.description),
    status: requiredString(row, "status") as OuiTaskStatus,
    reviewState: requiredString(row, "review_state") as OuiTaskReviewState,
    assignedAgentId: optionalString(row.assigned_agent_id),
    createdBy: optionalString(row.created_by),
    priority: requiredNumber(row, "priority"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readDependency(row: SqlRow): OuiTaskDependencyRecord {
  return {
    taskId: requiredString(row, "task_id"),
    dependsOnTaskId: requiredString(row, "depends_on_task_id"),
    createdAt: requiredString(row, "created_at"),
  };
}

function readTaskRunLink(row: SqlRow): OuiTaskRunLink {
  return {
    taskId: requiredString(row, "task_id"),
    runId: requiredString(row, "run_id"),
    kind: requiredString(row, "kind") as OuiTaskRunLink["kind"],
    createdAt: requiredString(row, "created_at"),
  };
}

function readCostEvent(row: SqlRow): OuiCostEventRecord {
  return {
    id: requiredString(row, "id"),
    runId: optionalString(row.run_id),
    taskId: optionalString(row.task_id),
    agentId: optionalString(row.agent_id),
    amountMicros: optionalNumber(row.amount_micros),
    currency: optionalString(row.currency),
    usage: parseJsonObject(row.usage_json),
    source: requiredString(row, "source"),
    createdAt: requiredString(row, "created_at"),
  };
}

function readRunbook(row: SqlRow): OuiRunbookRecord {
  return {
    id: requiredString(row, "id"),
    companyId: requiredString(row, "company_id"),
    title: requiredString(row, "title"),
    status: requiredString(row, "status") as OuiRunbookStatus,
    activeVersionId: optionalString(row.active_version_id),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readRunbookVersion(row: SqlRow): OuiRunbookVersionRecord {
  return {
    id: requiredString(row, "id"),
    runbookId: requiredString(row, "runbook_id"),
    companyId: requiredString(row, "company_id"),
    version: requiredNumber(row, "version"),
    sourceType: requiredString(row, "source_type") as OuiRunbookVersionRecord["sourceType"],
    sourceRef: optionalString(row.source_ref),
    status: requiredString(row, "status") as OuiRunbookStatus,
    objective: requiredString(row, "objective"),
    operatingMode: requiredString(
      row,
      "operating_mode",
    ) as OuiRunbookVersionRecord["operatingMode"],
    stages: parseJsonObjectArray(row.stages_json),
    decisionPoints: parseJsonObjectArray(row.decision_points_json),
    artifactPolicy: parseJsonObject(row.artifact_policy_json),
    pausePolicy: parseJsonObject(row.pause_policy_json),
    reportPolicy: parseJsonObject(row.report_policy_json),
    markdownPath: optionalString(row.markdown_path),
    approvedBy: optionalString(row.approved_by),
    approvedAt: optionalString(row.approved_at),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function routineIntervalMs(schedule: OuiJsonObject): number | null {
  const intervalMinutes = schedule.intervalMinutes;
  if (typeof intervalMinutes === "number" && Number.isFinite(intervalMinutes)) {
    return Math.max(1, intervalMinutes) * 60_000;
  }
  const intervalMs = schedule.intervalMs;
  if (typeof intervalMs === "number" && Number.isFinite(intervalMs)) {
    return Math.max(1_000, intervalMs);
  }
  return null;
}

function nextRoutineTriggerAt(schedule: OuiJsonObject, now: Date): string | null {
  const intervalMs = routineIntervalMs(schedule);
  return intervalMs ? new Date(now.getTime() + intervalMs).toISOString() : null;
}

function readRoutine(row: SqlRow): OuiRoutineRecord {
  return {
    id: requiredString(row, "id"),
    companyId: requiredString(row, "company_id"),
    runbookVersionId: requiredString(row, "runbook_version_id"),
    title: requiredString(row, "title"),
    description: optionalString(row.description),
    status: requiredString(row, "status") as OuiRoutineRecord["status"],
    triggerKind: requiredString(row, "trigger_kind") as OuiRoutineRecord["triggerKind"],
    schedule: parseJsonObject(row.schedule_json),
    concurrencyPolicy: requiredString(
      row,
      "concurrency_policy",
    ) as OuiRoutineRecord["concurrencyPolicy"],
    lastTriggeredAt: optionalString(row.last_triggered_at),
    nextTriggerAt: optionalString(row.next_trigger_at),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readRoutineTrigger(row: SqlRow): OuiRoutineTriggerRecord {
  return {
    id: requiredString(row, "id"),
    routineId: requiredString(row, "routine_id"),
    companyId: requiredString(row, "company_id"),
    runbookVersionId: requiredString(row, "runbook_version_id"),
    triggerKind: requiredString(row, "trigger_kind") as OuiRoutineTriggerRecord["triggerKind"],
    status: requiredString(row, "status") as OuiRoutineTriggerRecord["status"],
    payload: parseJsonObject(row.payload_json),
    error: optionalString(row.error),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readWorkNode(row: SqlRow): OuiWorkNodeRecord {
  return {
    id: requiredString(row, "id"),
    companyId: requiredString(row, "company_id"),
    runbookVersionId: requiredString(row, "runbook_version_id"),
    stageId: requiredString(row, "stage_id"),
    title: requiredString(row, "title"),
    nodeType: requiredString(row, "node_type"),
    status: requiredString(row, "status") as OuiWorkNodeStatus,
    assignedAgentId: optionalString(row.assigned_agent_id),
    orderIndex: requiredNumber(row, "order_index"),
    summary: optionalString(row.summary),
    input: parseJsonObject(row.input_json),
    output: parseJsonObject(row.output_json),
    runId: optionalString(row.run_id),
    inboxItemId: optionalString(row.inbox_item_id),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readInboxItem(row: SqlRow): OuiInboxItemRecord {
  return {
    id: requiredString(row, "id"),
    companyId: requiredString(row, "company_id"),
    itemType: requiredString(row, "item_type") as OuiInboxItemRecord["itemType"],
    status: requiredString(row, "status") as OuiInboxItemStatus,
    title: requiredString(row, "title"),
    summary: optionalString(row.summary),
    runbookVersionId: optionalString(row.runbook_version_id),
    taskId: optionalString(row.task_id),
    runId: optionalString(row.run_id),
    payload: parseJsonObject(row.payload_json),
    resolution: row.resolution_json ? parseJsonObject(row.resolution_json) : null,
    createdBy: optionalString(row.created_by),
    resolvedBy: optionalString(row.resolved_by),
    resolvedAt: optionalString(row.resolved_at),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readWorkWakeup(row: SqlRow): OuiWorkWakeupRecord {
  return {
    id: requiredString(row, "id"),
    companyId: requiredString(row, "company_id"),
    runbookVersionId: optionalString(row.runbook_version_id),
    workNodeId: optionalString(row.work_node_id),
    agentId: optionalString(row.agent_id),
    reason: requiredString(row, "reason") as OuiWorkWakeupRecord["reason"],
    status: requiredString(row, "status") as OuiWorkWakeupStatus,
    payload: parseJsonObject(row.payload_json),
    attempts: requiredNumber(row, "attempts"),
    maxAttempts: requiredNumber(row, "max_attempts"),
    leaseOwner: optionalString(row.lease_owner),
    leaseToken: optionalString(row.lease_token),
    leaseExpiresAt: optionalString(row.lease_expires_at),
    heartbeatAt: optionalString(row.heartbeat_at),
    queuedAt: requiredString(row, "queued_at"),
    startedAt: optionalString(row.started_at),
    finishedAt: optionalString(row.finished_at),
    error: optionalString(row.error),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function parseMeetingParticipants(value: unknown): OuiMeetingRecord["participants"] {
  const participants: OuiMeetingRecord["participants"] = [];
  for (const entry of parseJsonObjectArray(value)) {
    const id = optionalString(entry.id);
    const label = optionalString(entry.label);
    const adapterKind = optionalString(entry.adapterKind);
    if (!id || !label || !adapterKind) {
      continue;
    }
    participants.push({
      id,
      label,
      adapterKind: adapterKind as OuiMeetingRecord["participants"][number]["adapterKind"],
      adapterId: optionalString(entry.adapterId),
      agentId: optionalString(entry.agentId),
      openclawAgentId: optionalString(entry.openclawAgentId),
      modelRef: optionalString(entry.modelRef),
      role: optionalString(entry.role),
      muted: optionalBoolean(entry.muted),
      speakingOrder: optionalNumber(entry.speakingOrder),
      thinkingIntensity: optionalMeetingThinkingIntensity(entry.thinkingIntensity),
    });
  }
  return participants;
}

function readArtifact(row: SqlRow): OuiArtifactRecord {
  return {
    id: requiredString(row, "id"),
    companyId: optionalString(row.company_id),
    meetingId: optionalString(row.meeting_id),
    runId: optionalString(row.run_id),
    kind: requiredString(row, "artifact_type") as OuiArtifactRecord["kind"],
    title: requiredString(row, "title"),
    summary: optionalString(row.summary),
    path: optionalString(row.path),
    contentType: optionalString(row.content_type) ?? "application/json",
    content: parseJsonObject(row.content_json),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function readAuditLog(row: SqlRow): OuiAuditLogRecord {
  return {
    id: requiredString(row, "id"),
    actorType: requiredString(row, "actor_type"),
    actorId: requiredString(row, "actor_id"),
    companyId: optionalString(row.company_id),
    entityType: requiredString(row, "entity_type"),
    entityId: requiredString(row, "entity_id"),
    action: requiredString(row, "action"),
    details: parseJsonObject(row.details_json),
    createdAt: requiredString(row, "created_at"),
  };
}

function readMeeting(row: SqlRow): OuiMeetingRecord {
  const createdAt = requiredString(row, "created_at");
  const title = requiredString(row, "title");
  const objective = optionalString(row.objective);
  const fallbackDiscussion = createMeetingDiscussionState({ title, objective, createdAt });
  return {
    id: requiredString(row, "id"),
    title,
    objective,
    status: requiredString(row, "status") as OuiMeetingStatus,
    participants: parseMeetingParticipants(row.participants_json),
    discussion: parseMeetingDiscussion(row.discussion_json, fallbackDiscussion),
    minutesArtifactId: optionalString(row.minutes_artifact_id),
    createdAt,
    updatedAt: requiredString(row, "updated_at"),
    startedAt: optionalString(row.started_at),
    endedAt: optionalString(row.ended_at),
  };
}

function readMeetingMessage(row: SqlRow): OuiMeetingMessageRecord {
  return {
    id: requiredString(row, "id"),
    meetingId: requiredString(row, "meeting_id"),
    role: requiredString(row, "role") as OuiMeetingMessageRecord["role"],
    participantId: optionalString(row.participant_id),
    content: requiredString(row, "content"),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: requiredString(row, "created_at"),
  };
}

export class OuiSqliteProductStore implements OuiProductStore {
  constructor(private readonly db: DatabaseSync) {
    runOuiMigrations(db);
  }

  async listCompanies(): Promise<OuiCompanyRecord[]> {
    return this.getAll(
      `
        SELECT * FROM oui_companies
        ORDER BY
          CASE status
            WHEN 'waiting_user' THEN 0
            WHEN 'running' THEN 1
            WHEN 'blocked' THEN 2
            WHEN 'paused' THEN 3
            ELSE 4
          END,
          updated_at DESC,
          name ASC
      `,
    ).map(readCompany);
  }

  async createCompany(input: OuiCreateCompanyInput) {
    const name = input.name.trim();
    const openclawAgentId = input.openclawCeo.openclawAgentId.trim();
    if (!name) {
      throw new Error("OUI company name is required.");
    }
    if (!input.openclawCeo.label.trim() || !openclawAgentId) {
      throw new Error("OUI company CEO must be an OpenClaw agent.");
    }

    const now = toIsoDate(input.now);
    const companyId = input.id ?? randomUUID();
    return this.transaction(() => {
      if (this.getCompanySync(companyId)) {
        throw new Error(`OUI company already exists: ${companyId}`);
      }
      this.run(
        `
          INSERT INTO oui_companies(
            id, name, description, mode, status, autonomy_policy_json,
            reporting_preference_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, 'idle', '{}', '{}', ?, ?)
        `,
        companyId,
        name,
        input.description ?? null,
        "project",
        now,
        now,
      );

      const roleId = this.ensureLeadershipRole(companyId, now);
      const ceo = this.createAgentSync({
        id: input.openclawCeo.id ?? `${companyId}:ceo`,
        companyId,
        adapterId: input.openclawCeo.adapterId ?? "openclaw-local",
        adapterKind: "openclaw",
        label: input.openclawCeo.label.trim(),
        roleId,
        reportsToAgentId: null,
        openclawAgentId,
        modelRef: input.openclawCeo.modelRef ?? null,
        status: "active",
        isLeader: true,
        config: {},
        now: input.now,
      });
      this.run(
        `
          UPDATE oui_companies
          SET ceo_agent_id = ?, default_leader_agent_id = ?, updated_at = ?
          WHERE id = ?
        `,
        ceo.id,
        ceo.id,
        now,
        companyId,
      );
      return { company: this.requireCompany(companyId), ceo };
    });
  }

  async getCompany(companyId: string): Promise<OuiCompanyRecord | null> {
    return this.getCompanySync(companyId);
  }

  async deleteCompany(companyId: string): Promise<OuiCompanyRecord | null> {
    return this.transaction(() => {
      const company = this.getCompanySync(companyId);
      if (!company) {
        return null;
      }
      this.run("DELETE FROM oui_companies WHERE id = ?", companyId);
      return company;
    });
  }

  async listAgents(companyId: string): Promise<OuiAgentRecord[]> {
    return this.getAll(
      "SELECT * FROM oui_agents WHERE company_id = ? ORDER BY is_leader DESC, label",
      companyId,
    ).map(readAgent);
  }

  async getAgent(agentId: string): Promise<OuiAgentRecord | null> {
    return this.getAgentSync(agentId);
  }

  async createAgent(input: OuiCreateAgentInput): Promise<OuiAgentRecord> {
    return this.transaction(() => this.createAgentSync(input));
  }

  async setDefaultLeaderAgent(
    companyId: string,
    agentId: string,
    now?: Date,
  ): Promise<OuiCompanyRecord> {
    const agent = this.getAgentSync(agentId);
    if (!agent || agent.companyId !== companyId) {
      throw new Error("Default leader must be an agent in the company.");
    }
    if (agent.adapterKind !== "openclaw") {
      throw new Error("Company CEO must be backed by an OpenClaw agent.");
    }
    const nowIso = toIsoDate(now);
    this.run(
      `
        UPDATE oui_companies
        SET ceo_agent_id = ?, default_leader_agent_id = ?, updated_at = ?
        WHERE id = ?
      `,
      agentId,
      agentId,
      nowIso,
      companyId,
    );
    const company = this.getCompanySync(companyId);
    if (!company) {
      throw new Error(`OUI company not found: ${companyId}`);
    }
    return company;
  }

  async listCeoConversations(companyId: string): Promise<OuiConversationRecord[]> {
    return this.getAll(
      `
        SELECT * FROM oui_conversations
        WHERE company_id = ?
        ORDER BY updated_at DESC, id ASC
      `,
      companyId,
    ).map(readConversation);
  }

  async getOrCreateCeoConversation(
    input: OuiGetOrCreateConversationInput,
  ): Promise<OuiConversationRecord> {
    const company = this.requireCompany(input.companyId);
    const conversationId = input.id ?? randomUUID();
    const now = toIsoDate(input.now);
    const existing = this.getConversationSync(conversationId);
    if (existing) {
      if (existing.companyId !== input.companyId) {
        throw new Error("CEO conversation must stay inside one company.");
      }
      return existing;
    }
    const ceoAgentId = input.ceoAgentId ?? company.ceoAgentId ?? company.defaultLeaderAgentId;
    this.run(
      `
        INSERT INTO oui_conversations(
          id, company_id, ceo_agent_id, title, summary, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, NULL, 'active', ?, ?)
      `,
      conversationId,
      input.companyId,
      ceoAgentId ?? null,
      input.title ?? null,
      now,
      now,
    );
    return this.requireConversation(conversationId);
  }

  async listConversationMessages(conversationId: string, limit = 100): Promise<OuiMessageRecord[]> {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    return this.getAll(
      `
        SELECT * FROM (
          SELECT * FROM oui_messages
          WHERE conversation_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        )
        ORDER BY created_at ASC, id ASC
      `,
      conversationId,
      boundedLimit,
    ).map(readMessage);
  }

  async appendConversationMessage(input: OuiAppendMessageInput): Promise<OuiMessageRecord> {
    const conversation = this.requireConversation(input.conversationId);
    if (conversation.companyId !== input.companyId) {
      throw new Error("CEO message must stay inside one company.");
    }
    if (!input.content.trim()) {
      throw new Error("CEO message content is required.");
    }
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    this.transaction(() => {
      this.run(
        `
          INSERT INTO oui_messages(
            id, conversation_id, company_id, role, content, metadata_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        id,
        input.conversationId,
        input.companyId,
        input.role,
        input.content.trim(),
        JSON.stringify(input.metadata ?? {}),
        now,
      );
      this.run(
        `
          UPDATE oui_conversations
          SET updated_at = ?,
              title = CASE
                WHEN title IS NULL AND ? = 'user' THEN ?
                ELSE title
              END
          WHERE id = ?
        `,
        now,
        input.role,
        input.content.trim().slice(0, 80),
        input.conversationId,
      );
    });
    return this.requireMessage(id);
  }

  async createTask(input: OuiCreateTaskInput): Promise<OuiTaskRecord> {
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    const status: OuiTaskStatus = input.assignedAgentId ? "ready" : "draft";
    this.run(
      `
        INSERT INTO oui_tasks(
          id, company_id, title, description, status, review_state,
          assigned_agent_id, created_by, priority, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?)
      `,
      id,
      input.companyId,
      input.title,
      input.description ?? null,
      status,
      input.assignedAgentId ?? null,
      input.createdBy ?? null,
      input.priority ?? 0,
      now,
      now,
    );
    const task = this.getTaskSync(id);
    if (!task) {
      throw new Error(`Failed to create OUI task: ${id}`);
    }
    return task;
  }

  async getTask(taskId: string): Promise<OuiTaskRecord | null> {
    return this.getTaskSync(taskId);
  }

  async listTasks(companyId: string): Promise<OuiTaskRecord[]> {
    return this.getAll(
      `
        SELECT * FROM oui_tasks
        WHERE company_id = ?
        ORDER BY
          CASE status
            WHEN 'running' THEN 0
            WHEN 'review' THEN 1
            WHEN 'blocked' THEN 2
            WHEN 'ready' THEN 3
            WHEN 'draft' THEN 4
            WHEN 'done' THEN 5
            ELSE 6
          END,
          priority DESC,
          updated_at DESC,
          id ASC
      `,
      companyId,
    ).map(readTask);
  }

  async addTaskDependency(
    taskId: string,
    dependsOnTaskId: string,
    now?: Date,
  ): Promise<OuiTaskDependencyRecord> {
    if (taskId === dependsOnTaskId) {
      throw new Error("Task cannot depend on itself.");
    }
    const task = this.requireTask(taskId);
    const dependency = this.requireTask(dependsOnTaskId);
    if (task.companyId !== dependency.companyId) {
      throw new Error("Task dependencies must stay inside one company.");
    }
    if (this.wouldCreateTaskCycle(taskId, dependsOnTaskId)) {
      throw new Error("Task dependency would create a cycle.");
    }
    const nowIso = toIsoDate(now);
    this.run(
      `
        INSERT INTO oui_task_dependencies(task_id, depends_on_task_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id, depends_on_task_id) DO NOTHING
      `,
      taskId,
      dependsOnTaskId,
      nowIso,
    );
    const row = this.getOne(
      "SELECT * FROM oui_task_dependencies WHERE task_id = ? AND depends_on_task_id = ?",
      taskId,
      dependsOnTaskId,
    );
    if (!row) {
      throw new Error("Failed to add task dependency.");
    }
    return readDependency(row);
  }

  async getTaskReadiness(taskId: string): Promise<OuiTaskReadiness> {
    const rows = this.getAll(
      `
        SELECT d.depends_on_task_id, t.status
        FROM oui_task_dependencies d
        JOIN oui_tasks t ON t.id = d.depends_on_task_id
        WHERE d.task_id = ?
      `,
      taskId,
    );
    const pendingDependencyIds = rows
      .filter((row) => row.status !== "done")
      .map((row) => requiredString(row, "depends_on_task_id"));
    return { ready: pendingDependencyIds.length === 0, pendingDependencyIds };
  }

  async assignTask(taskId: string, agentId: string, now?: Date): Promise<OuiTaskRecord> {
    const task = this.requireTask(taskId);
    const agent = this.getAgentSync(agentId);
    if (!agent || agent.companyId !== task.companyId) {
      throw new Error("Task assignment must target an agent in the task company.");
    }
    const readiness = await this.getTaskReadiness(taskId);
    const status: OuiTaskStatus = readiness.ready ? "ready" : "blocked";
    return this.updateTaskFields(taskId, { assigned_agent_id: agentId, status }, now);
  }

  async transitionTaskReview(
    taskId: string,
    next: OuiTaskReviewState,
    now?: Date,
  ): Promise<OuiTaskRecord> {
    const task = this.requireTask(taskId);
    const allowed =
      (task.reviewState === "none" && next === "requested") ||
      (task.reviewState === "requested" && (next === "approved" || next === "changes_requested")) ||
      (task.reviewState === "changes_requested" && next === "requested") ||
      task.reviewState === next;
    if (!allowed) {
      throw new Error(`Invalid OUI task review transition: ${task.reviewState} -> ${next}`);
    }
    const status: OuiTaskStatus =
      next === "approved"
        ? "done"
        : next === "requested" || next === "changes_requested"
          ? "review"
          : task.status;
    return this.updateTaskFields(taskId, { review_state: next, status }, now);
  }

  async updateTaskStatus(
    taskId: string,
    status: OuiTaskStatus,
    now?: Date,
  ): Promise<OuiTaskRecord> {
    return this.updateTaskFields(taskId, { status }, now);
  }

  async attachRunToTask(
    taskId: string,
    runId: string,
    kind: OuiTaskRunLink["kind"] = "primary",
    now?: Date,
  ): Promise<OuiTaskRunLink> {
    const nowIso = toIsoDate(now);
    this.run(
      `
        INSERT INTO oui_task_runs(task_id, run_id, kind, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(task_id, run_id) DO UPDATE SET kind = excluded.kind
      `,
      taskId,
      runId,
      kind,
      nowIso,
    );
    const row = this.getOne(
      "SELECT * FROM oui_task_runs WHERE task_id = ? AND run_id = ?",
      taskId,
      runId,
    );
    if (!row) {
      throw new Error("Failed to attach run to task.");
    }
    return readTaskRunLink(row);
  }

  async listTaskRunLinks(taskId: string): Promise<OuiTaskRunLink[]> {
    return this.getAll(
      "SELECT * FROM oui_task_runs WHERE task_id = ? ORDER BY created_at ASC, run_id ASC",
      taskId,
    ).map(readTaskRunLink);
  }

  async recordCostEvent(input: {
    id?: string;
    runId?: string | null;
    taskId?: string | null;
    agentId?: string | null;
    amountMicros?: number | null;
    currency?: string | null;
    usage?: OuiJsonObject;
    source: string;
    now?: Date;
  }): Promise<OuiCostEventRecord> {
    const id = input.id ?? randomUUID();
    const now = toIsoDate(input.now);
    this.run(
      `
        INSERT INTO oui_cost_events(
          id, run_id, task_id, agent_id, amount_micros,
          currency, usage_json, source, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      id,
      input.runId ?? null,
      input.taskId ?? null,
      input.agentId ?? null,
      input.amountMicros ?? null,
      input.currency ?? null,
      JSON.stringify(input.usage ?? {}),
      input.source,
      now,
    );
    const row = this.getOne("SELECT * FROM oui_cost_events WHERE id = ?", id);
    if (!row) {
      throw new Error("Failed to record OUI cost event.");
    }
    return readCostEvent(row);
  }

  async listCostEventsForRun(runId: string): Promise<OuiCostEventRecord[]> {
    return this.getAll(
      "SELECT * FROM oui_cost_events WHERE run_id = ? ORDER BY created_at ASC, id ASC",
      runId,
    ).map(readCostEvent);
  }

  async createRunbookDraft(
    input: OuiCreateRunbookDraftInput,
  ): Promise<OuiCreateRunbookDraftResult> {
    const now = toIsoDate(input.now);
    const runbookId = input.id ?? randomUUID();
    return this.transaction(() => {
      this.requireCompany(input.companyId);
      const existing = this.getRunbookSync(runbookId);
      if (existing && existing.companyId !== input.companyId) {
        throw new Error("Runbook versions cannot cross company boundaries.");
      }
      if (!existing) {
        this.run(
          `
            INSERT INTO oui_runbooks(id, company_id, title, status, created_at, updated_at)
            VALUES (?, ?, ?, 'draft', ?, ?)
          `,
          runbookId,
          input.companyId,
          input.title,
          now,
          now,
        );
      } else {
        this.run(
          "UPDATE oui_runbooks SET title = ?, status = 'draft', updated_at = ? WHERE id = ?",
          input.title,
          now,
          runbookId,
        );
      }

      const version = this.nextRunbookVersion(runbookId);
      const versionId = input.versionId ?? `${runbookId}:v${version}`;
      this.run(
        `
          INSERT INTO oui_runbook_versions(
            id, runbook_id, company_id, version, source_type, source_ref, status,
            objective, operating_mode, stages_json, decision_points_json,
            artifact_policy_json, pause_policy_json, report_policy_json,
            markdown_path, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        versionId,
        runbookId,
        input.companyId,
        version,
        input.sourceType,
        input.sourceRef ?? null,
        input.objective,
        input.operatingMode ?? "project",
        JSON.stringify(input.stages ?? []),
        JSON.stringify(input.decisionPoints ?? []),
        JSON.stringify(input.artifactPolicy ?? {}),
        JSON.stringify(input.pausePolicy ?? {}),
        JSON.stringify(input.reportPolicy ?? {}),
        input.markdownPath ?? null,
        now,
        now,
      );
      const runbook = this.getRunbookSync(runbookId);
      const runbookVersion = this.getRunbookVersionSync(versionId);
      if (!runbook || !runbookVersion) {
        throw new Error("Failed to create OUI runbook draft.");
      }
      return { runbook, version: runbookVersion };
    });
  }

  async listRunbooks(companyId: string): Promise<OuiRunbookRecord[]> {
    return this.getAll(
      `
        SELECT * FROM oui_runbooks
        WHERE company_id = ?
        ORDER BY updated_at DESC, id ASC
      `,
      companyId,
    ).map(readRunbook);
  }

  async listRunbookVersions(companyId: string): Promise<OuiRunbookVersionRecord[]> {
    return this.listRunbookVersionsSync(companyId);
  }

  async getRunbookVersion(versionId: string): Promise<OuiRunbookVersionRecord | null> {
    return this.getRunbookVersionSync(versionId);
  }

  async approveRunbookVersion(
    versionId: string,
    approvedBy: string,
    now?: Date,
  ): Promise<OuiRunbookVersionRecord> {
    const nowIso = toIsoDate(now);
    return this.transaction(() => {
      const version = this.requireRunbookVersion(versionId);
      if (!["draft", "pending_approval", "approved"].includes(version.status)) {
        throw new Error(`Cannot approve runbook version in ${version.status} state.`);
      }
      this.run(
        `
          UPDATE oui_runbook_versions
          SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
          WHERE id = ?
        `,
        approvedBy,
        nowIso,
        nowIso,
        versionId,
      );
      const firstStage = version.stages[0];
      this.run(
        `
          UPDATE oui_runbooks
          SET status = 'approved', active_version_id = ?, updated_at = ?
          WHERE id = ?
        `,
        versionId,
        nowIso,
        version.runbookId,
      );
      this.run(
        `
          UPDATE oui_companies
          SET current_runbook_version_id = ?,
              current_objective = ?,
              current_stage = ?,
              updated_at = ?
          WHERE id = ?
        `,
        versionId,
        version.objective,
        this.stageLabel(firstStage),
        nowIso,
        version.companyId,
      );
      return this.requireRunbookVersion(versionId);
    });
  }

  async startRunbookVersion(
    versionId: string,
    startedBy: string,
    now?: Date,
  ): Promise<OuiStartRunbookVersionResult> {
    const nowIso = toIsoDate(now);
    return this.transaction(() => {
      const version = this.requireRunbookVersion(versionId);
      if (
        !["draft", "pending_approval", "approved", "active", "completed"].includes(version.status)
      ) {
        throw new Error(`Cannot start runbook version in ${version.status} state.`);
      }
      this.run(
        `
          UPDATE oui_runbook_versions
          SET status = 'superseded', updated_at = ?
          WHERE company_id = ? AND id <> ? AND status = 'active'
        `,
        nowIso,
        version.companyId,
        versionId,
      );
      this.run(
        `
          UPDATE oui_runbooks
          SET status = 'superseded', updated_at = ?
          WHERE company_id = ? AND id <> ? AND status = 'active'
        `,
        nowIso,
        version.companyId,
        version.runbookId,
      );
      this.run(
        `
          UPDATE oui_runbook_versions
          SET status = 'active',
              approved_by = COALESCE(approved_by, ?),
              approved_at = COALESCE(approved_at, ?),
              updated_at = ?
          WHERE id = ?
        `,
        startedBy,
        nowIso,
        nowIso,
        versionId,
      );
      this.run(
        `
          UPDATE oui_runbooks
          SET status = 'active', active_version_id = ?, updated_at = ?
          WHERE id = ?
        `,
        versionId,
        nowIso,
        version.runbookId,
      );
      const activeVersion = this.requireRunbookVersion(versionId);
      const workNodes = this.createWorkNodesForVersionSync(activeVersion, nowIso);
      const firstNode = workNodes[0] ?? null;
      this.run(
        `
          UPDATE oui_companies
          SET status = 'running',
              current_runbook_version_id = ?,
              current_objective = ?,
              current_stage = ?,
              updated_at = ?
          WHERE id = ?
        `,
        versionId,
        activeVersion.objective,
        firstNode?.title ?? this.stageLabel(activeVersion.stages[0]),
        nowIso,
        activeVersion.companyId,
      );
      return {
        company: this.requireCompany(activeVersion.companyId),
        runbook: this.requireRunbook(activeVersion.runbookId),
        version: this.requireRunbookVersion(versionId),
        workNodes,
      };
    });
  }

  async createRoutine(input: OuiCreateRoutineInput): Promise<OuiRoutineRecord> {
    const nowDate = input.now ?? new Date();
    const now = toIsoDate(nowDate);
    const id = input.id ?? randomUUID();
    const triggerKind = input.triggerKind ?? "schedule";
    const schedule =
      input.schedule ?? (triggerKind === "schedule" ? { intervalMinutes: 1440 } : {});
    const status = input.status ?? "active";
    const nextTriggerAt =
      status === "active" && triggerKind === "schedule"
        ? nextRoutineTriggerAt(schedule, nowDate)
        : null;
    return this.transaction(() => {
      const company = this.requireCompany(input.companyId);
      const version = this.requireRunbookVersion(input.runbookVersionId);
      if (version.companyId !== company.id) {
        throw new Error("Routine runbook reference must stay inside one company.");
      }
      this.run(
        `
          INSERT INTO oui_routines(
            id, company_id, runbook_version_id, title, description, status,
            trigger_kind, schedule_json, concurrency_policy, last_triggered_at,
            next_trigger_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
          ON CONFLICT(company_id, runbook_version_id, title) DO UPDATE SET
            description = excluded.description,
            status = excluded.status,
            trigger_kind = excluded.trigger_kind,
            schedule_json = excluded.schedule_json,
            concurrency_policy = excluded.concurrency_policy,
            next_trigger_at = excluded.next_trigger_at,
            updated_at = excluded.updated_at
        `,
        id,
        company.id,
        version.id,
        input.title.trim() || version.objective,
        input.description ?? null,
        status,
        triggerKind,
        JSON.stringify(schedule),
        input.concurrencyPolicy ?? "skip_if_active",
        nextTriggerAt,
        now,
        now,
      );
      const routineRow = this.getOne(
        `
          SELECT * FROM oui_routines
          WHERE company_id = ? AND runbook_version_id = ? AND title = ?
          LIMIT 1
        `,
        company.id,
        version.id,
        input.title.trim() || version.objective,
      );
      if (!routineRow) {
        throw new Error("Failed to create OUI routine.");
      }
      return readRoutine(routineRow);
    });
  }

  async getRoutine(routineId: string): Promise<OuiRoutineRecord | null> {
    return this.getRoutineSync(routineId);
  }

  async listRoutines(companyId?: string | null): Promise<OuiRoutineRecord[]> {
    if (companyId) {
      return this.getAll(
        `
          SELECT * FROM oui_routines
          WHERE company_id = ?
          ORDER BY updated_at DESC, id ASC
        `,
        companyId,
      ).map(readRoutine);
    }
    return this.getAll(
      `
        SELECT * FROM oui_routines
        ORDER BY updated_at DESC, id ASC
      `,
    ).map(readRoutine);
  }

  async listDueRoutines(now?: Date): Promise<OuiRoutineRecord[]> {
    const nowIso = toIsoDate(now);
    return this.getAll(
      `
        SELECT * FROM oui_routines
        WHERE status = 'active'
          AND trigger_kind = 'schedule'
          AND next_trigger_at IS NOT NULL
          AND next_trigger_at <= ?
        ORDER BY next_trigger_at ASC, id ASC
      `,
      nowIso,
    ).map(readRoutine);
  }

  async updateRoutineStatus(input: OuiUpdateRoutineStatusInput): Promise<OuiRoutineRecord> {
    const nowDate = input.now ?? new Date();
    const now = toIsoDate(nowDate);
    return this.transaction(() => {
      const routine = this.requireRoutine(input.routineId);
      const nextTriggerAt =
        input.status === "active" && routine.triggerKind === "schedule"
          ? (routine.nextTriggerAt ?? nextRoutineTriggerAt(routine.schedule, nowDate))
          : (routine.nextTriggerAt ?? null);
      this.run(
        `
          UPDATE oui_routines
          SET status = ?, next_trigger_at = ?, updated_at = ?
          WHERE id = ?
        `,
        input.status,
        nextTriggerAt,
        now,
        input.routineId,
      );
      return this.requireRoutine(input.routineId);
    });
  }

  async markRoutineTriggered(input: OuiMarkRoutineTriggeredInput): Promise<OuiRoutineRecord> {
    const nowDate = input.now ?? new Date();
    const now = toIsoDate(nowDate);
    return this.transaction(() => {
      const routine = this.requireRoutine(input.routineId);
      const triggerKind = input.triggerKind ?? routine.triggerKind;
      const nextTriggerAt =
        input.nextTriggerAt !== undefined
          ? input.nextTriggerAt
          : triggerKind === "schedule"
            ? nextRoutineTriggerAt(routine.schedule, nowDate)
            : (routine.nextTriggerAt ?? null);
      this.run(
        `
          UPDATE oui_routines
          SET last_triggered_at = ?, next_trigger_at = ?, updated_at = ?
          WHERE id = ?
        `,
        now,
        nextTriggerAt,
        now,
        routine.id,
      );
      return this.requireRoutine(routine.id);
    });
  }

  async createRoutineTrigger(
    input: OuiCreateRoutineTriggerInput,
  ): Promise<OuiRoutineTriggerRecord> {
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    return this.transaction(() => {
      const routine = this.requireRoutine(input.routineId);
      this.run(
        `
          INSERT INTO oui_routine_triggers(
            id, routine_id, company_id, runbook_version_id, trigger_kind,
            status, payload_json, error, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        id,
        routine.id,
        routine.companyId,
        routine.runbookVersionId,
        input.triggerKind ?? routine.triggerKind,
        input.status,
        JSON.stringify(input.payload ?? {}),
        input.error ?? null,
        now,
        now,
      );
      return this.requireRoutineTrigger(id);
    });
  }

  async listRoutineTriggers(routineId: string): Promise<OuiRoutineTriggerRecord[]> {
    return this.getAll(
      `
        SELECT * FROM oui_routine_triggers
        WHERE routine_id = ?
        ORDER BY created_at DESC, id ASC
      `,
      routineId,
    ).map(readRoutineTrigger);
  }

  async recordAuditLog(input: OuiRecordAuditLogInput): Promise<OuiAuditLogRecord> {
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    this.run(
      `
        INSERT INTO oui_audit_log(
          id, actor_type, actor_id, company_id, entity_type, entity_id,
          action, details_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      id,
      input.actorType ?? "system",
      input.actorId ?? "oui",
      input.companyId ?? null,
      input.entityType,
      input.entityId,
      input.action,
      JSON.stringify(input.details ?? {}),
      now,
    );
    const row = this.getOne("SELECT * FROM oui_audit_log WHERE id = ?", id);
    if (!row) {
      throw new Error("Failed to record OUI audit log.");
    }
    return readAuditLog(row);
  }

  async listAuditLog(companyId?: string | null, limit = 80): Promise<OuiAuditLogRecord[]> {
    const safeLimit = Math.max(1, Math.min(200, limit));
    if (companyId) {
      return this.getAll(
        `
          SELECT * FROM oui_audit_log
          WHERE company_id = ?
          ORDER BY created_at DESC, id ASC
          LIMIT ?
        `,
        companyId,
        safeLimit,
      ).map(readAuditLog);
    }
    return this.getAll(
      `
        SELECT * FROM oui_audit_log
        ORDER BY created_at DESC, id ASC
        LIMIT ?
      `,
      safeLimit,
    ).map(readAuditLog);
  }

  async listWorkNodes(
    companyId: string,
    runbookVersionId?: string | null,
  ): Promise<OuiWorkNodeRecord[]> {
    return this.listWorkNodesSync(companyId, runbookVersionId);
  }

  async getWorkNode(nodeId: string): Promise<OuiWorkNodeRecord | null> {
    return this.getWorkNodeSync(nodeId);
  }

  async updateWorkNodeRunState(input: OuiUpdateWorkNodeRunStateInput): Promise<OuiWorkNodeRecord> {
    const now = toIsoDate(input.now);
    return this.transaction(() => {
      const node = this.requireWorkNode(input.nodeId);
      if (node.status === "done" || node.status === "skipped") {
        throw new Error(`Cannot update OUI work node in ${node.status} state.`);
      }
      const summary = input.summary?.trim() || node.summary || null;
      const output = input.output ?? node.output;
      const runId = input.clearRunId ? null : (input.runId ?? node.runId ?? null);
      const inboxItemId = input.clearInboxItemId
        ? null
        : (input.inboxItemId ?? node.inboxItemId ?? null);
      this.run(
        `
          UPDATE oui_work_nodes
          SET status = ?,
              run_id = ?,
              inbox_item_id = ?,
              summary = ?,
              output_json = ?,
              updated_at = ?
          WHERE id = ?
        `,
        input.status,
        runId,
        inboxItemId,
        summary,
        JSON.stringify(output),
        now,
        node.id,
      );
      const companyStatus =
        input.status === "blocked"
          ? "blocked"
          : input.status === "waiting_user"
            ? "waiting_user"
            : "running";
      this.run(
        `
          UPDATE oui_companies
          SET status = ?,
              current_stage = ?,
              updated_at = ?
          WHERE id = ?
        `,
        companyStatus,
        node.title,
        now,
        node.companyId,
      );
      return this.requireWorkNode(node.id);
    });
  }

  async completeWorkNode(input: OuiCompleteWorkNodeInput): Promise<OuiCompleteWorkNodeResult> {
    const now = input.now ?? new Date();
    const nowIso = toIsoDate(now);
    return this.transaction(() => {
      const node = this.requireWorkNode(input.nodeId);
      if (!["ready", "running", "waiting_user", "done"].includes(node.status)) {
        throw new Error(`Cannot complete OUI work node in ${node.status} state.`);
      }
      const version = this.requireRunbookVersion(node.runbookVersionId);
      const runbook = this.requireRunbook(version.runbookId);
      const output = input.output ?? {};
      const summary =
        input.summary?.trim() || node.summary || "Stage output saved to artifact repository.";
      const artifact = this.createArtifactSync({
        id: `${node.id}:artifact`,
        companyId: node.companyId,
        runId: node.runId,
        kind: "stage_output",
        title: `${node.title} output`,
        summary,
        contentType: "application/json",
        content: {
          ...output,
          nodeId: node.id,
          stageId: node.stageId,
          runbookVersionId: node.runbookVersionId,
        },
        metadata: {
          source: "work_node",
          completedBy: input.completedBy ?? null,
        },
        now,
      });
      this.run(
        `
          UPDATE oui_work_nodes
          SET status = 'done',
              summary = ?,
              output_json = ?,
              updated_at = ?
          WHERE id = ?
        `,
        summary,
        JSON.stringify(output),
        nowIso,
        node.id,
      );
      this.run(
        `
          INSERT INTO oui_node_outputs(
            id, node_id, company_id, runbook_version_id, run_id, artifact_id,
            summary, output_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            artifact_id = excluded.artifact_id,
            summary = excluded.summary,
            output_json = excluded.output_json,
            created_at = excluded.created_at
        `,
        `${node.id}:output`,
        node.id,
        node.companyId,
        node.runbookVersionId,
        node.runId ?? null,
        artifact.id,
        summary,
        JSON.stringify(output),
        nowIso,
      );
      if (node.status === "done") {
        return {
          node: this.requireWorkNode(node.id),
          nextNode: this.getNextOpenWorkNodeSync(
            node.companyId,
            node.runbookVersionId,
            node.orderIndex,
          ),
          artifact,
          company: this.requireCompany(node.companyId),
          runbook: this.requireRunbook(runbook.id),
          version: this.requireRunbookVersion(version.id),
        };
      }
      const nextRow = this.getOne(
        `
          SELECT * FROM oui_work_nodes
          WHERE company_id = ?
            AND runbook_version_id = ?
            AND order_index > ?
            AND status = 'pending'
          ORDER BY order_index ASC, id ASC
          LIMIT 1
        `,
        node.companyId,
        node.runbookVersionId,
        node.orderIndex,
      );
      const nextPending = nextRow ? readWorkNode(nextRow) : null;
      if (nextPending) {
        this.run(
          `
            UPDATE oui_work_nodes
            SET status = 'ready',
                updated_at = ?
            WHERE id = ?
          `,
          nowIso,
          nextPending.id,
        );
        this.run(
          `
            UPDATE oui_companies
            SET status = 'running',
                current_stage = ?,
                updated_at = ?
            WHERE id = ?
          `,
          nextPending.title,
          nowIso,
          node.companyId,
        );
      } else {
        this.run(
          "UPDATE oui_runbook_versions SET status = 'completed', updated_at = ? WHERE id = ?",
          nowIso,
          version.id,
        );
        this.run(
          "UPDATE oui_runbooks SET status = 'completed', updated_at = ? WHERE id = ?",
          nowIso,
          runbook.id,
        );
        this.run(
          `
            UPDATE oui_companies
            SET status = 'idle',
                current_stage = 'Completed',
                updated_at = ?
            WHERE id = ?
          `,
          nowIso,
          node.companyId,
        );
      }
      return {
        node: this.requireWorkNode(node.id),
        nextNode: nextPending ? this.requireWorkNode(nextPending.id) : null,
        artifact,
        company: this.requireCompany(node.companyId),
        runbook: this.requireRunbook(runbook.id),
        version: this.requireRunbookVersion(version.id),
      };
    });
  }

  async createInboxItem(input: OuiCreateInboxItemInput): Promise<OuiInboxItemRecord> {
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    this.requireCompany(input.companyId);
    this.assertOptionalRefsStayInCompany(input.companyId, {
      runbookVersionId: input.runbookVersionId,
      taskId: input.taskId,
    });
    this.run(
      `
        INSERT INTO oui_inbox_items(
          id, company_id, item_type, status, title, summary, runbook_version_id,
          task_id, run_id, payload_json, created_by, created_at, updated_at
        )
        VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      id,
      input.companyId,
      input.itemType,
      input.title,
      input.summary ?? null,
      input.runbookVersionId ?? null,
      input.taskId ?? null,
      input.runId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.createdBy ?? null,
      now,
      now,
    );
    return this.requireInboxItem(id);
  }

  async listInboxItems(
    companyId: string,
    status?: OuiInboxItemStatus,
  ): Promise<OuiInboxItemRecord[]> {
    const rows = status
      ? this.getAll(
          `
            SELECT * FROM oui_inbox_items
            WHERE company_id = ? AND status = ?
            ORDER BY updated_at DESC, id ASC
          `,
          companyId,
          status,
        )
      : this.getAll(
          `
            SELECT * FROM oui_inbox_items
            WHERE company_id = ?
            ORDER BY
              CASE status WHEN 'open' THEN 0 ELSE 1 END,
              updated_at DESC,
              id ASC
          `,
          companyId,
        );
    return rows.map(readInboxItem);
  }

  async resolveInboxItem(input: OuiResolveInboxItemInput): Promise<OuiInboxItemRecord> {
    const item = this.requireInboxItem(input.itemId);
    if (item.status !== "open") {
      return item;
    }
    const now = toIsoDate(input.now);
    const status: OuiInboxItemStatus =
      input.action === "reject" ? "rejected" : input.action === "stop" ? "stopped" : "resolved";
    this.run(
      `
        UPDATE oui_inbox_items
        SET status = ?,
            resolution_json = ?,
            resolved_by = ?,
            resolved_at = ?,
            updated_at = ?
        WHERE id = ?
      `,
      status,
      JSON.stringify({
        action: input.action,
        responseText: input.responseText ?? null,
      }),
      input.actorId ?? null,
      now,
      now,
      input.itemId,
    );
    return this.requireInboxItem(input.itemId);
  }

  async enqueueWorkWakeup(input: OuiEnqueueWorkWakeupInput): Promise<OuiWorkWakeupRecord> {
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    const maxAttempts = Math.max(1, Math.min(10, input.maxAttempts ?? 3));
    return this.transaction(() => {
      this.requireCompany(input.companyId);
      if (input.runbookVersionId) {
        const version = this.requireRunbookVersion(input.runbookVersionId);
        if (version.companyId !== input.companyId) {
          throw new Error("Wakeup runbook reference must stay inside one company.");
        }
      }
      if (input.workNodeId) {
        const node = this.requireWorkNode(input.workNodeId);
        if (node.companyId !== input.companyId) {
          throw new Error("Wakeup work-node reference must stay inside one company.");
        }
      }
      if (input.agentId) {
        const agent = this.requireAgent(input.agentId);
        if (agent.companyId !== input.companyId) {
          throw new Error("Wakeup agent reference must stay inside one company.");
        }
      }
      this.run(
        `
          INSERT INTO oui_work_wakeups(
            id, company_id, runbook_version_id, work_node_id, agent_id, reason, status,
            payload_json, attempts, max_attempts, queued_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            company_id = excluded.company_id,
            runbook_version_id = excluded.runbook_version_id,
            work_node_id = excluded.work_node_id,
            agent_id = excluded.agent_id,
            reason = excluded.reason,
            status = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN 'queued'
              ELSE oui_work_wakeups.status
            END,
            payload_json = excluded.payload_json,
            attempts = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN 0
              ELSE oui_work_wakeups.attempts
            END,
            max_attempts = excluded.max_attempts,
            lease_owner = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN NULL
              ELSE oui_work_wakeups.lease_owner
            END,
            lease_token = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN NULL
              ELSE oui_work_wakeups.lease_token
            END,
            lease_expires_at = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN NULL
              ELSE oui_work_wakeups.lease_expires_at
            END,
            heartbeat_at = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN NULL
              ELSE oui_work_wakeups.heartbeat_at
            END,
            queued_at = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN excluded.queued_at
              ELSE oui_work_wakeups.queued_at
            END,
            started_at = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN NULL
              ELSE oui_work_wakeups.started_at
            END,
            finished_at = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN NULL
              ELSE oui_work_wakeups.finished_at
            END,
            error = CASE
              WHEN oui_work_wakeups.status IN ('succeeded', 'failed', 'cancelled')
                THEN NULL
              ELSE oui_work_wakeups.error
            END,
            updated_at = excluded.updated_at
        `,
        id,
        input.companyId,
        input.runbookVersionId ?? null,
        input.workNodeId ?? null,
        input.agentId ?? null,
        input.reason,
        JSON.stringify(input.payload ?? {}),
        maxAttempts,
        now,
        now,
        now,
      );
      return this.requireWorkWakeup(id);
    });
  }

  async claimNextWorkWakeup(input: OuiClaimWorkWakeupInput): Promise<OuiWorkWakeupLease | null> {
    const nowDate = input.now ?? new Date();
    const nowIso = toIsoDate(nowDate);
    const leaseMs = Math.max(1, input.leaseMs);
    const leaseExpiresAt = new Date(nowDate.getTime() + leaseMs).toISOString();
    return this.transaction(() => {
      this.recoverExpiredWorkWakeupsSync(nowIso);
      const row = this.getOne(
        `
          SELECT * FROM oui_work_wakeups
          WHERE status = 'queued'
          ORDER BY queued_at ASC, id ASC
          LIMIT 1
        `,
      );
      if (!row) {
        return null;
      }
      const wakeup = readWorkWakeup(row);
      const leaseToken = randomUUID();
      const changed = this.run(
        `
          UPDATE oui_work_wakeups
          SET status = 'running',
              attempts = attempts + 1,
              lease_owner = ?,
              lease_token = ?,
              lease_expires_at = ?,
              heartbeat_at = ?,
              started_at = COALESCE(started_at, ?),
              error = NULL,
              updated_at = ?
          WHERE id = ? AND status = 'queued'
        `,
        input.workerId,
        leaseToken,
        leaseExpiresAt,
        nowIso,
        nowIso,
        nowIso,
        wakeup.id,
      );
      if (!changed) {
        return null;
      }
      return { wakeup: this.requireWorkWakeup(wakeup.id), leaseToken };
    });
  }

  async heartbeatWorkWakeupLease(
    input: OuiHeartbeatWorkWakeupInput,
  ): Promise<OuiWorkWakeupRecord | null> {
    const nowDate = input.now ?? new Date();
    const nowIso = toIsoDate(nowDate);
    const leaseExpiresAt = new Date(nowDate.getTime() + Math.max(1, input.leaseMs)).toISOString();
    const changed = this.run(
      `
        UPDATE oui_work_wakeups
        SET lease_expires_at = ?,
            heartbeat_at = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'running'
          AND lease_owner = ?
          AND lease_token = ?
      `,
      leaseExpiresAt,
      nowIso,
      nowIso,
      input.wakeupId,
      input.workerId,
      input.leaseToken,
    );
    return changed ? this.requireWorkWakeup(input.wakeupId) : null;
  }

  async finishWorkWakeup(input: OuiFinishWorkWakeupInput): Promise<OuiWorkWakeupRecord | null> {
    const current = this.getWorkWakeupSync(input.wakeupId);
    if (!current) {
      return null;
    }
    if (
      current.status === "succeeded" ||
      current.status === "failed" ||
      current.status === "cancelled"
    ) {
      return current;
    }
    const now = toIsoDate(input.now);
    const changed = this.run(
      `
        UPDATE oui_work_wakeups
        SET status = ?,
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            heartbeat_at = NULL,
            finished_at = ?,
            error = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'running'
          AND lease_owner = ?
          AND lease_token = ?
      `,
      input.status,
      now,
      input.error ?? null,
      now,
      input.wakeupId,
      input.workerId,
      input.leaseToken,
    );
    return changed ? this.requireWorkWakeup(input.wakeupId) : null;
  }

  async recoverExpiredWorkWakeups(
    input: OuiRecoverWorkWakeupsInput = {},
  ): Promise<OuiWorkWakeupRecord[]> {
    const now = toIsoDate(input.now);
    return this.transaction(() => this.recoverExpiredWorkWakeupsSync(now));
  }

  async listWorkWakeups(
    companyId: string,
    status?: OuiWorkWakeupStatus,
  ): Promise<OuiWorkWakeupRecord[]> {
    const rows = status
      ? this.getAll(
          `
            SELECT * FROM oui_work_wakeups
            WHERE company_id = ? AND status = ?
            ORDER BY updated_at DESC, id ASC
          `,
          companyId,
          status,
        )
      : this.getAll(
          `
            SELECT * FROM oui_work_wakeups
            WHERE company_id = ?
            ORDER BY
              CASE status WHEN 'queued' THEN 0 WHEN 'running' THEN 1 ELSE 2 END,
              updated_at DESC,
              id ASC
          `,
          companyId,
        );
    return rows.map(readWorkWakeup);
  }

  async createArtifact(input: OuiCreateArtifactInput): Promise<OuiArtifactRecord> {
    return this.createArtifactSync(input);
  }

  private createArtifactSync(input: OuiCreateArtifactInput): OuiArtifactRecord {
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    if (input.companyId) {
      this.requireCompany(input.companyId);
    }
    if (input.meetingId) {
      this.requireMeeting(input.meetingId);
    }
    this.run(
      `
        INSERT INTO oui_artifacts(
          id, company_id, meeting_id, run_id, artifact_type, title, summary,
          path, content_type, content_json, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          company_id = excluded.company_id,
          meeting_id = excluded.meeting_id,
          run_id = excluded.run_id,
          artifact_type = excluded.artifact_type,
          title = excluded.title,
          summary = excluded.summary,
          path = excluded.path,
          content_type = excluded.content_type,
          content_json = excluded.content_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `,
      id,
      input.companyId ?? null,
      input.meetingId ?? null,
      input.runId ?? null,
      input.kind,
      input.title,
      input.summary ?? null,
      input.path ?? null,
      input.contentType ?? "application/json",
      JSON.stringify(input.content ?? {}),
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    );
    return this.requireArtifact(id);
  }

  async listArtifacts(filter: OuiListArtifactsFilter = {}): Promise<OuiArtifactRecord[]> {
    if (filter.companyId) {
      return this.getAll(
        `
          SELECT * FROM oui_artifacts
          WHERE company_id = ?
          ORDER BY created_at DESC, id ASC
        `,
        filter.companyId,
      ).map(readArtifact);
    }
    if (filter.meetingId) {
      return this.getAll(
        `
          SELECT * FROM oui_artifacts
          WHERE meeting_id = ?
          ORDER BY created_at DESC, id ASC
        `,
        filter.meetingId,
      ).map(readArtifact);
    }
    if (filter.runId) {
      return this.getAll(
        `
          SELECT * FROM oui_artifacts
          WHERE run_id = ?
          ORDER BY created_at DESC, id ASC
        `,
        filter.runId,
      ).map(readArtifact);
    }
    return this.getAll(
      `
        SELECT * FROM oui_artifacts
        ORDER BY created_at DESC, id ASC
      `,
    ).map(readArtifact);
  }

  async createMeeting(input: OuiCreateMeetingInput): Promise<OuiMeetingRecord> {
    const title = input.title.trim();
    if (!title) {
      throw new Error("OUI meeting title is required.");
    }
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    const discussion = createMeetingDiscussionState({
      title,
      objective: input.objective ?? null,
      createdAt: now,
    });
    this.run(
      `
        INSERT INTO oui_meetings(
          id, title, objective, status, participants_json, discussion_json, created_at, updated_at
        )
        VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)
      `,
      id,
      title,
      input.objective ?? null,
      JSON.stringify(input.participants ?? []),
      JSON.stringify(discussion),
      now,
      now,
    );
    return this.requireMeeting(id);
  }

  async getMeeting(meetingId: string): Promise<OuiMeetingRecord | null> {
    return this.getMeetingSync(meetingId);
  }

  async listMeetings(): Promise<OuiMeetingRecord[]> {
    return this.getAll(
      `
        SELECT * FROM oui_meetings
        ORDER BY
          CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
          updated_at DESC,
          id ASC
      `,
    ).map(readMeeting);
  }

  async updateMeetingStatus(input: OuiUpdateMeetingStatusInput): Promise<OuiMeetingRecord> {
    const now = toIsoDate(input.now);
    this.requireMeeting(input.meetingId);
    this.run(
      `
        UPDATE oui_meetings
        SET status = ?,
            minutes_artifact_id = COALESCE(?, minutes_artifact_id),
            started_at = CASE
              WHEN ? = 'active' THEN COALESCE(started_at, ?)
              ELSE started_at
            END,
            ended_at = CASE
              WHEN ? = 'ended' THEN COALESCE(ended_at, ?)
              ELSE ended_at
            END,
            updated_at = ?
        WHERE id = ?
      `,
      input.status,
      input.minutesArtifactId ?? null,
      input.status,
      now,
      input.status,
      now,
      now,
      input.meetingId,
    );
    return this.requireMeeting(input.meetingId);
  }

  async updateMeetingParticipants(
    input: OuiUpdateMeetingParticipantsInput,
  ): Promise<OuiMeetingRecord> {
    const now = toIsoDate(input.now);
    this.requireMeeting(input.meetingId);
    this.run(
      `
        UPDATE oui_meetings
        SET participants_json = ?,
            updated_at = ?
        WHERE id = ?
      `,
      JSON.stringify(input.participants),
      now,
      input.meetingId,
    );
    return this.requireMeeting(input.meetingId);
  }

  async updateMeetingDiscussion(input: OuiUpdateMeetingDiscussionInput): Promise<OuiMeetingRecord> {
    const now = toIsoDate(input.now);
    this.requireMeeting(input.meetingId);
    this.run(
      `
        UPDATE oui_meetings
        SET discussion_json = ?,
            updated_at = ?
        WHERE id = ?
      `,
      JSON.stringify(input.discussion),
      now,
      input.meetingId,
    );
    return this.requireMeeting(input.meetingId);
  }

  async appendMeetingMessage(
    input: OuiAppendMeetingMessageInput,
  ): Promise<OuiMeetingMessageRecord> {
    const meeting = this.requireMeeting(input.meetingId);
    const content = input.content.trim();
    if (!content) {
      throw new Error("OUI meeting message content is required.");
    }
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    this.run(
      `
        INSERT INTO oui_meeting_messages(
          id, meeting_id, role, participant_id, content, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      id,
      meeting.id,
      input.role,
      input.participantId ?? null,
      content,
      JSON.stringify(input.metadata ?? {}),
      now,
    );
    this.run("UPDATE oui_meetings SET updated_at = ? WHERE id = ?", now, meeting.id);
    return this.requireMeetingMessage(id);
  }

  async listMeetingMessages(meetingId: string): Promise<OuiMeetingMessageRecord[]> {
    this.requireMeeting(meetingId);
    return this.getAll(
      `
        SELECT * FROM oui_meeting_messages
        WHERE meeting_id = ?
        ORDER BY created_at ASC, id ASC
      `,
      meetingId,
    ).map(readMeetingMessage);
  }

  private createAgentSync(input: OuiCreateAgentInput): OuiAgentRecord {
    this.requireCompany(input.companyId);
    if (input.isLeader && input.adapterKind !== "openclaw") {
      throw new Error("Company CEO must be backed by an OpenClaw agent.");
    }
    if (input.reportsToAgentId) {
      const manager = this.getAgentSync(input.reportsToAgentId);
      if (!manager || manager.companyId !== input.companyId) {
        throw new Error("Manager must be an agent in the same company.");
      }
      if (input.id && this.wouldCreateReportsToCycle(input.id, input.reportsToAgentId)) {
        throw new Error("Agent reports-to relationship would create a cycle.");
      }
    }
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    const status = input.status ?? (input.adapterKind === "openclaw" ? "active" : "disabled");
    this.run(
      `
        INSERT INTO oui_agents(
          id, company_id, adapter_id, adapter_kind, label, role_id,
          reports_to_agent_id, openclaw_agent_id, model_ref, status,
          is_leader, config_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          role_id = excluded.role_id,
          reports_to_agent_id = excluded.reports_to_agent_id,
          openclaw_agent_id = excluded.openclaw_agent_id,
          model_ref = excluded.model_ref,
          status = excluded.status,
          is_leader = excluded.is_leader,
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
      `,
      id,
      input.companyId,
      input.adapterId,
      input.adapterKind,
      input.label,
      input.roleId ?? null,
      input.reportsToAgentId ?? null,
      input.openclawAgentId ?? null,
      input.modelRef ?? null,
      status,
      input.isLeader ? 1 : 0,
      JSON.stringify(input.config ?? {}),
      now,
      now,
    );
    const agent = this.getAgentSync(id);
    if (!agent) {
      throw new Error(`Failed to create OUI agent: ${id}`);
    }
    return agent;
  }

  private updateTaskFields(
    taskId: string,
    fields: Partial<{
      assigned_agent_id: string | null;
      status: OuiTaskStatus;
      review_state: OuiTaskReviewState;
    }>,
    now?: Date,
  ): OuiTaskRecord {
    this.requireTask(taskId);
    const current = this.requireTask(taskId);
    const next = {
      assigned_agent_id:
        "assigned_agent_id" in fields
          ? (fields.assigned_agent_id ?? null)
          : (current.assignedAgentId ?? null),
      status: fields.status ?? current.status,
      review_state: fields.review_state ?? current.reviewState,
    };
    const nowIso = toIsoDate(now);
    this.run(
      `
        UPDATE oui_tasks
        SET assigned_agent_id = ?, status = ?, review_state = ?, updated_at = ?
        WHERE id = ?
      `,
      next.assigned_agent_id,
      next.status,
      next.review_state,
      nowIso,
      taskId,
    );
    return this.requireTask(taskId);
  }

  private wouldCreateReportsToCycle(agentId: string, managerId: string): boolean {
    let next: string | null = managerId;
    const seen = new Set<string>();
    while (next) {
      if (next === agentId || seen.has(next)) {
        return true;
      }
      seen.add(next);
      const manager = this.getAgentSync(next);
      next = manager?.reportsToAgentId ?? null;
    }
    return false;
  }

  private wouldCreateTaskCycle(taskId: string, dependsOnTaskId: string): boolean {
    const stack = [dependsOnTaskId];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next || seen.has(next)) {
        continue;
      }
      if (next === taskId) {
        return true;
      }
      seen.add(next);
      const rows = this.getAll(
        "SELECT depends_on_task_id FROM oui_task_dependencies WHERE task_id = ?",
        next,
      );
      for (const row of rows) {
        stack.push(requiredString(row, "depends_on_task_id"));
      }
    }
    return false;
  }

  private ensureLeadershipRole(companyId: string, nowIso: string): string {
    const leaderRoleId = `${companyId}:leadership`;
    this.run(
      `
        INSERT INTO oui_roles(id, company_id, name, created_at, updated_at)
        VALUES (?, ?, 'Leadership', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `,
      leaderRoleId,
      companyId,
      nowIso,
      nowIso,
    );
    return leaderRoleId;
  }

  private nextRunbookVersion(runbookId: string): number {
    const row = this.getOne(
      "SELECT COALESCE(MAX(version), 0) AS max_version FROM oui_runbook_versions WHERE runbook_id = ?",
      runbookId,
    );
    return (optionalNumber(row?.max_version) ?? 0) + 1;
  }

  private stageLabel(stage: OuiJsonObject | undefined): string | null {
    if (!stage) {
      return null;
    }
    for (const key of ["title", "name", "id"]) {
      const value = stage[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private stageId(stage: OuiJsonObject | undefined, index: number): string {
    const value = stage?.id;
    return typeof value === "string" && value.trim() ? value.trim() : `stage-${index + 1}`;
  }

  private stageType(stage: OuiJsonObject | undefined): string {
    const value = stage?.type;
    return typeof value === "string" && value.trim() ? value.trim() : "work";
  }

  private stageSummary(stage: OuiJsonObject | undefined): string | null {
    if (!stage) {
      return null;
    }
    for (const key of ["summary", "description", "output"]) {
      const value = stage[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private stageAssigneeAgentId(companyId: string, stage: OuiJsonObject | undefined): string | null {
    if (!stage) {
      return null;
    }
    for (const key of ["agentId", "assigneeAgentId"]) {
      const value = stage[key];
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }
      const agent = this.getAgentSync(value.trim());
      if (agent?.companyId === companyId) {
        return agent.id;
      }
    }
    return null;
  }

  private runbookStagesForNodes(version: OuiRunbookVersionRecord): OuiJsonObject[] {
    return version.stages.length
      ? version.stages
      : [
          {
            id: "start",
            title: "Start work",
            type: "work",
            summary: version.objective,
          },
        ];
  }

  private createWorkNodesForVersionSync(
    version: OuiRunbookVersionRecord,
    nowIso: string,
  ): OuiWorkNodeRecord[] {
    const stages = this.runbookStagesForNodes(version);
    for (const [index, stage] of stages.entries()) {
      const orderIndex = index + 1;
      const id = `${version.id}:node:${orderIndex}`;
      const title = this.stageLabel(stage) ?? `Stage ${orderIndex}`;
      this.run(
        `
          INSERT INTO oui_work_nodes(
            id, company_id, runbook_version_id, stage_id, title, node_type,
            status, assigned_agent_id, order_index, summary, input_json,
            output_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
          ON CONFLICT(runbook_version_id, order_index) DO UPDATE SET
            stage_id = excluded.stage_id,
            title = excluded.title,
            node_type = excluded.node_type,
            status = excluded.status,
            assigned_agent_id = excluded.assigned_agent_id,
            summary = excluded.summary,
            input_json = excluded.input_json,
            output_json = '{}',
            run_id = NULL,
            inbox_item_id = NULL,
            updated_at = excluded.updated_at
        `,
        id,
        version.companyId,
        version.id,
        this.stageId(stage, index),
        title,
        this.stageType(stage),
        index === 0 ? "ready" : "pending",
        this.stageAssigneeAgentId(version.companyId, stage),
        orderIndex,
        this.stageSummary(stage),
        JSON.stringify({ stage, objective: version.objective }),
        nowIso,
        nowIso,
      );
    }
    return this.listWorkNodesSync(version.companyId, version.id);
  }

  private assertOptionalRefsStayInCompany(
    companyId: string,
    refs: { runbookVersionId?: string | null; taskId?: string | null },
  ): void {
    if (refs.runbookVersionId) {
      const runbookVersion = this.requireRunbookVersion(refs.runbookVersionId);
      if (runbookVersion.companyId !== companyId) {
        throw new Error("Inbox runbook reference must stay inside one company.");
      }
    }
    if (refs.taskId) {
      const task = this.requireTask(refs.taskId);
      if (task.companyId !== companyId) {
        throw new Error("Inbox task reference must stay inside one company.");
      }
    }
  }

  private requireCompany(companyId: string): OuiCompanyRecord {
    const company = this.getCompanySync(companyId);
    if (!company) {
      throw new Error(`OUI company not found: ${companyId}`);
    }
    return company;
  }

  private requireAgent(agentId: string): OuiAgentRecord {
    const agent = this.getAgentSync(agentId);
    if (!agent) {
      throw new Error(`OUI agent not found: ${agentId}`);
    }
    return agent;
  }

  private requireRunbook(runbookId: string): OuiRunbookRecord {
    const runbook = this.getRunbookSync(runbookId);
    if (!runbook) {
      throw new Error(`OUI runbook not found: ${runbookId}`);
    }
    return runbook;
  }

  private requireTask(taskId: string): OuiTaskRecord {
    const task = this.getTaskSync(taskId);
    if (!task) {
      throw new Error(`OUI task not found: ${taskId}`);
    }
    return task;
  }

  private requireConversation(conversationId: string): OuiConversationRecord {
    const conversation = this.getConversationSync(conversationId);
    if (!conversation) {
      throw new Error(`OUI CEO conversation not found: ${conversationId}`);
    }
    return conversation;
  }

  private requireMessage(messageId: string): OuiMessageRecord {
    const message = this.getMessageSync(messageId);
    if (!message) {
      throw new Error(`OUI CEO message not found: ${messageId}`);
    }
    return message;
  }

  private requireRunbookVersion(versionId: string): OuiRunbookVersionRecord {
    const version = this.getRunbookVersionSync(versionId);
    if (!version) {
      throw new Error(`OUI runbook version not found: ${versionId}`);
    }
    return version;
  }

  private requireRoutine(routineId: string): OuiRoutineRecord {
    const routine = this.getRoutineSync(routineId);
    if (!routine) {
      throw new Error(`OUI routine not found: ${routineId}`);
    }
    return routine;
  }

  private requireRoutineTrigger(triggerId: string): OuiRoutineTriggerRecord {
    const trigger = this.getRoutineTriggerSync(triggerId);
    if (!trigger) {
      throw new Error(`OUI routine trigger not found: ${triggerId}`);
    }
    return trigger;
  }

  private requireWorkNode(nodeId: string): OuiWorkNodeRecord {
    const node = this.getWorkNodeSync(nodeId);
    if (!node) {
      throw new Error(`OUI work node not found: ${nodeId}`);
    }
    return node;
  }

  private requireInboxItem(itemId: string): OuiInboxItemRecord {
    const item = this.getInboxItemSync(itemId);
    if (!item) {
      throw new Error(`OUI inbox item not found: ${itemId}`);
    }
    return item;
  }

  private requireWorkWakeup(wakeupId: string): OuiWorkWakeupRecord {
    const wakeup = this.getWorkWakeupSync(wakeupId);
    if (!wakeup) {
      throw new Error(`OUI work wakeup not found: ${wakeupId}`);
    }
    return wakeup;
  }

  private requireArtifact(artifactId: string): OuiArtifactRecord {
    const artifact = this.getArtifactSync(artifactId);
    if (!artifact) {
      throw new Error(`OUI artifact not found: ${artifactId}`);
    }
    return artifact;
  }

  private requireMeeting(meetingId: string): OuiMeetingRecord {
    const meeting = this.getMeetingSync(meetingId);
    if (!meeting) {
      throw new Error(`OUI meeting not found: ${meetingId}`);
    }
    return meeting;
  }

  private requireMeetingMessage(messageId: string): OuiMeetingMessageRecord {
    const message = this.getMeetingMessageSync(messageId);
    if (!message) {
      throw new Error(`OUI meeting message not found: ${messageId}`);
    }
    return message;
  }

  private getCompanySync(companyId: string): OuiCompanyRecord | null {
    const row = this.getOne("SELECT * FROM oui_companies WHERE id = ?", companyId);
    return row ? readCompany(row) : null;
  }

  private getAgentSync(agentId: string): OuiAgentRecord | null {
    const row = this.getOne("SELECT * FROM oui_agents WHERE id = ?", agentId);
    return row ? readAgent(row) : null;
  }

  private getTaskSync(taskId: string): OuiTaskRecord | null {
    const row = this.getOne("SELECT * FROM oui_tasks WHERE id = ?", taskId);
    return row ? readTask(row) : null;
  }

  private getConversationSync(conversationId: string): OuiConversationRecord | null {
    const row = this.getOne("SELECT * FROM oui_conversations WHERE id = ?", conversationId);
    return row ? readConversation(row) : null;
  }

  private getMessageSync(messageId: string): OuiMessageRecord | null {
    const row = this.getOne("SELECT * FROM oui_messages WHERE id = ?", messageId);
    return row ? readMessage(row) : null;
  }

  private getRunbookSync(runbookId: string): OuiRunbookRecord | null {
    const row = this.getOne("SELECT * FROM oui_runbooks WHERE id = ?", runbookId);
    return row ? readRunbook(row) : null;
  }

  private getRunbookVersionSync(versionId: string): OuiRunbookVersionRecord | null {
    const row = this.getOne("SELECT * FROM oui_runbook_versions WHERE id = ?", versionId);
    return row ? readRunbookVersion(row) : null;
  }

  private getRoutineSync(routineId: string): OuiRoutineRecord | null {
    const row = this.getOne("SELECT * FROM oui_routines WHERE id = ?", routineId);
    return row ? readRoutine(row) : null;
  }

  private getRoutineTriggerSync(triggerId: string): OuiRoutineTriggerRecord | null {
    const row = this.getOne("SELECT * FROM oui_routine_triggers WHERE id = ?", triggerId);
    return row ? readRoutineTrigger(row) : null;
  }

  private listRunbookVersionsSync(companyId: string): OuiRunbookVersionRecord[] {
    return this.getAll(
      `
        SELECT * FROM oui_runbook_versions
        WHERE company_id = ?
        ORDER BY updated_at DESC, version DESC, id ASC
      `,
      companyId,
    ).map(readRunbookVersion);
  }

  private listWorkNodesSync(
    companyId: string,
    runbookVersionId?: string | null,
  ): OuiWorkNodeRecord[] {
    if (runbookVersionId) {
      return this.getAll(
        `
          SELECT * FROM oui_work_nodes
          WHERE company_id = ? AND runbook_version_id = ?
          ORDER BY order_index ASC, id ASC
        `,
        companyId,
        runbookVersionId,
      ).map(readWorkNode);
    }
    return this.getAll(
      `
        SELECT * FROM oui_work_nodes
        WHERE company_id = ?
        ORDER BY updated_at DESC, runbook_version_id ASC, order_index ASC, id ASC
      `,
      companyId,
    ).map(readWorkNode);
  }

  private getWorkNodeSync(nodeId: string): OuiWorkNodeRecord | null {
    const row = this.getOne("SELECT * FROM oui_work_nodes WHERE id = ?", nodeId);
    return row ? readWorkNode(row) : null;
  }

  private getNextOpenWorkNodeSync(
    companyId: string,
    runbookVersionId: string,
    orderIndex: number,
  ): OuiWorkNodeRecord | null {
    const row = this.getOne(
      `
        SELECT * FROM oui_work_nodes
        WHERE company_id = ?
          AND runbook_version_id = ?
          AND order_index > ?
          AND status NOT IN ('done', 'skipped')
        ORDER BY order_index ASC, id ASC
        LIMIT 1
      `,
      companyId,
      runbookVersionId,
      orderIndex,
    );
    return row ? readWorkNode(row) : null;
  }

  private getInboxItemSync(itemId: string): OuiInboxItemRecord | null {
    const row = this.getOne("SELECT * FROM oui_inbox_items WHERE id = ?", itemId);
    return row ? readInboxItem(row) : null;
  }

  private getWorkWakeupSync(wakeupId: string): OuiWorkWakeupRecord | null {
    const row = this.getOne("SELECT * FROM oui_work_wakeups WHERE id = ?", wakeupId);
    return row ? readWorkWakeup(row) : null;
  }

  private recoverExpiredWorkWakeupsSync(nowIso: string): OuiWorkWakeupRecord[] {
    const expiredRows = this.getAll(
      `
        SELECT * FROM oui_work_wakeups
        WHERE status = 'running'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= ?
        ORDER BY lease_expires_at ASC, id ASC
      `,
      nowIso,
    );
    const recovered: OuiWorkWakeupRecord[] = [];
    for (const row of expiredRows) {
      const wakeup = readWorkWakeup(row);
      const retryable = wakeup.attempts < wakeup.maxAttempts;
      this.run(
        `
          UPDATE oui_work_wakeups
          SET status = ?,
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL,
              queued_at = CASE WHEN ? = 'queued' THEN ? ELSE queued_at END,
              finished_at = CASE WHEN ? = 'failed' THEN ? ELSE finished_at END,
              error = CASE
                WHEN ? = 'failed' THEN 'Work wakeup lease expired.'
                ELSE error
              END,
              updated_at = ?
          WHERE id = ? AND status = 'running'
        `,
        retryable ? "queued" : "failed",
        retryable ? "queued" : "failed",
        nowIso,
        retryable ? "queued" : "failed",
        nowIso,
        retryable ? "queued" : "failed",
        nowIso,
        wakeup.id,
      );
      recovered.push(this.requireWorkWakeup(wakeup.id));
    }
    return recovered;
  }

  private getArtifactSync(artifactId: string): OuiArtifactRecord | null {
    const row = this.getOne("SELECT * FROM oui_artifacts WHERE id = ?", artifactId);
    return row ? readArtifact(row) : null;
  }

  private getMeetingSync(meetingId: string): OuiMeetingRecord | null {
    const row = this.getOne("SELECT * FROM oui_meetings WHERE id = ?", meetingId);
    return row ? readMeeting(row) : null;
  }

  private getMeetingMessageSync(messageId: string): OuiMeetingMessageRecord | null {
    const row = this.getOne("SELECT * FROM oui_meeting_messages WHERE id = ?", messageId);
    return row ? readMeetingMessage(row) : null;
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private getOne(sql: string, ...values: SqlValue[]): SqlRow | null {
    const result = this.db.prepare(sql).get(...values) as unknown;
    return result && typeof result === "object" ? (result as SqlRow) : null;
  }

  private getAll(sql: string, ...values: SqlValue[]): SqlRow[] {
    return this.db.prepare(sql).all(...values) as SqlRow[];
  }

  private run(sql: string, ...values: SqlValue[]): number {
    return runChanges(this.db.prepare(sql).run(...values));
  }
}
