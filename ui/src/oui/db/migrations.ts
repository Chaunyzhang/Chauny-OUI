import type { DatabaseSync } from "node:sqlite";

export const OUI_DB_SCHEMA_VERSION = 1;

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
  `);

  const existing = db
    .prepare("SELECT version FROM oui_schema_migrations WHERE version = ?")
    .get(OUI_DB_SCHEMA_VERSION);
  if (!existing) {
    db.prepare("INSERT INTO oui_schema_migrations(version, applied_at) VALUES (?, ?)").run(
      OUI_DB_SCHEMA_VERSION,
      new Date().toISOString(),
    );
  }
}
