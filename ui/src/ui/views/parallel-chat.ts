import { html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { AppViewState } from "../app-view-state.ts";
import {
  abortParallelChatPaneRun,
  clearParallelChatPaneHistory,
  ensureParallelChatPanes,
  getParallelChatAgentLabel,
  getParallelChatAgentOptions,
  refreshParallelChatPane,
  sendParallelChatPaneMessage,
  setParallelChatPaneAgent,
  setParallelChatPaneThinkingLevel,
  updateParallelPaneAttachments,
  updateParallelPaneDraft,
  type ParallelChatHost,
  type ParallelChatPane,
} from "../chat/parallel-chat.ts";
import { normalizeAgentId } from "../session-key.ts";
import { normalizeOptionalString } from "../string-coerce.ts";
import { formatThinkingOverrideLabel } from "../thinking-labels.ts";
import { renderChat } from "./chat.ts";

const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high"];

function host(state: AppViewState): ParallelChatHost {
  return state as unknown as ParallelChatHost;
}

function resolvePaneAvatar(state: AppViewState, pane: ParallelChatPane): string | null {
  const agentId = normalizeAgentId(pane.agentId);
  const row = state.agentsList?.agents.find((agent) => normalizeAgentId(agent.id) === agentId);
  return normalizeOptionalString(row?.identity?.avatarUrl) ?? state.assistantAvatar ?? null;
}

function renderPaneAgentSelect(state: AppViewState, pane: ParallelChatPane) {
  const options = getParallelChatAgentOptions(state);
  const selectedLabel = options.find((option) => option.id === pane.agentId)?.label ?? pane.agentId;
  const busy = pane.chatSending || Boolean(pane.chatRunId) || pane.chatStream !== null;
  return html`
    <label class="parallel-chat__control field">
      <select
        aria-label="Agent"
        title=${selectedLabel}
        .value=${pane.agentId}
        ?disabled=${!state.connected || busy}
        @change=${(event: Event) => {
          void setParallelChatPaneAgent(
            host(state),
            pane.id,
            (event.target as HTMLSelectElement).value,
          );
        }}
      >
        ${repeat(
          options,
          (option) => option.id,
          (option) =>
            html`<option value=${option.id} ?selected=${option.id === pane.agentId}>
              ${option.label}
            </option>`,
        )}
      </select>
    </label>
  `;
}

function renderPaneThinkingSelect(state: AppViewState, pane: ParallelChatPane) {
  const current = pane.chatThinkingLevel ?? "";
  const options = THINKING_OPTIONS.includes(current)
    ? THINKING_OPTIONS
    : [...THINKING_OPTIONS, current].filter(Boolean);
  const busy = pane.chatSending || Boolean(pane.chatRunId) || pane.chatStream !== null;
  return html`
    <label class="parallel-chat__control field">
      <select
        aria-label="Thinking"
        title=${current ? formatThinkingOverrideLabel(current) : "Default thinking"}
        .value=${current}
        ?disabled=${!state.connected || busy}
        @change=${(event: Event) => {
          void setParallelChatPaneThinkingLevel(
            host(state),
            pane.id,
            (event.target as HTMLSelectElement).value,
          );
        }}
      >
        <option value="" ?selected=${current === ""}>Default</option>
        ${repeat(
          options,
          (option) => option,
          (option) =>
            html`<option value=${option} ?selected=${option === current}>
              ${formatThinkingOverrideLabel(option)}
            </option>`,
        )}
      </select>
    </label>
  `;
}

function renderPaneHeader(state: AppViewState, pane: ParallelChatPane) {
  const label = getParallelChatAgentLabel(state, pane.agentId);
  return html`
    <div class="parallel-chat__pane-header">
      <div class="parallel-chat__pane-title">
        <span class="parallel-chat__pane-index">${pane.index + 1}</span>
        <span class="parallel-chat__pane-agent" title=${label}>${label}</span>
      </div>
      <div class="parallel-chat__pane-controls">
        ${renderPaneAgentSelect(state, pane)} ${renderPaneThinkingSelect(state, pane)}
      </div>
    </div>
  `;
}

function renderPane(state: AppViewState, pane: ParallelChatPane) {
  const label = getParallelChatAgentLabel(state, pane.agentId);
  const avatar = resolvePaneAvatar(state, pane);
  const disabledReason = state.connected ? null : "Disconnected";
  return html`
    <section class="parallel-chat__pane" aria-label=${`Pane ${pane.index + 1}`}>
      ${renderPaneHeader(state, pane)}
      <div class="parallel-chat__pane-body">
        ${renderChat({
          sessionKey: pane.sessionKey,
          onSessionKeyChange: () => undefined,
          thinkingLevel: pane.chatThinkingLevel,
          showThinking: state.onboarding ? false : state.settings.chatShowThinking,
          showToolCalls: state.onboarding ? true : state.settings.chatShowToolCalls,
          loading: pane.chatLoading,
          sending: pane.chatSending,
          compactionStatus: null,
          fallbackStatus: null,
          assistantAvatarUrl: avatar,
          messages: pane.chatMessages,
          sideResult: null,
          toolMessages: pane.chatToolMessages,
          streamSegments: pane.chatStreamSegments,
          stream: pane.chatStream,
          streamStartedAt: pane.chatStreamStartedAt,
          draft: pane.chatMessage,
          queue: [],
          connected: state.connected,
          canSend: state.connected,
          disabledReason,
          error: pane.lastError,
          onDismissError: () => {
            pane.lastError = null;
            state.chatParallelPanes = [...state.chatParallelPanes];
          },
          sessions: state.sessionsResult,
          focusMode: false,
          autoExpandToolCalls: false,
          onRefresh: () => void refreshParallelChatPane(host(state), pane.id),
          onToggleFocusMode: () => undefined,
          getDraft: () => pane.chatMessage,
          onDraftChange: (next) => updateParallelPaneDraft(host(state), pane.id, next),
          onRequestUpdate: () => state.requestUpdate?.(),
          attachments: pane.chatAttachments,
          onAttachmentsChange: (next) => updateParallelPaneAttachments(host(state), pane.id, next),
          onSend: () => void sendParallelChatPaneMessage(host(state), pane.id),
          canAbort: Boolean(pane.chatRunId),
          onAbort: () => void abortParallelChatPaneRun(host(state), pane.id),
          onQueueRemove: () => undefined,
          onQueueSteer: () => undefined,
          onDismissSideResult: () => undefined,
          onNewSession: () => void clearParallelChatPaneHistory(host(state), pane.id),
          onClearHistory: () => void clearParallelChatPaneHistory(host(state), pane.id),
          agentsList: state.agentsList,
          currentAgentId: pane.agentId,
          onAgentChange: (agentId: string) =>
            void setParallelChatPaneAgent(host(state), pane.id, agentId),
          onNavigateToAgent: () => {
            state.agentsSelectedId = pane.agentId;
            state.setTab("agents");
          },
          onSessionSelect: () => undefined,
          showNewMessages: false,
          onScrollToBottom: () => undefined,
          sidebarOpen: false,
          sidebarContent: null,
          sidebarError: null,
          splitRatio: state.splitRatio,
          canvasPluginSurfaceUrl: state.hello?.pluginSurfaceUrls?.canvas ?? null,
          onOpenSidebar: () => undefined,
          onCloseSidebar: () => undefined,
          onSplitRatioChange: () => undefined,
          assistantName: label,
          assistantAvatar: avatar,
          userName: state.userName ?? null,
          userAvatar: state.userAvatar ?? null,
          localMediaPreviewRoots: state.localMediaPreviewRoots,
          embedSandboxMode: state.embedSandboxMode,
          allowExternalEmbedUrls: state.allowExternalEmbedUrls,
          assistantAttachmentAuthToken: null,
          basePath: state.basePath ?? "",
        })}
      </div>
    </section>
  `;
}

export function renderParallelChat(state: AppViewState) {
  ensureParallelChatPanes(host(state));
  return html`
    <div class="parallel-chat" aria-label="Parallel chat">
      ${repeat(
        state.chatParallelPanes,
        (pane) => pane.id,
        (pane) => renderPane(state, pane),
      )}
    </div>
  `;
}
