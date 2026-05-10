import type {
  OuiAgentRecord,
  OuiCompanyMode,
  OuiCompanyRecord,
  OuiCompanySummary,
  OuiCompanyStatus,
  OuiControlRoomReadModel,
  OuiConversationRecord,
  OuiEmployeeAdapterPreview,
  OuiInboxItemRecord,
  OuiMessageRecord,
  OuiRunbookRecord,
  OuiRunbookVersionRecord,
  OuiTaskRecord,
  OuiTaskReviewState,
  OuiTaskTimeline,
  OuiWorkNodeRecord,
} from "../../oui/shared/product-types.ts";
import type { ParallelChatPane } from "../chat/parallel-chat.ts";
import { formatOuiCompanyError, ouiCompanyCopy } from "../oui-company-copy.ts";
import { normalizeAgentId } from "../session-key.ts";
import type { AgentsListResult, GatewayAgentRow } from "../types.ts";

export type OuiCompanyMessage = { kind: "success" | "error"; text: string };

export type OuiCompanyCeoCandidate = {
  id: string;
  label: string;
  modelRef: string | null;
};

export type OuiCompanyUiState = {
  agentsList: AgentsListResult | null;
  chatParallelPanes: ParallelChatPane[];
  ouiCompanyLoading: boolean;
  ouiCompanyBusy: boolean;
  ouiCompanyApiAvailable: boolean;
  ouiCompanyError: string | null;
  ouiCompanyMessage: OuiCompanyMessage | null;
  ouiCompanySummaries: OuiCompanySummary[];
  ouiCompanyRecord: OuiCompanyRecord | null;
  ouiCompanyAgents: OuiAgentRecord[];
  ouiCompanyCeoConversations: OuiConversationRecord[];
  ouiCompanyCeoMessages: OuiMessageRecord[];
  ouiCompanyTasks: OuiTaskRecord[];
  ouiCompanyRunbooks: OuiRunbookRecord[];
  ouiCompanyRunbookVersions: OuiRunbookVersionRecord[];
  ouiCompanyActiveRunbookVersion: OuiRunbookVersionRecord | null;
  ouiCompanyWorkNodes: OuiWorkNodeRecord[];
  ouiCompanyInboxItems: OuiInboxItemRecord[];
  ouiCompanyControlRoom: OuiControlRoomReadModel | null;
  ouiCompanyAdapters: OuiEmployeeAdapterPreview[];
  ouiCompanyTimeline: OuiTaskTimeline | null;
  ouiCompanySelectedTaskId: string | null;
  ouiCreateCompanyName: string;
  ouiCreateCompanyCeoId: string;
  ouiCompanyCeoDraft: string;
  ouiCompanyCeoConversationId: string | null;
  ouiTaskDraftTitle: string;
  ouiTaskDraftDescription: string;
  ouiTaskDraftAgentId: string;
  requestUpdate?: () => void;
};

type CompanyBody = {
  company?: OuiCompanyRecord;
  agents?: OuiAgentRecord[];
  ceoConversations?: OuiConversationRecord[];
  ceoMessages?: OuiMessageRecord[];
  tasks?: OuiTaskRecord[];
  runbooks?: OuiRunbookRecord[];
  runbookVersions?: OuiRunbookVersionRecord[];
  activeRunbookVersion?: OuiRunbookVersionRecord | null;
  workNodes?: OuiWorkNodeRecord[];
  inboxItems?: OuiInboxItemRecord[];
  controlRoom?: OuiControlRoomReadModel | null;
};

type CompanyListBody = {
  companies?: OuiCompanyRecord[];
  summaries?: OuiCompanySummary[];
};

type AdapterPreviewBody = {
  adapters?: OuiEmployeeAdapterPreview[];
};

type TaskBody = {
  task?: OuiTaskRecord;
};

type CreateCompanyBody = {
  company?: OuiCompanyRecord;
  ceo?: OuiAgentRecord;
};

type CeoMessageBody = {
  conversation?: OuiConversationRecord | null;
  messages?: OuiMessageRecord[];
  detail?: CompanyBody;
};

type CeoRunbookDraftBody = {
  runbookDraft?: {
    runbook?: OuiRunbookRecord;
    version?: OuiRunbookVersionRecord;
  };
  detail?: CompanyBody;
};

