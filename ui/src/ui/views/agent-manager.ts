import { html, nothing } from "lit";
import { isZhCnConfigCopy, localizeConfigCopy } from "../../i18n/lib/config-copy.ts";
import { buildQualifiedChatModelValue } from "../chat-model-ref.ts";
import "../components/oui-select.ts";
import { icons } from "../icons.ts";
import type {
  AgentIdentityResult,
  AgentsListResult,
  GatewayAgentRow,
  ModelCatalogEntry,
} from "../types.ts";
import { agentLogoUrl, resolveAgentAvatarUrl } from "./agents-utils.ts";

export type AgentManagerProps = {
  basePath?: string | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  identityById: Record<string, AgentIdentityResult>;
  catalog: ModelCatalogEntry[];
  catalogLoading: boolean;
  config: Record<string, unknown> | null;
  configLoading: boolean;
  setupAgentName: string;
  setupAgentWorkspace: string;
  setupAgentModel: string;
  setupAgentEmoji: string;
  setupAgentSaving: boolean;
  setupAgentMessage: { kind: "success" | "error"; text: string } | null;
  onSetupAgentNameChange: (name: string) => void;
  onSetupAgentWorkspaceChange: (workspace: string) => void;
  onSetupAgentModelChange: (model: string) => void;
  onSetupAgentEmojiChange: (emoji: string) => void;
  onSetupAgentApply: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onSetDefaultAgent: (agentId: string) => void | Promise<void>;
  onRemoveAgent: (agentId: string) => void | Promise<void>;
};

const COPY: Record<string, string> = {
  "Agent Manager": "Agent 管理",
  "Agent setup": "Agent 接入",
  "Add agent": "添加 Agent",
  "Configured agents": "已配置 Agent",
  "Agent ID": "Agent ID",
  Workspace: "工作区",
  Model: "模型",
  Emoji: "头像",
  "Use default model": "使用默认模型",
  "Save agent": "保存 Agent",
  Saving: "保存中",
  Refresh: "刷新",
  "Refreshing...": "刷新中...",
  "Current default": "当前默认",
  Default: "默认",
  "Set default": "设为默认",
  "Remove config": "移除",
  "Remove this agent config?": "移除这个 Agent 配置？",
  "No configured agents yet.": "还没有配置 Agent。",
  "Gateway disconnected": "Gateway 未连接",
  "Agent list is loading.": "正在读取 Agent。",
  "Not set": "未设置",
  "main cannot be removed": "main 不能移除",
};

function am(text: string): string {
  if (isZhCnConfigCopy()) {
    return COPY[text] ?? localizeConfigCopy(text);
  }
  return text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeAgentSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "agent"
  );
}

export function suggestAgentWorkspace(name: string): string {
  return `~/.openclaw/workspace-${normalizeAgentSlug(name)}`;
}

function resolveDefaultModel(config: Record<string, unknown> | null): string | null {
  const defaults = asRecord(asRecord(config?.agents)?.defaults);
  const model = defaults?.model;
  if (typeof model === "string") {
    return model.trim() || null;
  }
  const modelRecord = asRecord(model);
  return asString(modelRecord?.primary) ?? asString(modelRecord?.model);
}

function resolveAgentModel(agent: GatewayAgentRow, config: Record<string, unknown> | null): string {
  return agent.model?.primary?.trim() || resolveDefaultModel(config) || "";
}

function getConfigProviders(config: Record<string, unknown> | null): Record<string, unknown> {
  return asRecord(asRecord(config?.models)?.providers) ?? {};
}

function buildModelOptions(
  catalog: ModelCatalogEntry[],
  config: Record<string, unknown> | null,
): Array<{ value: string; label: string }> {
  const options = new Map<string, string>();
  options.set("", am("Use default model"));
  for (const [providerId, rawProvider] of Object.entries(getConfigProviders(config))) {
    const provider = asRecord(rawProvider);
    const models = Array.isArray(provider?.models) ? provider.models : [];
    for (const rawModel of models) {
      const model = asRecord(rawModel);
      const modelId = asString(model?.id);
      if (!modelId) {
        continue;
      }
      const value = buildQualifiedChatModelValue(modelId, providerId);
      if (options.has(value)) {
        continue;
      }
      options.set(value, asString(model?.name) ?? modelLabel(value, catalog, config));
    }
  }
  const defaultModel = resolveDefaultModel(config);
  if (defaultModel && !options.has(defaultModel)) {
    options.set(defaultModel, modelLabel(defaultModel, catalog, config));
  }
  return Array.from(options, ([value, label]) => ({ value, label }));
}

