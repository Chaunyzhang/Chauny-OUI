import type {
  OuiAgentRecord,
  OuiCompanyRecord,
  OuiEmployeeAdapterPreview,
  OuiTaskRecord,
  OuiTaskReviewState,
  OuiTaskTimeline,
} from "../../oui/shared/product-types.ts";
import type { ParallelChatPane } from "../chat/parallel-chat.ts";
import { normalizeAgentId } from "../session-key.ts";
import type { AgentsListResult, GatewayAgentRow } from "../types.ts";

export type OuiCompanyMessage = { kind: "success" | "error"; text: string };

export type OuiCompanyUiState = {
  agentsList: AgentsListResult | null;
  chatParallelPanes: ParallelChatPane[];
  ouiCompanyLoading: boolean;
  ouiCompanyBusy: boolean;
  ouiCompanyApiAvailable: boolean;
  ouiCompanyError: string | null;
  ouiCompanyMessage: OuiCompanyMessage | null;
  ouiCompanyRecord: OuiCompanyRecord | null;
  ouiCompanyAgents: OuiAgentRecord[];
  ouiCompanyTasks: OuiTaskRecord[];
  ouiCompanyAdapters: OuiEmployeeAdapterPreview[];
  ouiCompanyTimeline: OuiTaskTimeline | null;
  ouiCompanySelectedTaskId: string | null;
  ouiTaskDraftTitle: string;
  ouiTaskDraftDescription: string;
  ouiTaskDraftAgentId: string;
  requestUpdate?: () => void;
};

type CompanyBody = {
  company?: OuiCompanyRecord;
  agents?: OuiAgentRecord[];
  tasks?: OuiTaskRecord[];
};

type AdapterPreviewBody = {
  adapters?: OuiEmployeeAdapterPreview[];
};

type TaskBody = {
  task?: OuiTaskRecord;
};

const DEFAULT_COMPANY_ID = "default";
const OUI_API_BASE = "/api/oui";

