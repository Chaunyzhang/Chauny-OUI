import {
  flushToolStreamSync,
  handleAgentEvent,
  resetToolStream,
  type AgentEventPayload,
  type ToolStreamEntry,
} from "../app-tool-stream.ts";
import { shouldReloadHistoryForFinalEvent } from "../chat-event-reload.ts";
import { createChatModelOverride } from "../chat-model-ref.ts";
import {
  abortChatRun,
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatEventPayload,
  type ChatState,
} from "../controllers/chat.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  buildAgentMainSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../session-key.ts";
import { normalizeOptionalString } from "../string-coerce.ts";
import { normalizeThinkLevel } from "../thinking.ts";
import type { AgentsListResult, ChatModelOverride, SessionsListResult } from "../types.ts";
import type { ChatAttachment } from "../ui-types.ts";

export const PARALLEL_CHAT_PANE_COUNT = 4;

export type ParallelChatPane = ChatState & {
  id: string;
  index: number;
  agentId: string;
  chatToolMessages: Record<string, unknown>[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  toolStreamSyncTimer: number | null;
  chatModelOverrides?: Record<string, ChatModelOverride | null>;
  chatSideResult: null;
};

export type ParallelChatHost = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsList: AgentsListResult | null;
  sessionsResult: SessionsListResult | null;
  chatModelOverrides: Record<string, ChatModelOverride | null>;
  chatParallelPanes: ParallelChatPane[];
  requestUpdate?: () => void;
};

function markChanged(host: ParallelChatHost) {
  host.chatParallelPanes = [...host.chatParallelPanes];
  host.requestUpdate?.();
}

function syncPaneRuntime(host: ParallelChatHost, pane: ParallelChatPane) {
  pane.client = host.client;
  pane.connected = host.connected;
  pane.chatModelOverrides = host.chatModelOverrides;
  ensurePaneToolStream(pane);
}

function ensurePaneToolStream(pane: ParallelChatPane) {
  if (!(pane.toolStreamById instanceof Map)) {
    pane.toolStreamById = new Map<string, ToolStreamEntry>();
  }
  if (!Array.isArray(pane.toolStreamOrder)) {
    pane.toolStreamOrder = [];
  }
  if (!Array.isArray(pane.chatToolMessages)) {
    pane.chatToolMessages = [];
  }
  if (!Array.isArray(pane.chatStreamSegments)) {
    pane.chatStreamSegments = [];
  }
  if (typeof pane.toolStreamSyncTimer !== "number" && pane.toolStreamSyncTimer !== null) {
    pane.toolStreamSyncTimer = null;
  }
}

function resetPaneToolStream(pane: ParallelChatPane) {
  ensurePaneToolStream(pane);
  resetToolStream(pane as Parameters<typeof resetToolStream>[0]);
}

function resetPane(pane: ParallelChatPane, agentId: string) {
  pane.agentId = normalizeAgentId(agentId);
  pane.sessionKey = resolveParallelPaneSessionKey(pane.agentId, pane.index);
  resetPaneTranscript(pane);
}

function resetPaneTranscript(pane: ParallelChatPane) {
  pane.currentSessionId = null;
  pane.chatLoading = false;
  pane.chatMessages = [];
  resetPaneToolStream(pane);
  pane.chatThinkingLevel = null;
  pane.chatSending = false;
  pane.chatMessage = "";
  pane.chatAttachments = [];
  pane.chatRunId = null;
  pane.chatStream = null;
  pane.chatStreamStartedAt = null;
  pane.lastError = null;
}

function resetPaneForSession(pane: ParallelChatPane, sessionKey: string) {
  const parsed = parseAgentSessionKey(sessionKey);
  pane.agentId = normalizeAgentId(parsed?.agentId ?? pane.agentId);
  pane.sessionKey = sessionKey;
  resetPaneTranscript(pane);
}

