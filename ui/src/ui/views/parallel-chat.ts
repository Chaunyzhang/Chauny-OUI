import { html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { isZhCnConfigCopy, localizeConfigCopy } from "../../i18n/lib/config-copy.ts";
import { renderOuiChatWindowSelect, renderOuiOmsWindowSelect } from "../app-render.helpers.ts";
import type { AppViewState } from "../app-view-state.ts";
import { resolveChatModelSelectState } from "../chat-model-select-state.ts";
import "../components/oui-select.ts";
import {
  abortParallelChatPaneRun,
  clearParallelChatPaneHistory,
  ensureParallelChatPanes,
  getParallelChatAgentLabel,
  getParallelChatAgentOptions,
  refreshParallelChatPane,
  sendParallelChatPaneMessage,
  setParallelChatPaneAgent,
  setParallelChatPaneModel,
  setParallelChatPaneSession,
  setParallelChatPaneThinkingLevel,
  updateParallelPaneAttachments,
  updateParallelPaneDraft,
  type ParallelChatHost,
  type ParallelChatPane,
} from "../chat/parallel-chat.ts";
import { resolveSessionOptionGroups } from "../chat/session-controls.ts";
import { icons } from "../icons.ts";
import { normalizeAgentId } from "../session-key.ts";
import { normalizeOptionalString } from "../string-coerce.ts";
import { formatThinkingOverrideLabel } from "../thinking-labels.ts";
import { renderOuiChat } from "./oui-chat.ts";

const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high"];

function host(state: AppViewState): ParallelChatHost {
  return state as unknown as ParallelChatHost;
}

function resolvePaneAvatar(state: AppViewState, pane: ParallelChatPane): string | null {
  const agentId = normalizeAgentId(pane.agentId);
  const row = state.agentsList?.agents.find((agent) => normalizeAgentId(agent.id) === agentId);
  return normalizeOptionalString(row?.identity?.avatarUrl) ?? state.assistantAvatar ?? null;
}

function paneCopy(en: string, zh: string) {
  return isZhCnConfigCopy() ? zh : en;
}

function renderPaneAvatar(avatarUrl: string | null, label: string) {
  const fallback = label.trim().slice(0, 1).toUpperCase() || "A";
  return html`
    <span class="oui-chat-window-header__avatar" aria-hidden="true">
      ${avatarUrl
        ? html`<img src=${avatarUrl} alt="" />`
        : html`<span class="oui-chat-window-header__avatar-text">${fallback}</span>`}
    </span>
  `;
}

function renderPaneAgentSettingsSelect(state: AppViewState, pane: ParallelChatPane) {
  const options = getParallelChatAgentOptions(state);
  const selectedLabel = options.find((option) => option.id === pane.agentId)?.label ?? pane.agentId;
  const busy = pane.chatSending || Boolean(pane.chatRunId) || pane.chatStream !== null;
  return html`
    <label class="oui-chat-control oui-chat-control--agent">
      <span class="oui-chat-control__meta">
        <span class="oui-chat-control__title">Agent</span>
        <span class="oui-chat-control__detail">${paneCopy("Assistant", "助手身份")}</span>
      </span>
      ${renderOuiChatWindowSelect({
        className: "oui-chat-window-select--agent",
        ariaLabel: "Agent",
        value: pane.agentId,
        options: options.map((option) => ({ value: option.id, label: option.label })),
        disabled: !state.connected || busy,
        dataset: "agent",
        titleValue: selectedLabel,
        onChange: (next) => void setParallelChatPaneAgent(host(state), pane.id, next),
      })}
    </label>
  `;
}

function renderPaneSessionSettingsSelect(state: AppViewState, pane: ParallelChatPane) {
  const sessionGroups = resolveSessionOptionGroups(state, pane.sessionKey, state.sessionsResult);
  const sessionOptions = sessionGroups.flatMap((group) =>
    group.options.map((entry) => ({ value: entry.key, label: entry.label })),
  );
  const selectedSessionLabel =
    sessionGroups.flatMap((group) => group.options).find((entry) => entry.key === pane.sessionKey)
      ?.label ?? pane.sessionKey;
  const busy = pane.chatSending || Boolean(pane.chatRunId) || pane.chatStream !== null;
  return html`
    <label class="oui-chat-control oui-chat-control--session">
      <span class="oui-chat-control__meta">
        <span class="oui-chat-control__title">Session</span>
        <span class="oui-chat-control__detail">${paneCopy("Context", "当前话题")}</span>
      </span>
      ${renderOuiChatWindowSelect({
        className: "oui-chat-window-select--session",
        ariaLabel: "Session",
        value: pane.sessionKey,
        options:
          sessionOptions.length > 0
            ? sessionOptions
            : [{ value: pane.sessionKey, label: pane.sessionKey }],
        disabled: !state.connected || busy || sessionOptions.length === 0,
        dataset: "session",
        titleValue: selectedSessionLabel,
        onChange: (next) => void setParallelChatPaneSession(host(state), pane.id, next),
      })}
    </label>
  `;
}

function renderPaneModelSettingsSelect(state: AppViewState, pane: ParallelChatPane) {
  const modelState = resolveChatModelSelectState({
    sessionKey: pane.sessionKey,
    chatModelOverrides: state.chatModelOverrides,
    chatModelCatalog: state.chatModelCatalog,
    sessionsResult: state.sessionsResult,
  });
  const modelOptions = [
    { value: "", label: modelState.defaultLabel },
    ...modelState.options.map((entry) => ({ value: entry.value, label: entry.label })),
  ];
  const busy =
    pane.chatLoading || pane.chatSending || Boolean(pane.chatRunId) || pane.chatStream !== null;
  return html`
    <label class="oui-chat-control oui-chat-control--model">
      <span class="oui-chat-control__meta">
        <span class="oui-chat-control__title">Model</span>
        <span class="oui-chat-control__detail">${paneCopy("Answer engine", "回答引擎")}</span>
      </span>
      ${renderOuiChatWindowSelect({
        className: "oui-chat-window-select--model",
        ariaLabel: "Model",
        value: modelState.currentOverride,
        options: modelOptions,
        disabled:
          !state.connected ||
          busy ||
          (state.chatModelsLoading && modelState.options.length === 0) ||
          !state.client,
        dataset: "model",
        titleValue:
          modelOptions.find((entry) => entry.value === modelState.currentOverride)?.label ??
          modelState.currentOverride,
        onChange: (next) => void setParallelChatPaneModel(host(state), pane.id, next),
      })}
    </label>
  `;
}

function renderPaneOmsSettingsSelect(state: AppViewState) {
  return html`
    <label class="oui-chat-control oui-chat-control--oms">
      <span class="oui-chat-control__meta">
        <span class="oui-chat-control__title">OMS</span>
        <span class="oui-chat-control__detail">${paneCopy("Memory search", "记忆检索")}</span>
      </span>
      ${renderOuiOmsWindowSelect(state)}
    </label>
  `;
}

function renderPaneThinkingSelect(state: AppViewState, pane: ParallelChatPane) {
  const current = pane.chatThinkingLevel ?? "";
  const options = THINKING_OPTIONS.includes(current)
    ? THINKING_OPTIONS
    : [...THINKING_OPTIONS, current].filter(Boolean);
  const selectOptions = [
    { value: "", label: localizeConfigCopy("Default") },
    ...options.map((option) => ({ value: option, label: formatThinkingOverrideLabel(option) })),
  ];
  const busy = pane.chatSending || Boolean(pane.chatRunId) || pane.chatStream !== null;
  return renderOuiChatWindowSelect({
    className: "oui-chat-window-select--thinking",
    ariaLabel: paneCopy("Thinking strength", "思考强度"),
    value: current,
    options: selectOptions,
    disabled: !state.connected || busy,
    dataset: "thinking",
    titleValue: current ? formatThinkingOverrideLabel(current) : localizeConfigCopy("Default"),
    onChange: (next) => void setParallelChatPaneThinkingLevel(host(state), pane.id, next),
  });
}

function renderPaneSettingsToggle(
  label: string,
  active: boolean,
  onClick: () => void,
  disabled = false,
) {
  return html`
    <button
      class="oui-chat-settings__toggle ${active ? "oui-chat-settings__toggle--active" : ""}"
      ?disabled=${disabled}
      @click=${() => {
        if (!disabled) {
          onClick();
        }
      }}
    >
      <span>${label}</span>
      <span class="oui-chat-settings__switch"></span>
    </button>
  `;
}

function renderPaneSettings(state: AppViewState, pane: ParallelChatPane) {
  const label = paneCopy("Pane settings", "格子设置");
  const hideCron = state.sessionsHideCron ?? true;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const showToolCalls = state.onboarding ? true : state.settings.chatShowToolCalls;
  const disableDisplayToggles = state.onboarding;
  return html`
    <details class="oui-chat-settings oui-chat-settings--window">
      <summary
        class="btn btn--sm btn--icon oui-chat-settings__button"
        title=${label}
        aria-label=${label}
      >
        ${icons.settings}
      </summary>
      <div class="oui-chat-settings__popover">
        <div class="oui-chat-settings__grid">
          ${renderPaneAgentSettingsSelect(state, pane)}
          ${renderPaneSessionSettingsSelect(state, pane)}
          ${renderPaneModelSettingsSelect(state, pane)} ${renderPaneOmsSettingsSelect(state)}
        </div>
        <div class="oui-chat-settings__toggles">
          ${renderPaneSettingsToggle(
            paneCopy("Show thinking", "显示推理"),
            showThinking,
            () =>
              state.applySettings({
                ...state.settings,
                chatShowThinking: !state.settings.chatShowThinking,
              }),
            disableDisplayToggles,
          )}
          ${renderPaneSettingsToggle(
            paneCopy("Show tools", "显示工具"),
            showToolCalls,
            () =>
              state.applySettings({
                ...state.settings,
                chatShowToolCalls: !state.settings.chatShowToolCalls,
              }),
            disableDisplayToggles,
          )}
          ${renderPaneSettingsToggle(
            paneCopy("Hide cron sessions", "隐藏定时任务"),
            hideCron,
            () => {
              state.sessionsHideCron = !hideCron;
              state.requestUpdate?.();
            },
          )}
          <button
            type="button"
            class="oui-chat-settings__toggle"
            @click=${() => void refreshParallelChatPane(host(state), pane.id)}
          >
            <span>${localizeConfigCopy("Refresh")}</span>
            <span class="oui-chat-settings__action-icon">${icons.refresh}</span>
          </button>
          <button
            type="button"
            class="oui-chat-settings__toggle oui-chat-settings__toggle--danger"
            @click=${() => void clearParallelChatPaneHistory(host(state), pane.id)}
          >
            <span>${localizeConfigCopy("Clear history")}</span>
            <span class="oui-chat-settings__action-icon">${icons.trash}</span>
          </button>
        </div>
      </div>
    </details>
  `;
}

function renderPaneWindowHeader(state: AppViewState, pane: ParallelChatPane) {
  const label = getParallelChatAgentLabel(state, pane.agentId);
  const avatar = resolvePaneAvatar(state, pane);
  return html`
    <div class="oui-chat-window-header">
      <div class="oui-chat-window-header__identity">
        ${renderPaneAvatar(avatar, label)}
        <span class="oui-chat-window-header__name" title=${label}>${label}</span>
      </div>
      <div class="oui-chat-window-header__controls">
        ${renderPaneThinkingSelect(state, pane)} ${renderOuiOmsWindowSelect(state)}
      </div>
      <button
        type="button"
        class="btn btn--sm btn--icon oui-chat-window-header__task"
        title=${paneCopy("Create task", "创建任务")}
        aria-label=${paneCopy("Create task", "创建任务")}
        ?disabled=${state.ouiCompanyBusy}
        @click=${() => void state.createOuiTaskFromParallelPane(pane.id)}
      >
        ${icons.fileText}
      </button>
      ${renderPaneSettings(state, pane)}
    </div>
  `;
}

function renderPane(state: AppViewState, pane: ParallelChatPane) {
  const label = getParallelChatAgentLabel(state, pane.agentId);
  const avatar = resolvePaneAvatar(state, pane);
  const disabledReason = state.connected ? null : "Disconnected";
  return html`
    <section class="parallel-chat__pane" aria-label=${`Pane ${pane.index + 1}`}>
      <div class="parallel-chat__pane-body">
        ${renderOuiChat({
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
            state.setTab("agentManager" as import("../navigation.ts").Tab);
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
          topChrome: renderPaneWindowHeader(state, pane),
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