function modelLabel(
  modelRef: string,
  catalog: ModelCatalogEntry[],
  config: Record<string, unknown> | null,
): string {
  if (!modelRef) {
    return resolveDefaultModel(config) ?? am("Not set");
  }
  for (const entry of catalog) {
    const ref = buildQualifiedChatModelValue(entry.id, entry.provider);
    if (ref === modelRef) {
      return entry.name || modelRef;
    }
  }
  return modelRef;
}

function agentDisplayName(agent: GatewayAgentRow, identity?: AgentIdentityResult): string {
  return (
    asString(identity?.name) ?? asString(agent.identity?.name) ?? asString(agent.name) ?? agent.id
  );
}

function renderAgentAvatar(
  props: AgentManagerProps,
  agent: GatewayAgentRow,
  identity?: AgentIdentityResult,
) {
  const avatarUrl = resolveAgentAvatarUrl(agent, identity);
  const emoji = asString(identity?.emoji) ?? asString(agent.identity?.emoji);
  const label = agentDisplayName(agent, identity);
  return html`
    <div class="agent-card__avatar" aria-hidden="true">
      ${avatarUrl
        ? html`<img src=${avatarUrl} alt="" loading="lazy" />`
        : emoji
          ? html`<span>${emoji}</span>`
          : agent.id === "main"
            ? html`<img src=${agentLogoUrl(props.basePath ?? "")} alt="" loading="lazy" />`
            : html`<span>${label.slice(0, 1).toUpperCase()}</span>`}
    </div>
  `;
}

function renderQuickAgentSetup(props: AgentManagerProps) {
  const modelOptions = buildModelOptions(props.catalog, props.config);
  const canSave =
    props.connected &&
    !props.setupAgentSaving &&
    Boolean(props.setupAgentName.trim()) &&
    Boolean(props.setupAgentWorkspace.trim());
  return html`
    <section class="setup-quick agent-setup" aria-label=${am("Agent setup")}>
      <div class="setup-quick__header">
        <div>
          <div class="setup-wizard__eyebrow">OUI</div>
          <h2>${am("Agent setup")}</h2>
        </div>
        <button
          type="button"
          class="btn btn--ghost"
          ?disabled=${props.setupAgentSaving}
          @click=${() => props.onRefresh()}
        >
          ${icons.refresh}${am("Refresh")}
        </button>
      </div>

      <div class="setup-quick__steps agent-setup__steps">
        <label class="setup-field">
          <span>
            <b>1</b>
            ${am("Agent ID")}
          </span>
          <input
            autocomplete="off"
            spellcheck="false"
            placeholder="work"
            .value=${props.setupAgentName}
            ?disabled=${props.setupAgentSaving}
            @input=${(event: InputEvent) => {
              props.onSetupAgentNameChange((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>

        <label class="setup-field">
          <span>
            <b>2</b>
            ${am("Workspace")}
          </span>
          <input
            autocomplete="off"
            spellcheck="false"
            placeholder="~/.openclaw/workspace-work"
            .value=${props.setupAgentWorkspace}
            ?disabled=${props.setupAgentSaving}
            @input=${(event: InputEvent) => {
              props.onSetupAgentWorkspaceChange((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>

        <label class="setup-field">
          <span>
            <b>3</b>
            ${am("Model")}
          </span>
          <oui-select
            .options=${modelOptions}
            .value=${props.setupAgentModel}
            ?disabled=${props.setupAgentSaving || props.catalogLoading}
            aria-label=${am("Model")}
            @change=${(event: Event) => {
              const select = event.currentTarget as HTMLElement & { value: string };
              props.onSetupAgentModelChange(select.value);
            }}
          ></oui-select>
        </label>

        <label class="setup-field agent-setup__emoji">
          <span>
            <b>4</b>
            ${am("Emoji")}
          </span>
          <input
            autocomplete="off"
            spellcheck="false"
            maxlength="8"
            .value=${props.setupAgentEmoji}
            ?disabled=${props.setupAgentSaving}
            @input=${(event: InputEvent) => {
              props.onSetupAgentEmojiChange((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
      </div>

      ${props.setupAgentMessage
        ? html`<div
            class="callout ${props.setupAgentMessage.kind === "success" ? "info" : "danger"}"
          >
            ${props.setupAgentMessage.text}
          </div>`
        : nothing}
      ${!props.connected
        ? html`<div class="callout warn">${am("Gateway disconnected")}</div>`
        : nothing}

      <div class="setup-quick__actions">
        <button
          type="button"
          class="btn primary"
          ?disabled=${!canSave}
          @click=${() => props.onSetupAgentApply()}
        >
          ${icons.check}${props.setupAgentSaving ? am("Saving") : am("Save agent")}
        </button>
      </div>
    </section>
  `;
}