function resolveAgentIds(host: ParallelChatHost): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const add = (agentId: string | undefined | null) => {
    const normalized = normalizeAgentId(agentId);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    ids.push(normalized);
  };

  add(host.agentsList?.defaultId ?? "main");
  for (const agent of host.agentsList?.agents ?? []) {
    add(agent.id);
  }
  return ids.length > 0 ? ids : ["main"];
}

export function resolveParallelPaneSessionKey(agentId: string, index: number): string {
  return buildAgentMainSessionKey({
    agentId,
    mainKey: `parallel-${Math.max(1, index + 1)}`,
  });
}

function createPane(
  host: ParallelChatHost,
  params: { id: string; index: number; agentId: string },
): ParallelChatPane {
  const agentId = normalizeAgentId(params.agentId);
  return {
    id: params.id,
    index: params.index,
    agentId,
    client: host.client,
    connected: host.connected,
    sessionKey: resolveParallelPaneSessionKey(agentId, params.index),
    currentSessionId: null,
    chatLoading: false,
    chatMessages: [],
    chatThinkingLevel: null,
    chatSending: false,
    chatMessage: "",
    chatAttachments: [],
    chatRunId: null,
    chatStream: null,
    chatStreamStartedAt: null,
    lastError: null,
    chatToolMessages: [],
    chatStreamSegments: [],
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [],
    toolStreamSyncTimer: null,
    chatModelOverrides: host.chatModelOverrides,
    chatSideResult: null,
  };
}

export function ensureParallelChatPanes(host: ParallelChatHost) {
  if (host.chatParallelPanes.length === PARALLEL_CHAT_PANE_COUNT) {
    for (const pane of host.chatParallelPanes) {
      syncPaneRuntime(host, pane);
    }
    return;
  }

  const existing = new Map(host.chatParallelPanes.map((pane) => [pane.id, pane]));
  const agentIds = resolveAgentIds(host);
  const panes: ParallelChatPane[] = [];
  for (let index = 0; index < PARALLEL_CHAT_PANE_COUNT; index++) {
    const id = `parallel-${index + 1}`;
    const pane = existing.get(id);
    if (pane) {
      pane.index = index;
      syncPaneRuntime(host, pane);
      panes.push(pane);
      continue;
    }
    panes.push(createPane(host, { id, index, agentId: agentIds[index] ?? agentIds[0] ?? "main" }));
  }
  host.chatParallelPanes = panes;
}

export function getParallelChatAgentLabel(
  host: Pick<ParallelChatHost, "agentsList">,
  agentId: string,
): string {
  const normalized = normalizeAgentId(agentId);
  const row = host.agentsList?.agents.find((agent) => normalizeAgentId(agent.id) === normalized);
  return (
    normalizeOptionalString(row?.identity?.name) ?? normalizeOptionalString(row?.name) ?? normalized
  );
}

export function getParallelChatAgentOptions(host: Pick<ParallelChatHost, "agentsList">) {
  const seen = new Set<string>();
  const options: Array<{ id: string; label: string }> = [];
  const add = (agentId: string | undefined | null) => {
    const normalized = normalizeAgentId(agentId);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    options.push({ id: normalized, label: getParallelChatAgentLabel(host, normalized) });
  };

  add(host.agentsList?.defaultId ?? "main");
  for (const agent of host.agentsList?.agents ?? []) {
    add(agent.id);
  }
  return options.length ? options : [{ id: "main", label: "main" }];
}

export async function refreshParallelChatPane(host: ParallelChatHost, paneId: string) {
  ensureParallelChatPanes(host);
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane) {
    return;
  }
  syncPaneRuntime(host, pane);
  resetPaneToolStream(pane);
  markChanged(host);
  await loadChatHistory(pane);
  markChanged(host);
}

export async function refreshParallelChatPanes(host: ParallelChatHost) {
  ensureParallelChatPanes(host);
  if (!host.connected || !host.client) {
    return;
  }
  await Promise.all(host.chatParallelPanes.map((pane) => refreshParallelChatPane(host, pane.id)));
}

