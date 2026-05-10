import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  OuiAgentRecord,
  OuiAgentStatus,
  OuiCompanyRecord,
  OuiCompanyStatus,
  OuiConversationRecord,
  OuiConversationStatus,
  OuiCostEventRecord,
  OuiAppendMessageInput,
  OuiCreateAgentInput,
  OuiCreateCompanyInput,
  OuiCreateInboxItemInput,
  OuiCreateRunbookDraftInput,
  OuiCreateRunbookDraftResult,
  OuiCreateTaskInput,
  OuiGetOrCreateConversationInput,
  OuiInboxItemRecord,
  OuiInboxItemStatus,
  OuiMessageRecord,
  OuiMessageRole,
  OuiProductStore,
  OuiResolveInboxItemInput,
  OuiRoleRecord,
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
      if (!["draft", "pending_approval", "approved", "active"].includes(version.status)) {
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

  async listWorkNodes(
    companyId: string,
    runbookVersionId?: string | null,
  ): Promise<OuiWorkNodeRecord[]> {
    return this.listWorkNodesSync(companyId, runbookVersionId);
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
            assigned_agent_id = excluded.assigned_agent_id,
            summary = excluded.summary,
            input_json = excluded.input_json,
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

  private requireInboxItem(itemId: string): OuiInboxItemRecord {
    const item = this.getInboxItemSync(itemId);
    if (!item) {
      throw new Error(`OUI inbox item not found: ${itemId}`);
    }
    return item;
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

  private getInboxItemSync(itemId: string): OuiInboxItemRecord | null {
    const row = this.getOne("SELECT * FROM oui_inbox_items WHERE id = ?", itemId);
    return row ? readInboxItem(row) : null;
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