type StartRunbookBody = {
  version?: OuiRunbookVersionRecord;
  detail?: CompanyBody;
};

const OUI_API_BASE = "/api/oui";
const COMPANY_MODES = new Set<OuiCompanyMode>(["project", "routine"]);
const COMPANY_STATUSES = new Set<OuiCompanyStatus>([
  "idle",
  "running",
  "waiting_user",
  "blocked",
  "paused",
]);

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

function optionalJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatError(error: unknown): string {
  return formatOuiCompanyError(error);
}

function normalizeCompanyRecord(
  value: OuiCompanyRecord | undefined | null,
): OuiCompanyRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = asRecord(value);
  const now = new Date().toISOString();
  const id = optionalString(record.id);
  if (!id) {
    return null;
  }
  const name = optionalString(record.name) ?? "Company";
  const mode = COMPANY_MODES.has(record.mode as OuiCompanyMode)
    ? (record.mode as OuiCompanyMode)
    : "project";
  const status = COMPANY_STATUSES.has(record.status as OuiCompanyStatus)
    ? (record.status as OuiCompanyStatus)
    : "idle";
  const defaultLeaderAgentId =
    optionalString(record.defaultLeaderAgentId) ?? optionalString(record.ceoAgentId);
  const createdAt = optionalString(record.createdAt) ?? now;
  return {
    ...value,
    id,
    name,
    description: optionalString(record.description),
    mode,
    status,
    ceoAgentId: optionalString(record.ceoAgentId) ?? defaultLeaderAgentId,
    defaultLeaderAgentId,
    currentRunbookVersionId: optionalString(record.currentRunbookVersionId),
    currentObjective: optionalString(record.currentObjective),
    currentStage: optionalString(record.currentStage),
    autonomyPolicy: optionalJsonObject(record.autonomyPolicy),
    reportingPreference: optionalJsonObject(record.reportingPreference),
    createdAt,
    updatedAt: optionalString(record.updatedAt) ?? createdAt,
  };
}