export function updateParallelPaneDraft(host: ParallelChatHost, paneId: string, nextDraft: string) {
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane) {
    return;
  }
  pane.chatMessage = nextDraft;
  markChanged(host);
}

export function updateParallelPaneAttachments(
  host: ParallelChatHost,
  paneId: string,
  attachments: ChatAttachment[],
) {
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane) {
    return;
  }
  pane.chatAttachments = attachments;
  markChanged(host);
}

export async function sendParallelChatPaneMessage(host: ParallelChatHost, paneId: string) {
  ensureParallelChatPanes(host);
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane) {
    return;
  }
  syncPaneRuntime(host, pane);
  const draft = pane.chatMessage;
  const attachments = pane.chatAttachments;
  const hasPayload = draft.trim() || attachments.length > 0;
  pane.chatMessage = "";
  pane.chatAttachments = [];
  const runId = await sendChatMessage(pane, draft, attachments);
  if (!runId && hasPayload) {
    pane.chatMessage = draft;
    pane.chatAttachments = attachments;
  }
  markChanged(host);
}

export async function abortParallelChatPaneRun(host: ParallelChatHost, paneId: string) {
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane) {
    return;
  }
  syncPaneRuntime(host, pane);
  await abortChatRun(pane);
  markChanged(host);
}

export async function clearParallelChatPaneHistory(host: ParallelChatHost, paneId: string) {
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane || !host.client || !host.connected) {
    return;
  }
  syncPaneRuntime(host, pane);
  try {
    await host.client.request("sessions.reset", { key: pane.sessionKey });
    resetPane(pane, pane.agentId);
    await loadChatHistory(pane);
  } catch (err) {
    pane.lastError = String(err);
  } finally {
    markChanged(host);
  }
}

export async function setParallelChatPaneAgent(
  host: ParallelChatHost,
  paneId: string,
  agentId: string,
) {
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane || pane.chatSending || pane.chatRunId || pane.chatStream !== null) {
    return;
  }
  const normalized = normalizeAgentId(agentId);
  if (pane.agentId === normalized) {
    return;
  }
  resetPane(pane, normalized);
  markChanged(host);
  await refreshParallelChatPane(host, pane.id);
}

export async function setParallelChatPaneSession(
  host: ParallelChatHost,
  paneId: string,
  sessionKey: string,
) {
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  const nextSessionKey = sessionKey.trim();
  if (!pane || !nextSessionKey || pane.chatSending || pane.chatRunId || pane.chatStream !== null) {
    return;
  }
  if (pane.sessionKey === nextSessionKey) {
    return;
  }
  resetPaneForSession(pane, nextSessionKey);
  markChanged(host);
  await refreshParallelChatPane(host, pane.id);
}

export async function setParallelChatPaneModel(
  host: ParallelChatHost,
  paneId: string,
  nextModel: string,
) {
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane || !host.client || !host.connected) {
    return;
  }
  if (pane.chatLoading || pane.chatSending || pane.chatRunId || pane.chatStream !== null) {
    return;
  }
  const targetSessionKey = pane.sessionKey;
  const prevOverride = host.chatModelOverrides[targetSessionKey];
  host.chatModelOverrides = {
    ...host.chatModelOverrides,
    [targetSessionKey]: createChatModelOverride(nextModel),
  };
  pane.lastError = null;
  markChanged(host);
  try {
    await host.client.request("sessions.patch", {
      key: targetSessionKey,
      model: nextModel || null,
    });
  } catch (err) {
    host.chatModelOverrides = {
      ...host.chatModelOverrides,
      [targetSessionKey]: prevOverride,
    };
    pane.lastError = `Failed to set model: ${String(err)}`;
  } finally {
    markChanged(host);
  }
}

