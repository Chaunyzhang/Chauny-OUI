import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { redactLogMessage } from "../security/redaction.ts";
import type {
  OuiAdapterKind,
  OuiClaimRunOptions,
  OuiEnqueueRunInput,
  OuiFinishRunInput,
  OuiHeartbeatOptions,
  OuiJsonObject,
  OuiLeasedRun,
  OuiLogLevel,
  OuiRecoveryReport,
  OuiRunLogEntry,
  OuiRunRecord,
  OuiRunStatus,
  OuiRunStore,
} from "../shared/types.ts";
import { runOuiMigrations } from "./migrations.ts";

type SqlValue = null | number | string;
type SqlRow = Record<string, unknown>;

const TERMINAL_STATUSES = new Set<OuiRunStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
]);

const DEFAULT_MAX_LOGS_PER_RUN = 400;
const DEFAULT_MAX_LOG_LENGTH = 8_000;

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

function parseNullableJsonObject(value: unknown): OuiJsonObject | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  return parseJsonObject(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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

function readRun(row: SqlRow): OuiRunRecord {
  return {
    id: requiredString(row, "id"),
    adapterId: requiredString(row, "adapter_id"),
    adapterKind: requiredString(row, "adapter_kind") as OuiAdapterKind,
    agentId: optionalString(row.agent_id),
    sessionKey: optionalString(row.session_key),
    status: requiredString(row, "status") as OuiRunStatus,
    input: parseJsonObject(row.input_json),
    attempts: requiredNumber(row, "attempts"),
    maxAttempts: requiredNumber(row, "max_attempts"),
    leaseOwner: optionalString(row.lease_owner),
    leaseToken: optionalString(row.lease_token),
    leaseExpiresAt: optionalString(row.lease_expires_at),
    heartbeatAt: optionalString(row.heartbeat_at),
    queuedAt: requiredString(row, "queued_at"),
    startedAt: optionalString(row.started_at),
    finishedAt: optionalString(row.finished_at),
    updatedAt: requiredString(row, "updated_at"),
    cancelRequestedAt: optionalString(row.cancel_requested_at),
    result: parseNullableJsonObject(row.result_json),
    error: optionalString(row.error),
  };
}

function readLog(row: SqlRow): OuiRunLogEntry {
  return {
    id: requiredString(row, "id"),
    runId: requiredString(row, "run_id"),
    seq: requiredNumber(row, "seq"),
    level: requiredString(row, "level") as OuiLogLevel,
    message: requiredString(row, "message"),
    createdAt: requiredString(row, "created_at"),
  };
}

function runChanges(result: unknown): number {
  if (result && typeof result === "object" && "changes" in result) {
    const changes = (result as { changes?: unknown }).changes;
    return typeof changes === "number" ? changes : 0;
  }
  return 0;
}

export type OuiSqliteRunStoreOptions = {
  maxLogsPerRun?: number;
  maxLogLength?: number;
};

export class OuiSqliteRunStore implements OuiRunStore {
  private readonly maxLogsPerRun: number;
  private readonly maxLogLength: number;

  constructor(
    private readonly db: DatabaseSync,
    options: OuiSqliteRunStoreOptions = {},
  ) {
    this.maxLogsPerRun = options.maxLogsPerRun ?? DEFAULT_MAX_LOGS_PER_RUN;
    this.maxLogLength = options.maxLogLength ?? DEFAULT_MAX_LOG_LENGTH;
  }

  static open(path: string, options: OuiSqliteRunStoreOptions = {}): OuiSqliteRunStore {
    const db = new DatabaseSync(path, { timeout: 5000 });
    runOuiMigrations(db);
    return new OuiSqliteRunStore(db, options);
  }

  close(): void {
    this.db.close();
  }

  async enqueueRun(input: OuiEnqueueRunInput): Promise<OuiRunRecord> {
    const now = toIsoDate(input.now);
    const id = input.id ?? randomUUID();
    const maxAttempts = input.maxAttempts ?? 1;
    this.db
      .prepare(
        `
        INSERT INTO oui_runs (
          id, adapter_id, adapter_kind, agent_id, session_key, status, input_json,
          attempts, max_attempts, queued_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?)
      `,
      )
      .run(
        id,
        input.adapterId,
        input.adapterKind,
        input.agentId ?? null,
        input.sessionKey ?? null,
        JSON.stringify(input.input),
        maxAttempts,
        now,
        now,
      );
    this.recordAudit("run", id, "run.queued", { adapterId: input.adapterId }, now);
    const run = this.getRunSync(id);
    if (!run) {
      throw new Error(`Failed to read enqueued OUI run: ${id}`);
    }
    return run;
  }

  async getRun(runId: string): Promise<OuiRunRecord | null> {
    return this.getRunSync(runId);
  }

  async claimNextRun(options: OuiClaimRunOptions): Promise<OuiLeasedRun | null> {
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + options.leaseMs).toISOString();
    return this.transaction(() => {
      const row = this.getOne(
        `
          SELECT * FROM oui_runs
          WHERE status = 'queued'
          ORDER BY queued_at ASC, id ASC
          LIMIT 1
        `,
      );
      if (!row) {
        return null;
      }
      const runId = requiredString(row, "id");
      const changes = this.run(
        `
          UPDATE oui_runs
          SET status = 'starting',
              attempts = attempts + 1,
              lease_owner = ?,
              lease_token = ?,
              lease_expires_at = ?,
              heartbeat_at = ?,
              updated_at = ?
          WHERE id = ? AND status = 'queued'
        `,
        options.workerId,
        leaseToken,
        leaseExpiresAt,
        nowIso,
        nowIso,
        runId,
      );
      if (changes !== 1) {
        return null;
      }
      this.recordAudit("run", runId, "run.claimed", { workerId: options.workerId }, nowIso);
      const run = this.getRunSync(runId);
      if (!run) {
        return null;
      }
      return { run, leaseToken };
    });
  }

  async heartbeatRunLease(options: OuiHeartbeatOptions): Promise<OuiRunRecord | null> {
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + options.leaseMs).toISOString();
    const changes = this.run(
      `
        UPDATE oui_runs
        SET lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
        WHERE id = ?
          AND lease_owner = ?
          AND lease_token = ?
          AND status IN ('starting', 'running')
          AND lease_expires_at > ?
      `,
      leaseExpiresAt,
      nowIso,
      nowIso,
      options.runId,
      options.workerId,
      options.leaseToken,
      nowIso,
    );
    return changes === 1 ? this.getRunSync(options.runId) : null;
  }

  async startLeasedRun(input: {
    runId: string;
    workerId: string;
    leaseToken: string;
    now?: Date;
  }): Promise<OuiRunRecord | null> {
    const nowIso = toIsoDate(input.now);
    const changes = this.run(
      `
        UPDATE oui_runs
        SET status = 'running',
            started_at = COALESCE(started_at, ?),
            updated_at = ?
        WHERE id = ?
          AND lease_owner = ?
          AND lease_token = ?
          AND status = 'starting'
          AND lease_expires_at > ?
      `,
      nowIso,
      nowIso,
      input.runId,
      input.workerId,
      input.leaseToken,
      nowIso,
    );
    if (changes === 1) {
      this.recordAudit("run", input.runId, "run.started", { workerId: input.workerId }, nowIso);
      return this.getRunSync(input.runId);
    }
    return null;
  }

  async finishRun(input: OuiFinishRunInput): Promise<OuiRunRecord | null> {
    const nowIso = toIsoDate(input.now);
    return this.transaction(() => {
      const existing = this.getRunSync(input.runId);
      if (!existing) {
        return null;
      }
      if (TERMINAL_STATUSES.has(existing.status)) {
        return existing;
      }
      const changes = this.run(
        `
          UPDATE oui_runs
          SET status = ?,
              finished_at = ?,
              updated_at = ?,
              result_json = ?,
              error = ?,
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL
          WHERE id = ?
            AND lease_owner = ?
            AND lease_token = ?
            AND status IN ('starting', 'running')
            AND lease_expires_at > ?
        `,
        input.status,
        nowIso,
        nowIso,
        input.result ? JSON.stringify(input.result) : null,
        input.error ?? null,
        input.runId,
        input.workerId,
        input.leaseToken,
        nowIso,
      );
      if (changes !== 1) {
        return null;
      }
      this.recordAudit("run", input.runId, `run.${input.status}`, {}, nowIso);
      return this.getRunSync(input.runId);
    });
  }

  async requestCancel(input: { runId: string; now?: Date }): Promise<OuiRunRecord | null> {
    const nowIso = toIsoDate(input.now);
    const changes = this.run(
      `
        UPDATE oui_runs
        SET cancel_requested_at = ?, updated_at = ?
        WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out', 'blocked')
      `,
      nowIso,
      nowIso,
      input.runId,
    );
    if (changes === 1) {
      this.recordAudit("run", input.runId, "run.cancel_requested", {}, nowIso);
    }
    return this.getRunSync(input.runId);
  }

  async appendLog(input: {
    runId: string;
    level: OuiLogLevel;
    message: string;
    now?: Date;
  }): Promise<OuiRunLogEntry> {
    const createdAt = toIsoDate(input.now);
    const id = randomUUID();
    const seqRow = this.getOne(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM oui_run_logs WHERE run_id = ?",
      input.runId,
    );
    const seq = seqRow ? requiredNumber(seqRow, "seq") : 1;
    const message = redactLogMessage(input.message, this.maxLogLength);
    this.run(
      `
        INSERT INTO oui_run_logs(id, run_id, seq, level, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      id,
      input.runId,
      seq,
      input.level,
      message,
      createdAt,
    );
    this.run(
      `
        DELETE FROM oui_run_logs
        WHERE run_id = ?
          AND seq NOT IN (
            SELECT seq FROM oui_run_logs
            WHERE run_id = ?
            ORDER BY seq DESC
            LIMIT ?
          )
      `,
      input.runId,
      input.runId,
      this.maxLogsPerRun,
    );
    const row = this.getOne("SELECT * FROM oui_run_logs WHERE id = ?", id);
    if (!row) {
      throw new Error(`Failed to read OUI run log entry: ${id}`);
    }
    return readLog(row);
  }

  async listLogs(runId: string): Promise<OuiRunLogEntry[]> {
    return this.getAll("SELECT * FROM oui_run_logs WHERE run_id = ? ORDER BY seq ASC", runId).map(
      readLog,
    );
  }

  async recoverExpiredLeases(input: { now?: Date }): Promise<OuiRecoveryReport> {
    const nowIso = toIsoDate(input.now);
    return this.transaction(() => {
      const expired = this.getAll(
        `
          SELECT * FROM oui_runs
          WHERE status IN ('starting', 'running')
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at <= ?
        `,
        nowIso,
      ).map(readRun);
      let requeued = 0;
      let failed = 0;
      for (const run of expired) {
        if (run.attempts < run.maxAttempts) {
          const changes = this.run(
            `
              UPDATE oui_runs
              SET status = 'queued',
                  lease_owner = NULL,
                  lease_token = NULL,
                  lease_expires_at = NULL,
                  heartbeat_at = NULL,
                  updated_at = ?
              WHERE id = ?
            `,
            nowIso,
            run.id,
          );
          if (changes === 1) {
            requeued += 1;
            this.recordAudit("run", run.id, "run.recovered_requeued", {}, nowIso);
          }
          continue;
        }
        const changes = this.run(
          `
            UPDATE oui_runs
            SET status = 'failed',
                finished_at = ?,
                updated_at = ?,
                error = ?,
                lease_owner = NULL,
                lease_token = NULL,
                lease_expires_at = NULL
            WHERE id = ?
          `,
          nowIso,
          nowIso,
          "Run lease expired.",
          run.id,
        );
        if (changes === 1) {
          failed += 1;
          this.recordAudit("run", run.id, "run.recovered_failed", {}, nowIso);
        }
      }
      return { inspected: expired.length, requeued, failed };
    });
  }

  private getRunSync(runId: string): OuiRunRecord | null {
    const row = this.getOne("SELECT * FROM oui_runs WHERE id = ?", runId);
    return row ? readRun(row) : null;
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

  private recordAudit(
    entityType: string,
    entityId: string,
    action: string,
    details: OuiJsonObject,
    createdAt: string,
  ): void {
    this.run(
      `
        INSERT INTO oui_audit_events(id, entity_type, entity_id, action, details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      randomUUID(),
      entityType,
      entityId,
      action,
      JSON.stringify(details),
      createdAt,
    );
  }
}
