import type { DatabaseSync } from "node:sqlite";

export const OUI_DB_SCHEMA_VERSION = 1;
export const OUI_DB_LATEST_SCHEMA_VERSION = 2;

export function configureOuiSqlite(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
}

export function runOuiMigrations(db: DatabaseSync): void {
  configureOuiSqlite(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS oui_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oui_runs (
      id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      adapter_kind TEXT NOT NULL,
      agent_id TEXT,
      session_key TEXT,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      lease_owner TEXT,
      lease_token TEXT,
      lease_expires_at TEXT,
      heartbeat_at TEXT,
      queued_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL,
      cancel_requested_at TEXT,
      result_json TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_oui_runs_queue
      ON oui_runs(status, queued_at, id);

    CREATE INDEX IF NOT EXISTS idx_oui_runs_lease
      ON oui_runs(status, lease_expires_at);

    CREATE TABLE IF NOT EXISTS oui_run_logs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES oui_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_oui_run_logs_run_seq
      ON oui_run_logs(run_id, seq);

    CREATE TABLE IF NOT EXISTS oui_audit_events (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oui_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      default_leader_agent_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oui_roles (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES oui_companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_role_id TEXT REFERENCES oui_roles(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oui_roles_company
      ON oui_roles(company_id);

    CREATE TABLE IF NOT EXISTS oui_agents (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES oui_companies(id) ON DELETE CASCADE,
      adapter_id TEXT NOT NULL,
      adapter_kind TEXT NOT NULL,
      label TEXT NOT NULL,
      role_id TEXT REFERENCES oui_roles(id) ON DELETE SET NULL,
      reports_to_agent_id TEXT REFERENCES oui_agents(id) ON DELETE SET NULL,
      openclaw_agent_id TEXT,
      model_ref TEXT,
      status TEXT NOT NULL,
      is_leader INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oui_agents_company
      ON oui_agents(company_id);

    CREATE TABLE IF NOT EXISTS oui_tasks (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES oui_companies(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      review_state TEXT NOT NULL,
      assigned_agent_id TEXT REFERENCES oui_agents(id) ON DELETE SET NULL,
      created_by TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oui_tasks_company_status
      ON oui_tasks(company_id, status, priority, created_at);

    CREATE TABLE IF NOT EXISTS oui_task_dependencies (
      task_id TEXT NOT NULL REFERENCES oui_tasks(id) ON DELETE CASCADE,
      depends_on_task_id TEXT NOT NULL REFERENCES oui_tasks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(task_id, depends_on_task_id)
    );

    CREATE TABLE IF NOT EXISTS oui_task_runs (
      task_id TEXT NOT NULL REFERENCES oui_tasks(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES oui_runs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(task_id, run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_oui_task_runs_run
      ON oui_task_runs(run_id);

    CREATE TABLE IF NOT EXISTS oui_cost_events (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES oui_runs(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES oui_tasks(id) ON DELETE SET NULL,
      agent_id TEXT REFERENCES oui_agents(id) ON DELETE SET NULL,
      amount_micros INTEGER,
      currency TEXT,
      usage_json TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oui_cost_events_run
      ON oui_cost_events(run_id);
  `);

  const now = new Date().toISOString();
  for (const version of [OUI_DB_SCHEMA_VERSION, OUI_DB_LATEST_SCHEMA_VERSION]) {
    const existing = db
      .prepare("SELECT version FROM oui_schema_migrations WHERE version = ?")
      .get(version);
    if (!existing) {
      db.prepare("INSERT INTO oui_schema_migrations(version, applied_at) VALUES (?, ?)").run(
        version,
        now,
      );
    }
  }
}