function markChanged(state: OuiCompanyUiState) {
  state.requestUpdate?.();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text) as unknown;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${OUI_API_BASE}${path}`, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const body = await readResponseJson(response);
  if (!response.ok) {
    const record = asRecord(body);
    const message = optionalString(record.message) ?? optionalString(record.error);
    throw new Error(message ?? `OUI API request failed: ${response.status}`);
  }
  return body as T;
}

function slugForOuiAgentId(agentId: string): string {
  return (
    agentId
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 96) || "main"
  );
}

export function ouiOpenClawAgentRecordId(openclawAgentId: string | null | undefined): string {
  return `openclaw-${slugForOuiAgentId(normalizeAgentId(openclawAgentId ?? "main"))}`;
}

function agentRowLabel(row: GatewayAgentRow | undefined, fallbackId: string): string {
  return (
    optionalString(row?.identity?.name) ??
    optionalString(row?.name) ??
    optionalString(row?.id) ??
    fallbackId
  );
}

function agentRowModelRef(row: GatewayAgentRow | undefined): string | null {
  return optionalString(row?.model?.primary) ?? null;
}

function resolveOpenClawAgentRows(agentsList: AgentsListResult | null): GatewayAgentRow[] {
  const rows = new Map<string, GatewayAgentRow>();
  const add = (row: GatewayAgentRow | undefined, fallbackId?: string) => {
    const id = normalizeAgentId(row?.id ?? fallbackId ?? "main");
    if (!rows.has(id)) {
      rows.set(id, { ...row, id });
    }
  };
  add(
    agentsList?.agents.find(
      (row) => normalizeAgentId(row.id) === normalizeAgentId(agentsList?.defaultId ?? "main"),
    ),
    agentsList?.defaultId ?? "main",
  );
  for (const row of agentsList?.agents ?? []) {
    add(row);
  }
  return Array.from(rows.values());
}

function resolveDefaultOpenClawRow(agentsList: AgentsListResult | null): GatewayAgentRow {
  return resolveOpenClawAgentRows(agentsList)[0] ?? { id: "main", name: "OpenClaw Leader" };
}

function buildCompanyFallback(state: OuiCompanyUiState, error: string) {
  const row = resolveDefaultOpenClawRow(state.agentsList);
  const id = normalizeAgentId(row.id);
  const now = new Date().toISOString();
  const leaderId = ouiOpenClawAgentRecordId(id);
  state.ouiCompanyRecord = {
    id: DEFAULT_COMPANY_ID,
    name: "OUI Company",
    defaultLeaderAgentId: leaderId,
    createdAt: now,
    updatedAt: now,
  };
  state.ouiCompanyAgents = [
    {
      id: leaderId,
      companyId: DEFAULT_COMPANY_ID,
      adapterId: "openclaw-local",
      adapterKind: "openclaw",
      label: agentRowLabel(row, "OpenClaw Leader"),
      roleId: null,
      reportsToAgentId: null,
      openclawAgentId: id,
      modelRef: agentRowModelRef(row),
      status: "active",
      isLeader: true,
      config: {},
      createdAt: now,
      updatedAt: now,
    },
  ];
  state.ouiCompanyTasks = [];
  state.ouiCompanyAdapters = [];
  state.ouiCompanyTimeline = null;
  state.ouiCompanyApiAvailable = false;
  state.ouiCompanyError = error;
}

async function ensureDefaultCompany(state: OuiCompanyUiState) {
  const row = resolveDefaultOpenClawRow(state.agentsList);
  const openclawAgentId = normalizeAgentId(row.id);
  await fetchJson("/companies/default", {
    method: "POST",
    body: JSON.stringify({
      companyId: DEFAULT_COMPANY_ID,
      name: "OUI Company",
      openclawLeader: {
        id: ouiOpenClawAgentRecordId(openclawAgentId),
        label: agentRowLabel(row, "OpenClaw Leader"),
        openclawAgentId,
        adapterId: "openclaw-local",
        modelRef: agentRowModelRef(row),
      },
    }),
  });
}

async function syncOpenClawAgent(
  companyId: string,
  row: GatewayAgentRow,
  leaderId: string | null | undefined,
) {
  const openclawAgentId = normalizeAgentId(row.id);
  const id = ouiOpenClawAgentRecordId(openclawAgentId);
  if (id === leaderId) {
    return;
  }
  await fetchJson(`/companies/${encodeURIComponent(companyId)}/agents`, {
    method: "POST",
    body: JSON.stringify({
      id,
      adapterId: "openclaw-local",
      adapterKind: "openclaw",
      label: agentRowLabel(row, openclawAgentId),
      reportsToAgentId: leaderId ?? null,
      openclawAgentId,
      modelRef: agentRowModelRef(row),
    }),
  });
}

async function syncOpenClawAgents(state: OuiCompanyUiState, company: OuiCompanyRecord) {
  for (const row of resolveOpenClawAgentRows(state.agentsList)) {
    await syncOpenClawAgent(company.id, row, company.defaultLeaderAgentId);
  }
}

function applyCompanyBody(state: OuiCompanyUiState, body: CompanyBody) {
  state.ouiCompanyRecord = body.company ?? null;
  state.ouiCompanyAgents = Array.isArray(body.agents) ? body.agents : [];
  state.ouiCompanyTasks = Array.isArray(body.tasks) ? body.tasks : [];
  if (
    state.ouiCompanySelectedTaskId &&
    !state.ouiCompanyTasks.some((task) => task.id === state.ouiCompanySelectedTaskId)
  ) {
    state.ouiCompanySelectedTaskId = null;
  }
  state.ouiCompanySelectedTaskId =
    state.ouiCompanySelectedTaskId ?? state.ouiCompanyTasks[0]?.id ?? null;
}

async function reloadCompany(state: OuiCompanyUiState, companyId = DEFAULT_COMPANY_ID) {
  const body = await fetchJson<CompanyBody>(`/companies/${encodeURIComponent(companyId)}`);
  applyCompanyBody(state, body);
}

async function reloadAdapters(state: OuiCompanyUiState) {
  const body = await fetchJson<AdapterPreviewBody>("/adapters/previews");
  state.ouiCompanyAdapters = Array.isArray(body.adapters) ? body.adapters : [];
}

export async function loadOuiCompany(state: OuiCompanyUiState) {
  state.ouiCompanyLoading = true;
  state.ouiCompanyError = null;
  markChanged(state);
  try {
    await ensureDefaultCompany(state);
    await reloadCompany(state);
    if (state.ouiCompanyRecord) {
      await syncOpenClawAgents(state, state.ouiCompanyRecord);
      await reloadCompany(state, state.ouiCompanyRecord.id);
    }
    try {
      await reloadAdapters(state);
    } catch {
      state.ouiCompanyAdapters = [];
    }
    if (state.ouiCompanySelectedTaskId) {
      await loadOuiTaskTimeline(state, state.ouiCompanySelectedTaskId, { silent: true });
    } else {
      state.ouiCompanyTimeline = null;
    }
    state.ouiCompanyApiAvailable = true;
  } catch (error) {
    buildCompanyFallback(state, formatError(error));
  } finally {
    state.ouiCompanyLoading = false;
    markChanged(state);
  }
}

export async function createOuiTask(state: OuiCompanyUiState) {
  const title = state.ouiTaskDraftTitle.trim();
  if (!title) {
    state.ouiCompanyMessage = { kind: "error", text: "Task title is required." };
    markChanged(state);
    return;
  }
  const companyId = state.ouiCompanyRecord?.id ?? DEFAULT_COMPANY_ID;
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<TaskBody>(`/companies/${encodeURIComponent(companyId)}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title,
        description: state.ouiTaskDraftDescription.trim() || null,
        assignedAgentId: state.ouiTaskDraftAgentId || null,
      }),
    });
    const task = body.task;
    if (task) {
      state.ouiCompanySelectedTaskId = task.id;
      state.ouiTaskDraftTitle = "";
      state.ouiTaskDraftDescription = "";
      state.ouiCompanyMessage = { kind: "success", text: `Task created: ${task.title}` };
    }
    await reloadCompany(state, companyId);
    if (state.ouiCompanySelectedTaskId) {
      await loadOuiTaskTimeline(state, state.ouiCompanySelectedTaskId, { silent: true });
    }
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}