function renderAgentCard(props: AgentManagerProps, agent: GatewayAgentRow) {
  const identity = props.identityById[agent.id];
  const displayName = agentDisplayName(agent, identity);
  const defaultId = props.agentsList?.defaultId ?? "main";
  const isDefault = agent.id === defaultId;
  const modelRef = resolveAgentModel(agent, props.config);
  const canRemove =
    agent.id !== "main" && props.connected && !props.agentsLoading && !props.setupAgentSaving;
  return html`
    <article class="agent-card">
      <div class="agent-card__top">
        ${renderAgentAvatar(props, agent, identity)}
        <div class="agent-card__title">
          <strong>${displayName}</strong>
          <span>${agent.id}</span>
        </div>
        <span class="agent-badge ${isDefault ? "agent-badge--default" : ""}">
          ${isDefault ? am("Current default") : "agent"}
        </span>
      </div>

      <div class="agent-card__facts">
        <div>
          <span>${am("Workspace")}</span>
          <strong>${agent.workspace || am("Not set")}</strong>
        </div>
        <div>
          <span>${am("Model")}</span>
          <strong>${modelLabel(modelRef, props.catalog, props.config)}</strong>
        </div>
      </div>

      <div class="agent-card__actions">
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${isDefault ||
          !props.connected ||
          props.configLoading ||
          props.setupAgentSaving}
          @click=${() => props.onSetDefaultAgent(agent.id)}
        >
          ${am("Set default")}
        </button>
        <button
          type="button"
          class="btn btn--sm btn--danger"
          ?disabled=${!canRemove}
          title=${agent.id === "main" ? am("main cannot be removed") : am("Remove config")}
          @click=${() => {
            if (globalThis.confirm?.(am("Remove this agent config?")) ?? true) {
              props.onRemoveAgent(agent.id);
            }
          }}
        >
          ${am("Remove config")}
        </button>
      </div>
    </article>
  `;
}

function renderConfiguredAgents(props: AgentManagerProps) {
  const agents = props.agentsList?.agents ?? [];
  return html`
    <section class="agent-manager__configured">
      <div class="agent-manager__configured-head">
        <h3>${am("Configured agents")}</h3>
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${props.agentsLoading || props.setupAgentSaving || !props.connected}
          @click=${() => props.onRefresh()}
        >
          ${props.agentsLoading ? am("Refreshing...") : am("Refresh")}
        </button>
      </div>
      ${props.agentsError
        ? html`<div class="callout danger">${props.agentsError}</div>`
        : props.agentsLoading
          ? html`<div class="callout info">${am("Agent list is loading.")}</div>`
          : nothing}
      ${agents.length > 0
        ? html`<div class="agent-card-grid">
            ${agents.map((agent) => renderAgentCard(props, agent))}
          </div>`
        : html`<div class="agent-manager__empty">${am("No configured agents yet.")}</div>`}
    </section>
  `;
}

export function renderAgentManager(props: AgentManagerProps) {
  return html`
    <div class="agent-manager">
      ${renderQuickAgentSetup(props)} ${renderConfiguredAgents(props)}
    </div>
  `;
}