export async function setParallelChatPaneThinkingLevel(
  host: ParallelChatHost,
  paneId: string,
  nextThinkingLevel: string,
) {
  const pane = host.chatParallelPanes.find((entry) => entry.id === paneId);
  if (!pane || !host.client || !host.connected) {
    return;
  }
  const previousThinkingLevel = pane.chatThinkingLevel ?? undefined;
  const normalizedNext =
    (normalizeThinkLevel(nextThinkingLevel) ?? nextThinkingLevel.trim()) || undefined;
  if ((previousThinkingLevel ?? "") === (normalizedNext ?? "")) {
    return;
  }
  pane.chatThinkingLevel = normalizedNext ?? null;
  pane.lastError = null;
  markChanged(host);
  try {
    await host.client.request("sessions.patch", {
      key: pane.sessionKey,
      thinkingLevel: normalizedNext ?? null,
    });
  } catch (err) {
    pane.chatThinkingLevel = previousThinkingLevel ?? null;
    pane.lastError = `Failed to set thinking level: ${String(err)}`;
  } finally {
    markChanged(host);
  }
}

export function handleParallelChatEvent(
  host: ParallelChatHost,
  payload: ChatEventPayload | undefined,
) {
  if (!payload || host.chatParallelPanes.length === 0) {
    return;
  }
  let changed = false;
  for (const pane of host.chatParallelPanes) {
    ensurePaneToolStream(pane);
    const activeRunIdBeforeEvent = pane.chatRunId;
    const state = handleChatEvent(pane, payload);
    if (!state) {
      continue;
    }
    changed = true;
    const terminal = state === "final" || state === "aborted" || state === "error";
    const terminalRunMatches =
      typeof payload.runId === "string" &&
      activeRunIdBeforeEvent !== null &&
      payload.runId === activeRunIdBeforeEvent;
    if (!terminal || !terminalRunMatches) {
      continue;
    }
    const hadToolEvents = pane.toolStreamOrder.length > 0;
    const shouldReloadHistory =
      state === "final" && (hadToolEvents || shouldReloadHistoryForFinalEvent(payload));
    if (shouldReloadHistory) {
      const completedRunId = payload.runId ?? null;
      void loadChatHistory(pane).finally(() => {
        if (completedRunId && pane.chatRunId && pane.chatRunId !== completedRunId) {
          return;
        }
        resetPaneToolStream(pane);
        markChanged(host);
      });
      continue;
    }
    resetPaneToolStream(pane);
  }
  if (changed) {
    markChanged(host);
  }
}

export function handleParallelAgentEvent(
  host: ParallelChatHost,
  payload: AgentEventPayload | undefined,
) {
  const sessionKey = payload?.sessionKey?.trim();
  if (!payload || !sessionKey || host.chatParallelPanes.length === 0) {
    return;
  }
  let changed = false;
  for (const pane of host.chatParallelPanes) {
    if (pane.sessionKey !== sessionKey) {
      continue;
    }
    syncPaneRuntime(host, pane);
    handleAgentEvent(pane as Parameters<typeof handleAgentEvent>[0], payload);
    if (payload.stream === "tool") {
      flushToolStreamSync(pane as Parameters<typeof flushToolStreamSync>[0]);
    }
    if (pane.chatModelOverrides && pane.chatModelOverrides !== host.chatModelOverrides) {
      host.chatModelOverrides = pane.chatModelOverrides;
    }
    changed = true;
  }
  if (changed) {
    markChanged(host);
  }
}

export function handleParallelSessionMessageEvent(
  host: ParallelChatHost,
  payload: { sessionKey?: string } | undefined,
) {
  const sessionKey = payload?.sessionKey?.trim();
  if (!sessionKey || host.chatParallelPanes.length === 0) {
    return;
  }
  for (const pane of host.chatParallelPanes) {
    if (pane.sessionKey !== sessionKey || pane.chatRunId) {
      continue;
    }
    void refreshParallelChatPane(host, pane.id);
  }
}
