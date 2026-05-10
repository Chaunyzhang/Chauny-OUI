import type { DatabaseSync } from "node:sqlite";

export const OUI_DB_SCHEMA_VERSION = 1;
export const OUI_DB_LATEST_SCHEMA_VERSION = 4;

function tableHasColumn(db: DatabaseSync, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: unknown }>;
  return rows.some((row) => row.name === columnName);
}

function addColumnIfMissing(db: DatabaseSync, tableName: string, definition: string): void {
  const columnName = definition.trim().split(/\s+/, 1)[0];
  if (!columnName || tableHasColumn(db, tableName, columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function hasRows(db: DatabaseSync, sql: string): boolean {
  return Boolean(db.prepare(sql).get());
}

function removeEmptyLegacyDefaultCompany(db: DatabaseSync): void {
  const legacy = db.prepare("SELECT id, name FROM oui_companies WHERE id = 'default'").get() as
    | { id?: unknown; name?: unknown }
    | undefined;
  if (!legacy || legacy.name !== "OUI Company") {
    return;
  }

  const hasUserWork =
    hasRows(db, "SELECT 1 FROM oui_tasks WHERE company_id = 'default' LIMIT 1") ||
    hasRows(db, "SELECT 1 FROM oui_runbooks WHERE company_id = 'default' LIMIT 1") ||
    hasRows(db, "SELECT 1 FROM oui_inbox_items WHERE company_id = 'default' LIMIT 1") ||
    hasRows(db, "SELECT 1 FROM oui_artifacts WHERE company_id = 'default' LIMIT 1") ||
    hasRows(db, "SELECT 1 FROM oui_conversations WHERE company_id = 'default' LIMIT 1") ||
    hasRows(db, "SELECT 1 FROM oui_runs WHERE company_id = 'default' LIMIT 1");
  if (!hasUserWork) {
    db.prepare("DELETE FROM oui_companies WHERE id = 'default'").run();
  }
}

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
      company_id TEXT,
      runbook_version_id TEXT,
      stage_id TEXT,
      parent_run_id TEXT,
      invocation_source TEXT,
      idempotency_key TEXT,
      result_artifact_id TEXT,
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
      description TEXT,
      mode TEXT NOT NULL DEFAULT 'project',
      status TEXT NOT NULL DEFAULT 'idle',
      ceo_agent_id TEXT,
      default_leader_agent_id TEXT,
      current_runbook_version_id TEXT,
      current_objective TEXT,
      current_stage TEXT,
      autonomy_policy_json TEXT NOT NULL DEFAULT '{}',
      reporting_preference_json TEXT NOT NULL DEFAULT '{}',
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

    CREATE TABLE IF NOT EXISTS oui_conversations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES oui_companies(id) ON DELETE CASCADE,
      ceo_agent_id TEXT REFERENCES oui_agents(id) ON DELETE SET NULL,
      title TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oui_conversations_company
      ON oui_conversations(company_id, updated_at);

    CREATE TABLE IF NOT EXISTS oui_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES oui_conversations(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES oui_companies(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oui_messages_conversation
      ON oui_messages(conversation_id, created_at, id);

    CREATE TABLE IF NOT EXISTS oui_runbooks (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES oui_companies(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      active_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oui_runbooks_company
      ON oui_runbooks(company_id, updated_at);

    CREATE TABLE IF NOT EXISTS oui_runbook_versions (
      id TEXT PRIMARY KEY,
      runbook_id TEXT NOT NULL REFERENCES oui_runbooks(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES oui_companies(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      objective TEXT NOT NULL,
      operating_mode TEXT NOT NULL,
      stages_json TEXT NOT NULL,
      decision_points_json TEXT NOT NULL DEFAULT '[]',
      artifact_policy_json TEXT NOT NULL DEFAULT '{}',
      pause_policy_json TEXT NOT NULL DEFAULT '{}',
      report_policy_json TEXT NOT NULL DEFAULT '{}',
      markdown_path TEXT,
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(runbook_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_oui_runbook_versions_company_status
      ON oui_runbook_versions(company_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS oui_inbox_items (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES oui_companies(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      title TEXT NOT NULL,
      summary TEXT,
      runbook_version_id TEXT REFERENCES oui_runbook_versions(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES oui_tasks(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES oui_runs(id) ON DELETE SET NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      resolution_json TEXT,
      created_by TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oui_inbox_items_company_status
      ON oui_inbox_items(company_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS oui_work_nodes (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES oui_companies(id) ON DELETE CASCADE,
      runbook_version_id TEXT NOT NULL REFERENCES oui_runbook_versions(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL,
      title TEXT NOT NULL,
      node_type TEXT NOT NULL,
      status TEXT NOT NULL,
      assigned_agent_id TEXT REFERENCES oui_agents(id) ON DELETE SET NULL,
      order_index INTEGER NOT NULL,
      summary TEXT,
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      run_id TEXT REFERENCES oui_runs(id) ON DELETE SET NULL,
      inbox_item_id TEXT REFERENCES oui_inbox_items(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(runbook_version_id, order_index)
    );

    CREATE INDEX IF NOT EXISTS idx_oui_work_nodes_company_status
      ON oui_work_nodes(company_id, status, order_index);

    CREATE INDEX IF NOT EXISTS idx_oui_work_nodes_runbook_order
      ON oui_work_nodes(runbook_version_id, order_index);

    CREATE TABLE IF NOT EXISTS oui_artifacts (
      id TEXT PRIMARY KEY,
      company_id TEXT REFERENCES oui_companies(id) ON DELETE CASCADE,
      artifact_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      path TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oui_artifacts_company
      ON oui_artifacts(company_id, created_at);

    CREATE TABLE IF NOT EXISTS oui_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES oui_runs(id) ON DELETE CASCADE,
      company_id TEXT REFERENCES oui_companies(id) ON DELETE SET NULL,
      seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(run_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_oui_run_events_run_seq
      ON oui_run_events(run_id, seq);

    CREATE TABLE IF NOT EXISTS oui_audit_log (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      company_id TEXT REFERENCES oui_companies(id) ON DELETE SET NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  addColumnIfMissing(db, "oui_runs", "company_id TEXT");
  addColumnIfMissing(db, "oui_runs", "runbook_version_id TEXT");
  addColumnIfMissing(db, "oui_runs", "stage_id TEXT");
  addColumnIfMissing(db, "oui_runs", "parent_run_id TEXT");
  addColumnIfMissing(db, "oui_runs", "invocation_source TEXT");
  addColumnIfMissing(db, "oui_runs", "idempotency_key TEXT");
  addColumnIfMissing(db, "oui_runs", "result_artifact_id TEXT");
  addColumnIfMissing(db, "oui_companies", "description TEXT");
  addColumnIfMissing(db, "oui_companies", "mode TEXT NOT NULL DEFAULT 'project'");
  addColumnIfMissing(db, "oui_companies", "status TEXT NOT NULL DEFAULT 'idle'");
  addColumnIfMissing(db, "oui_companies", "ceo_agent_id TEXT");
  addColumnIfMissing(db, "oui_companies", "current_runbook_version_id TEXT");
  addColumnIfMissing(db, "oui_companies", "current_objective TEXT");
  addColumnIfMissing(db, "oui_companies", "current_stage TEXT");
  addColumnIfMissing(db, "oui_companies", "autonomy_policy_json TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, "oui_companies", "reporting_preference_json TEXT NOT NULL DEFAULT '{}'");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oui_companies_status
      ON oui_companies(status);

    CREATE INDEX IF NOT EXISTS idx_oui_companies_ceo
      ON oui_companies(ceo_agent_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_oui_runs_company_idempotency
      ON oui_runs(company_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
  removeEmptyLegacyDefaultCompany(db);

  const now = new Date().toISOString();
  for (const version of [OUI_DB_SCHEMA_VERSION, 2, 3, OUI_DB_LATEST_SCHEMA_VERSION]) {
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