export async function selectOuiTask(state: OuiCompanyUiState, taskId: string) {
  state.ouiCompanySelectedTaskId = taskId;
  await loadOuiTaskTimeline(state, taskId);
}

export async function assignOuiTask(state: OuiCompanyUiState, taskId: string, agentId: string) {
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    await fetchJson(`/tasks/${encodeURIComponent(taskId)}/assign`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    });
    await reloadCompany(state, state.ouiCompanyRecord?.id ?? DEFAULT_COMPANY_ID);
    await loadOuiTaskTimeline(state, taskId, { silent: true });
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}

export async function queueOuiTaskRun(state: OuiCompanyUiState, taskId: string) {
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    const task = state.ouiCompanyTasks.find((entry) => entry.id === taskId);
    const result = await fetchJson<{ status?: string; run?: { id?: string } }>(
      `/tasks/${encodeURIComponent(taskId)}/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          sessionKey: "main",
          message: task ? [task.title, task.description].filter(Boolean).join("\n\n") : undefined,
        }),
      },
    );
    state.ouiCompanyMessage = {
      kind: result.status === "queued" ? "success" : "error",
      text:
        result.status === "queued"
          ? `Run queued: ${result.run?.id ?? "pending"}`
          : "Task is blocked.",
    };
    await reloadCompany(state, state.ouiCompanyRecord?.id ?? DEFAULT_COMPANY_ID);
    await loadOuiTaskTimeline(state, taskId, { silent: true });
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}

export async function transitionOuiTaskReview(
  state: OuiCompanyUiState,
  taskId: string,
  reviewState: OuiTaskReviewState,
) {
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    await fetchJson(`/tasks/${encodeURIComponent(taskId)}/review`, {
      method: "POST",
      body: JSON.stringify({ reviewState }),
    });
    await reloadCompany(state, state.ouiCompanyRecord?.id ?? DEFAULT_COMPANY_ID);
    await loadOuiTaskTimeline(state, taskId, { silent: true });
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}

export async function loadOuiTaskTimeline(
  state: OuiCompanyUiState,
  taskId: string,
  options: { silent?: boolean } = {},
) {
  if (!options.silent) {
    state.ouiCompanyBusy = true;
    markChanged(state);
  }
  try {
    state.ouiCompanyTimeline = await fetchJson<OuiTaskTimeline>(
      `/tasks/${encodeURIComponent(taskId)}/timeline`,
    );
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    if (!options.silent) {
      state.ouiCompanyBusy = false;
      markChanged(state);
    }
  }
}

export async function createOuiTaskFromParallelPane(state: OuiCompanyUiState, paneId: string) {
  const pane = state.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane) {
    return;
  }
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    await ensureDefaultCompany(state);
    await reloadCompany(state);
    const company = state.ouiCompanyRecord;
    if (!company) {
      throw new Error("OUI company is unavailable.");
    }
    const row =
      state.agentsList?.agents.find(
        (entry) => normalizeAgentId(entry.id) === normalizeAgentId(pane.agentId),
      ) ?? ({ id: pane.agentId, name: pane.agentId } as GatewayAgentRow);
    await syncOpenClawAgent(company.id, row, company.defaultLeaderAgentId);
    await reloadCompany(state, company.id);
    const assignedAgentId = ouiOpenClawAgentRecordId(pane.agentId);
    const title = pane.chatMessage.trim() || `Follow up with ${agentRowLabel(row, pane.agentId)}`;
    const body = await fetchJson<TaskBody>(`/companies/${encodeURIComponent(company.id)}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title,
        description: `Created from four-pane ${pane.index + 1}: ${pane.sessionKey}`,
        assignedAgentId,
      }),
    });
    if (body.task) {
      state.ouiCompanySelectedTaskId = body.task.id;
      state.ouiCompanyMessage = {
        kind: "success",
        text: `Task created from pane ${pane.index + 1}.`,
      };
    }
    await reloadCompany(state, company.id);
    if (state.ouiCompanySelectedTaskId) {
      await loadOuiTaskTimeline(state, state.ouiCompanySelectedTaskId, { silent: true });
    }
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}
