import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  OuiAgentRecord,
  OuiAgentStatus,
  OuiCompanyRecord,
  OuiCostEventRecord,
  OuiCreateAgentInput,
  OuiCreateTaskInput,
  OuiEnsureDefaultCompanyInput,
  OuiProductStore,
  OuiRoleRecord,
  OuiTaskDependencyRecord,
  OuiTaskReadiness,
  OuiTaskRecord,
  OuiTaskReviewState,
  OuiTaskRunLink,
  OuiTaskStatus,
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
    defaultLeaderAgentId: optionalString(row.default_leader_agent_id),
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

export class OuiSqliteProductStore implements OuiProductStore {
  constructor(private readonly db: DatabaseSync) {
    runOuiMigrations(db);
  }

  async ensureDefaultCompany(input: OuiEnsureDefaultCompanyInput = {}) {
    const companyId = input.companyId ?? "default";
    const now = toIsoDate(input.now);
    return this.transaction(() => {
      this.run(
        `
          INSERT INTO oui_companies(id, name, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            updated_at = excluded.updated_at
        `,
        companyId,
        input.name ?? "OUI Company",
        now,
        now,
      );

      const leaderRoleId = `${companyId}:leadership`;
      this.run(
        `
          INSERT INTO oui_roles(id, company_id, name, created_at, updated_at)
          VALUES (?, ?, 'Leadership', ?, ?)
          ON CONFLICT(id) DO NOTHING
        `,
        leaderRoleId,
        companyId,
        now,
        now,
      );

      let leader: OuiAgentRecord | null = null;
      if (input.openclawLeader) {
        leader = this.createAgentSync({
          id: input.openclawLeader.id ?? `${companyId}:openclaw-leader`,
          companyId,
          adapterId: input.openclawLeader.adapterId ?? "openclaw-local",
          adapterKind: "openclaw",
          label: input.openclawLeader.label ?? "OpenClaw Leader",
          roleId: leaderRoleId,
          reportsToAgentId: null,
          openclawAgentId: input.openclawLeader.openclawAgentId ?? null,
          modelRef: input.openclawLeader.modelRef ?? null,
          status: "active",
          isLeader: true,
          config: {},
          now: input.now,
        });
        this.run(
          "UPDATE oui_companies SET default_leader_agent_id = ?, updated_at = ? WHERE id = ?",
          leader.id,
          now,
          companyId,
        );
      }

      const company = this.getCompanySync(companyId);
      if (!company) {
        throw new Error(`Failed to create OUI company: ${companyId}`);
      }
      return { company, leader };
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
    const nowIso = toIsoDate(now);
    this.run(
      "UPDATE oui_companies SET default_leader_agent_id = ?, updated_at = ? WHERE id = ?",
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

  private createAgentSync(input: OuiCreateAgentInput): OuiAgentRecord {
    this.requireCompany(input.companyId);
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

  private requireCompany(companyId: string): OuiCompanyRecord {
    const company = this.getCompanySync(companyId);
    if (!company) {
      throw new Error(`OUI company not found: ${companyId}`);
    }
    return company;
  }

  private requireTask(taskId: string): OuiTaskRecord {
    const task = this.getTaskSync(taskId);
    if (!task) {
      throw new Error(`OUI task not found: ${taskId}`);
    }
    return task;
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