function normalizeCompanySummary(value: OuiCompanySummary): OuiCompanySummary | null {
  const record = asRecord(value);
  const company = normalizeCompanyRecord(value.company);
  if (!company) {
    return null;
  }
  return {
    company,
    ceo: value.ceo ?? null,
    taskCount: typeof record.taskCount === "number" ? record.taskCount : 0,
    openInboxCount: typeof record.openInboxCount === "number" ? record.openInboxCount : 0,
    activeRunbook: value.activeRunbook ?? null,
    latestActivityAt: optionalString(record.latestActivityAt) ?? company.updatedAt,
  };
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

export function resolveOuiCompanyCeoCandidates(
  agentsList: AgentsListResult | null,
): OuiCompanyCeoCandidate[] {
  return resolveOpenClawAgentRows(agentsList).map((row) => {
    const id = normalizeAgentId(row.id);
    return {
      id,
      label: agentRowLabel(row, id),
      modelRef: agentRowModelRef(row),
    };
  });
}

function clearSelectedCompany(state: OuiCompanyUiState) {
  state.ouiCompanyRecord = null;
  state.ouiCompanyCeoConversations = [];
  state.ouiCompanyCeoMessages = [];
  state.ouiCompanyCeoConversationId = null;
  state.ouiCompanyTasks = [];
  state.ouiCompanyRunbooks = [];
  state.ouiCompanyRunbookVersions = [];
  state.ouiCompanyActiveRunbookVersion = null;
  state.ouiCompanyWorkNodes = [];
  state.ouiCompanyInboxItems = [];
  state.ouiCompanyControlRoom = null;
  state.ouiCompanyAdapters = [];
  state.ouiCompanyAgents = [];
  state.ouiCompanyTimeline = null;
  state.ouiCompanySelectedTaskId = null;
}

function applyCompanyBody(state: OuiCompanyUiState, body: CompanyBody) {
  state.ouiCompanyRecord = normalizeCompanyRecord(body.company);
  state.ouiCompanyAgents = Array.isArray(body.agents) ? body.agents : [];
  state.ouiCompanyCeoConversations = Array.isArray(body.ceoConversations)
    ? body.ceoConversations
    : [];
  state.ouiCompanyCeoMessages = Array.isArray(body.ceoMessages) ? body.ceoMessages : [];
  state.ouiCompanyCeoConversationId =
    state.ouiCompanyCeoConversationId &&
    state.ouiCompanyCeoConversations.some(
      (conversation) => conversation.id === state.ouiCompanyCeoConversationId,
    )
      ? state.ouiCompanyCeoConversationId
      : (state.ouiCompanyCeoConversations[0]?.id ?? null);
  state.ouiCompanyTasks = Array.isArray(body.tasks) ? body.tasks : [];
  state.ouiCompanyRunbooks = Array.isArray(body.runbooks) ? body.runbooks : [];
  state.ouiCompanyRunbookVersions = Array.isArray(body.runbookVersions) ? body.runbookVersions : [];
  state.ouiCompanyActiveRunbookVersion = body.activeRunbookVersion ?? null;
  state.ouiCompanyWorkNodes = Array.isArray(body.workNodes) ? body.workNodes : [];
  state.ouiCompanyInboxItems = Array.isArray(body.inboxItems) ? body.inboxItems : [];
  state.ouiCompanyControlRoom = body.controlRoom ?? null;
  if (
    state.ouiCompanySelectedTaskId &&
    !state.ouiCompanyTasks.some((task) => task.id === state.ouiCompanySelectedTaskId)
  ) {
    state.ouiCompanySelectedTaskId = null;
  }
  state.ouiCompanySelectedTaskId =
    state.ouiCompanySelectedTaskId ?? state.ouiCompanyTasks[0]?.id ?? null;
  upsertSelectedCompanySummary(state);
}

function applyCompanyListBody(state: OuiCompanyUiState, body: CompanyListBody) {
  if (Array.isArray(body.summaries)) {
    state.ouiCompanySummaries = body.summaries
      .map((summary) => normalizeCompanySummary(summary))
      .filter((summary): summary is OuiCompanySummary => Boolean(summary));
    return;
  }
  state.ouiCompanySummaries = Array.isArray(body.companies)
    ? body.companies
        .map((company) => normalizeCompanyRecord(company))
        .filter((company): company is OuiCompanyRecord => Boolean(company))
        .map((company) => ({
          company,
          ceo: null,
          taskCount: 0,
          openInboxCount: 0,
          activeRunbook: null,
          latestActivityAt: company.updatedAt,
        }))
    : [];
}

async function reloadCompanies(state: OuiCompanyUiState) {
  const body = await fetchJson<CompanyListBody>("/companies");
  applyCompanyListBody(state, body);
}

async function reloadCompany(state: OuiCompanyUiState, companyId: string) {
  const body = await fetchJson<CompanyBody>(`/companies/${encodeURIComponent(companyId)}`);
  applyCompanyBody(state, body);
}

function selectedCompanySummary(state: OuiCompanyUiState): OuiCompanySummary | null {
  const company = state.ouiCompanyRecord;
  if (!company) {
    return null;
  }
  const ceo =
    state.ouiCompanyAgents.find((agent) => agent.id === company.ceoAgentId) ??
    state.ouiCompanyAgents.find((agent) => agent.id === company.defaultLeaderAgentId) ??
    state.ouiCompanyAgents.find((agent) => agent.isLeader) ??
    null;
  return {
    company,
    ceo,
    taskCount: state.ouiCompanyTasks.length,
    openInboxCount: state.ouiCompanyInboxItems.filter((item) => item.status === "open").length,
    activeRunbook:
      state.ouiCompanyRunbooks.find(
        (runbook) => runbook.activeVersionId === state.ouiCompanyActiveRunbookVersion?.id,
      ) ?? null,
    latestActivityAt: company.updatedAt,
  };
}

function upsertSelectedCompanySummary(state: OuiCompanyUiState) {
  const summary = selectedCompanySummary(state);
  if (!summary) {
    return;
  }
  const index = state.ouiCompanySummaries.findIndex(
    (entry) => entry.company.id === summary.company.id,
  );
  if (index >= 0) {
    state.ouiCompanySummaries = [
      ...state.ouiCompanySummaries.slice(0, index),
      summary,
      ...state.ouiCompanySummaries.slice(index + 1),
    ];
    return;
  }
  state.ouiCompanySummaries = [summary, ...state.ouiCompanySummaries];
}

function requireSelectedCompanyId(state: OuiCompanyUiState): string {
  const companyId = state.ouiCompanyRecord?.id;
  if (!companyId) {
    throw new Error(ouiCompanyCopy("Select a company first."));
  }
  return companyId;
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
    await reloadCompanies(state);
    const selectedCompanyId =
      state.ouiCompanyRecord?.id &&
      state.ouiCompanySummaries.some((summary) => summary.company.id === state.ouiCompanyRecord?.id)
        ? state.ouiCompanyRecord.id
        : state.ouiCompanySummaries[0]?.company.id;
    if (selectedCompanyId) {
      await reloadCompany(state, selectedCompanyId);
    } else {
      clearSelectedCompany(state);
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
    state.ouiCompanyApiAvailable = false;
    state.ouiCompanyError = formatError(error);
    state.ouiCompanySummaries = [];
    clearSelectedCompany(state);
  } finally {
    state.ouiCompanyLoading = false;
    markChanged(state);
  }
}

export async function selectOuiCompany(state: OuiCompanyUiState, companyId: string) {
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    await reloadCompany(state, companyId);
    await reloadCompanies(state);
    if (state.ouiCompanySelectedTaskId) {
      await loadOuiTaskTimeline(state, state.ouiCompanySelectedTaskId, { silent: true });
    } else {
      state.ouiCompanyTimeline = null;
    }
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}

export async function createOuiCompany(state: OuiCompanyUiState) {
  const name = state.ouiCreateCompanyName.trim();
  if (!name) {
    state.ouiCompanyMessage = {
      kind: "error",
      text: ouiCompanyCopy("Company name is required."),
    };
    markChanged(state);
    return;
  }
  const candidates = resolveOuiCompanyCeoCandidates(state.agentsList);
  const selectedCeoId = state.ouiCreateCompanyCeoId || candidates[0]?.id || "";
  const candidate = candidates.find(
    (entry) => normalizeAgentId(entry.id) === normalizeAgentId(selectedCeoId),
  );
  if (!candidate) {
    state.ouiCompanyMessage = {
      kind: "error",
      text: ouiCompanyCopy("Select an OpenClaw CEO first."),
    };
    markChanged(state);
    return;
  }

  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<CreateCompanyBody>("/companies", {
      method: "POST",
      body: JSON.stringify({
        name,
        openclawLeader: {
          label: candidate.label,
          openclawAgentId: candidate.id,
          adapterId: "openclaw-local",
          modelRef: candidate.modelRef,
        },
      }),
    });
    const companyId = body.company?.id;
    if (!companyId) {
      throw new Error(ouiCompanyCopy("Company was not created."));
    }
    await reloadCompanies(state);
    await reloadCompany(state, companyId);
    await reloadCompanies(state);
    state.ouiCreateCompanyName = "";
    state.ouiCreateCompanyCeoId = "";
    state.ouiCompanyCeoDraft = "";
    state.ouiCompanyMessage = {
      kind: "success",
      text: ouiCompanyCopy("Company created: {name}", {
        name: body.company?.name ?? name,
      }),
    };
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}

export async function sendOuiCeoMessage(state: OuiCompanyUiState) {
  const text = state.ouiCompanyCeoDraft.trim();
  if (!text) {
    state.ouiCompanyMessage = { kind: "error", text: ouiCompanyCopy("Message is required.") };
    markChanged(state);
    return;
  }
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    const companyId = requireSelectedCompanyId(state);
    const body = await fetchJson<CeoMessageBody>(
      `/companies/${encodeURIComponent(companyId)}/ceo/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          conversationId: state.ouiCompanyCeoConversationId,
          text,
        }),
      },
    );
    if (body.detail) {
      applyCompanyBody(state, body.detail);
    } else {
      state.ouiCompanyCeoMessages = Array.isArray(body.messages) ? body.messages : [];
      state.ouiCompanyCeoConversationId = body.conversation?.id ?? null;
    }
    state.ouiCompanyCeoDraft = "";
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}

export async function generateOuiCeoRunbookDraft(state: OuiCompanyUiState) {
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    const companyId = requireSelectedCompanyId(state);
    const body = await fetchJson<CeoRunbookDraftBody>(
      `/companies/${encodeURIComponent(companyId)}/ceo/generate-runbook`,
      {
        method: "POST",
        body: JSON.stringify({
          conversationId: state.ouiCompanyCeoConversationId,
        }),
      },
    );
    if (body.detail) {
      applyCompanyBody(state, body.detail);
    } else {
      await reloadCompany(state, companyId);
    }
    state.ouiCompanyMessage = {
      kind: "success",
      text: ouiCompanyCopy("Runbook draft created: {title}", {
        title: body.runbookDraft?.runbook?.title ?? ouiCompanyCopy("Runbook"),
      }),
    };
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}

export async function startOuiRunbookVersion(state: OuiCompanyUiState, versionId: string) {
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<StartRunbookBody>(
      `/runbook-versions/${encodeURIComponent(versionId)}/start`,
      {
        method: "POST",
        body: JSON.stringify({ startedBy: "user" }),
      },
    );
    if (body.detail) {
      applyCompanyBody(state, body.detail);
    } else if (state.ouiCompanyRecord?.id) {
      await reloadCompany(state, state.ouiCompanyRecord.id);
    }
    state.ouiCompanyMessage = {
      kind: "success",
      text: ouiCompanyCopy("Runbook started: {title}", {
        title:
          state.ouiCompanyRunbooks.find((runbook) => runbook.activeVersionId === versionId)
            ?.title ?? ouiCompanyCopy("Runbook"),
      }),
    };
  } catch (error) {
    state.ouiCompanyMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiCompanyBusy = false;
    markChanged(state);
  }
}

export async function createOuiTask(state: OuiCompanyUiState) {
  const title = state.ouiTaskDraftTitle.trim();
  if (!title) {
    state.ouiCompanyMessage = { kind: "error", text: ouiCompanyCopy("Task title is required.") };
    markChanged(state);
    return;
  }
  state.ouiCompanyBusy = true;
  state.ouiCompanyMessage = null;
  markChanged(state);
  try {
    const companyId = requireSelectedCompanyId(state);
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
      state.ouiCompanyMessage = {
        kind: "success",
        text: ouiCompanyCopy("Task created: {title}", { title: task.title }),
      };
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
    const companyId = requireSelectedCompanyId(state);
    await fetchJson(`/tasks/${encodeURIComponent(taskId)}/assign`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    });
    await reloadCompany(state, companyId);
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
    const companyId = requireSelectedCompanyId(state);
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
          ? ouiCompanyCopy("Run queued: {runId}", { runId: result.run?.id ?? "pending" })
          : ouiCompanyCopy("Task is blocked."),
    };
    await reloadCompany(state, companyId);
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
    const companyId = requireSelectedCompanyId(state);
    await fetchJson(`/tasks/${encodeURIComponent(taskId)}/review`, {
      method: "POST",
      body: JSON.stringify({ reviewState }),
    });
    await reloadCompany(state, companyId);
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
    const company = state.ouiCompanyRecord;
    if (!company) {
      throw new Error(ouiCompanyCopy("Select a company first."));
    }
    const row =
      state.agentsList?.agents.find(
        (entry) => normalizeAgentId(entry.id) === normalizeAgentId(pane.agentId),
      ) ?? ({ id: pane.agentId, name: pane.agentId } as GatewayAgentRow);
    const assignedAgentId =
      state.ouiCompanyAgents.find(
        (agent) =>
          agent.adapterKind === "openclaw" &&
          normalizeAgentId(agent.openclawAgentId) === normalizeAgentId(pane.agentId),
      )?.id ?? null;
    const title =
      pane.chatMessage.trim() ||
      ouiCompanyCopy("Follow up with {agent}", { agent: agentRowLabel(row, pane.agentId) });
    const body = await fetchJson<TaskBody>(`/companies/${encodeURIComponent(company.id)}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title,
        description: ouiCompanyCopy("Created from four-pane {index}: {session}", {
          index: pane.index + 1,
          session: pane.sessionKey,
        }),
        assignedAgentId,
      }),
    });
    if (body.task) {
      state.ouiCompanySelectedTaskId = body.task.id;
      state.ouiCompanyMessage = {
        kind: "success",
        text: ouiCompanyCopy("Task created from pane {index}.", { index: pane.index + 1 }),
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
