import { html, nothing } from "lit";
import { isZhCnConfigCopy, localizeConfigCopy } from "../../i18n/lib/config-copy.ts";
import "../components/oui-select.ts";
import type { SetupWizardMode } from "../controllers/setup-wizard.ts";
import { icons } from "../icons.ts";
import {
  QUICK_MODEL_VENDORS,
  findQuickModelVendor,
  resolveQuickModelPlan,
  type QuickModelPlan,
} from "../model-plan-setup.ts";
import type {
  ChannelsStatusSnapshot,
  ModelAuthStatusResult,
  WizardRunStatus,
  WizardStep,
  WizardStepOption,
} from "../types.ts";

export type SetupWizardProps = {
  connected: boolean;
  busy: boolean;
  sessionId: string | null;
  status: WizardRunStatus | "idle";
  error: string | null;
  step: WizardStep | null;
  config: Record<string, unknown> | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  modelAuthStatus: ModelAuthStatusResult | null;
  configReady: boolean;
  setupModelProviderId: string;
  setupModelPlanId: string;
  setupModelApiKey: string;
  setupModelSaving: boolean;
  setupModelMessage: { kind: "success" | "error"; text: string } | null;
  onSetupModelProviderChange: (providerId: string) => void;
  onSetupModelPlanChange: (planId: string) => void;
  onSetupModelApiKeyChange: (apiKey: string) => void;
  onSetupModelApply: () => void | Promise<void>;
  onStart: (mode: SetupWizardMode) => void | Promise<void>;
  onSubmit: (value: unknown) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
};

export type QuickModelSetupProps = Pick<
  SetupWizardProps,
  | "connected"
  | "configReady"
  | "setupModelProviderId"
  | "setupModelPlanId"
  | "setupModelApiKey"
  | "setupModelSaving"
  | "setupModelMessage"
  | "onSetupModelProviderChange"
  | "onSetupModelPlanChange"
  | "onSetupModelApiKeyChange"
  | "onSetupModelApply"
  | "onRefresh"
>;

const COPY: Record<string, string> = {
  "Setup Wizard": "接入配置",
  "Model plans and chat apps": "模型套餐与通信软件",
  "Local gateway": "本机配置",
  "Remote gateway": "远程网关",
  Refresh: "刷新",
  "Current config": "当前配置",
  "Default model": "默认模型",
  "No default model": "未设置默认模型",
  Providers: "模型厂商",
  "Auth profiles": "授权档案",
  "Chat apps": "通信软件",
  Configured: "已配置",
  "No channel snapshot": "暂无通信状态",
  "Gateway disconnected": "网关未连接",
  "Wizard running": "向导进行中",
  Continue: "继续",
  Cancel: "取消",
  Yes: "是",
  No: "否",
  Submit: "提交",
  "Select all that apply": "可多选",
  "Waiting for gateway": "等待网关处理",
  Done: "完成",
  Cancelled: "已取消",
  Error: "错误",
  "Start local setup": "配置本机",
  "Start remote setup": "配置远程",
  "Run onboard from UI": "从 UI 运行 onboard",
  "Choose provider": "选择厂商",
  "Choose plan": "选择套餐",
  "Paste key": "填入 Key",
  "Save and use as default": "保存并设为默认",
  Saving: "保存中",
  "Original onboard wizard": "原始 onboard 向导",
  "Advanced setup": "高级配置",
  "Model setup": "模型接入",
  "Load config before saving": "配置未加载，刷新后再保存",
};

function sw(text: string): string {
  if (isZhCnConfigCopy()) {
    return COPY[text] ?? localizeConfigCopy(text);
  }
  return text;
}

function planLabel(plan: QuickModelPlan): string {
  return isZhCnConfigCopy() ? plan.labelZh : plan.label;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionKey(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

function countModelProviders(config: Record<string, unknown> | null): number {
  return Object.keys(asRecord(asRecord(config?.models)?.providers) ?? {}).length;
}

function channelConfigured(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return (
    record.configured === true ||
    record.linked === true ||
    record.connected === true ||
    Boolean(record.tokenSource || record.botTokenSource || record.appTokenSource)
  );
}

function countConfiguredChannels(snapshot: ChannelsStatusSnapshot | null): {
  configured: number;
  total: number;
} {
  if (!snapshot) {
    return { configured: 0, total: 0 };
  }
  const ids = snapshot.channelMeta?.length
    ? snapshot.channelMeta.map((entry) => entry.id)
    : snapshot.channelOrder;
  const uniqueIds = [...new Set(ids.length > 0 ? ids : Object.keys(snapshot.channels ?? {}))];
  const configured = uniqueIds.filter((id) => {
    if (channelConfigured(snapshot.channels?.[id])) {
      return true;
    }
    return (snapshot.channelAccounts?.[id] ?? []).some((account) => account.configured === true);
  }).length;
  return { configured, total: uniqueIds.length };
}

function statusLabel(status: WizardRunStatus | "idle"): string {
  switch (status) {
    case "running":
      return sw("Wizard running");
    case "done":
      return sw("Done");
    case "cancelled":
      return sw("Cancelled");
    case "error":
      return sw("Error");
    case "idle":
      return sw("Run onboard from UI");
  }
}

function renderSummary(props: SetupWizardProps) {
  const defaultModel = resolveDefaultModel(props.config);
  const providerCount = countModelProviders(props.config);
  const authProfiles = props.modelAuthStatus?.providers.length ?? 0;
  const channels = countConfiguredChannels(props.channelsSnapshot);
  return html`
    <section class="setup-wizard__summary" aria-label=${sw("Current config")}>
      <div class="setup-wizard__metric setup-wizard__metric--wide">
        <span>${sw("Default model")}</span>
        <strong class="mono">${defaultModel ?? sw("No default model")}</strong>
      </div>
      <div class="setup-wizard__metric">
        <span>${sw("Providers")}</span>
        <strong>${providerCount.toLocaleString()}</strong>
      </div>
      <div class="setup-wizard__metric">
        <span>${sw("Auth profiles")}</span>
        <strong>${authProfiles.toLocaleString()}</strong>
      </div>
      <div class="setup-wizard__metric">
        <span>${sw("Chat apps")}</span>
        <strong>
          ${channels.total > 0
            ? `${channels.configured.toLocaleString()} / ${channels.total.toLocaleString()}`
            : sw("No channel snapshot")}
        </strong>
      </div>
    </section>
  `;
}

export function renderQuickModelSetup(props: QuickModelSetupProps) {
  const vendor = findQuickModelVendor(props.setupModelProviderId) ?? QUICK_MODEL_VENDORS[0] ?? null;
  if (!vendor) {
    return nothing;
  }
  const plan = resolveQuickModelPlan(vendor.id, props.setupModelPlanId);
  const canSave =
    props.connected &&
    props.configReady &&
    !props.setupModelSaving &&
    Boolean(props.setupModelApiKey.trim());
  return html`
    <section class="setup-quick" aria-label=${sw("Model setup")}>
      <div class="setup-quick__header">
        <div>
          <div class="setup-wizard__eyebrow">OUI</div>
          <h2>${sw("Model setup")}</h2>
        </div>
        <button
          type="button"
          class="btn btn--ghost"
          ?disabled=${props.setupModelSaving}
          @click=${() => props.onRefresh()}
        >
          ${icons.refresh}${sw("Refresh")}
        </button>
      </div>

      <div class="setup-quick__steps" aria-label=${sw("Model setup")}>
        <label class="setup-field">
          <span>
            <b>1</b>
            ${sw("Choose provider")}
          </span>
          <oui-select
            .options=${QUICK_MODEL_VENDORS.map((entry) => ({
              value: entry.id,
              label: entry.label,
            }))}
            .value=${vendor.id}
            ?disabled=${props.setupModelSaving}
            aria-label=${sw("Choose provider")}
            @change=${(event: Event) => {
              const select = event.currentTarget as HTMLElement & { value: string };
              props.onSetupModelProviderChange(select.value);
            }}
          ></oui-select>
        </label>

        <label class="setup-field">
          <span>
            <b>2</b>
            ${sw("Choose plan")}
          </span>
          <oui-select
            .options=${vendor.plans.map((entry) => ({
              value: entry.id,
              label: planLabel(entry),
            }))}
            .value=${plan.id}
            ?disabled=${props.setupModelSaving}
            aria-label=${sw("Choose plan")}
            @change=${(event: Event) => {
              const select = event.currentTarget as HTMLElement & { value: string };
              props.onSetupModelPlanChange(select.value);
            }}
          ></oui-select>
        </label>

        <label class="setup-field setup-field--key">
          <span>
            <b>3</b>
            ${sw("Paste key")}
          </span>
          <input
            type="password"
            autocomplete="off"
            spellcheck="false"
            .value=${props.setupModelApiKey}
            ?disabled=${props.setupModelSaving}
            @input=${(event: InputEvent) => {
              const input = event.currentTarget as HTMLInputElement;
              props.onSetupModelApiKeyChange(input.value);
            }}
          />
        </label>
      </div>

      ${props.setupModelMessage
        ? html`<div
            class="callout ${props.setupModelMessage.kind === "success" ? "info" : "danger"}"
          >
            ${props.setupModelMessage.text}
          </div>`
        : nothing}
      ${!props.connected
        ? html`<div class="callout warn">${sw("Gateway disconnected")}</div>`
        : !props.configReady
          ? html`<div class="callout warn">${sw("Load config before saving")}</div>`
          : nothing}

      <div class="setup-quick__actions">
        <button
          type="button"
          class="btn primary"
          ?disabled=${!canSave}
          @click=${() => props.onSetupModelApply()}
        >
          ${icons.check}${props.setupModelSaving ? sw("Saving") : sw("Save and use as default")}
        </button>
      </div>
    </section>
  `;
}

function renderStepHeader(step: WizardStep, props: SetupWizardProps) {
  return html`
    <div class="setup-step__header">
      <div>
        <div class="setup-wizard__eyebrow">${statusLabel(props.status)}</div>
        ${step.title ? html`<h3>${step.title}</h3>` : nothing}
        ${step.message ? html`<p>${step.message}</p>` : nothing}
      </div>
      <button
        type="button"
        class="btn btn--sm btn--ghost"
        ?disabled=${props.busy}
        @click=${() => props.onCancel()}
      >
        ${sw("Cancel")}
      </button>
    </div>
  `;
}

function renderSelectStep(step: WizardStep, props: SetupWizardProps) {
  const initial = optionKey(step.initialValue);
  return html`
    <div class="setup-step__options">
      ${(step.options ?? []).map((option) => {
        const active = optionKey(option.value) === initial;
        return html`
          <button
            type="button"
            class="setup-option ${active ? "setup-option--active" : ""}"
            ?disabled=${props.busy}
            @click=${() => props.onSubmit(option.value)}
          >
            <span>${option.label}</span>
            ${option.hint ? html`<small>${option.hint}</small>` : nothing}
          </button>
        `;
      })}
    </div>
  `;
}

function renderTextStep(step: WizardStep, props: SetupWizardProps) {
  return html`
    <form
      class="setup-step__form"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        props.onSubmit(String(new FormData(form).get("value") ?? ""));
      }}
    >
      <input
        name="value"
        type=${step.sensitive ? "password" : "text"}
        autocomplete=${step.sensitive ? "off" : "on"}
        placeholder=${step.placeholder ?? ""}
        .value=${typeof step.initialValue === "string" ? step.initialValue : ""}
        ?disabled=${props.busy}
      />
      <button class="btn primary" type="submit" ?disabled=${props.busy}>${sw("Submit")}</button>
    </form>
  `;
}

function renderConfirmStep(step: WizardStep, props: SetupWizardProps) {
  const initial = step.initialValue === true;
  return html`
    <div class="setup-step__actions">
      <button
        type="button"
        class="btn primary ${initial ? "" : "btn--ghost"}"
        ?disabled=${props.busy}
        @click=${() => props.onSubmit(true)}
      >
        ${sw("Yes")}
      </button>
      <button
        type="button"
        class="btn ${initial ? "btn--ghost" : ""}"
        ?disabled=${props.busy}
        @click=${() => props.onSubmit(false)}
      >
        ${sw("No")}
      </button>
    </div>
  `;
}

function renderMultiselectStep(step: WizardStep, props: SetupWizardProps) {
  const initial = new Set(
    (Array.isArray(step.initialValue) ? step.initialValue : []).map((value) => optionKey(value)),
  );
  return html`
    <form
      class="setup-step__multi"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const selected = new Set(new FormData(form).getAll("value").map((value) => String(value)));
        const values = (step.options ?? [])
          .filter((option) => selected.has(optionKey(option.value)))
          .map((option) => option.value);
        props.onSubmit(values);
      }}
    >
      <div class="setup-wizard__eyebrow">${sw("Select all that apply")}</div>
      ${(step.options ?? []).map((option: WizardStepOption) => {
        const key = optionKey(option.value);
        return html`
          <label class="setup-option setup-option--check">
            <input
              type="checkbox"
              name="value"
              value=${key}
              ?checked=${initial.has(key)}
              ?disabled=${props.busy}
            />
            <span>
              <b>${option.label}</b>
              ${option.hint ? html`<small>${option.hint}</small>` : nothing}
            </span>
          </label>
        `;
      })}
      <button class="btn primary" type="submit" ?disabled=${props.busy}>${sw("Submit")}</button>
    </form>
  `;
}

function renderContinueStep(_step: WizardStep, props: SetupWizardProps) {
  return html`
    <div class="setup-step__actions">
      <button
        type="button"
        class="btn primary"
        ?disabled=${props.busy}
        @click=${() => props.onSubmit(true)}
      >
        ${sw("Continue")}
      </button>
    </div>
  `;
}

function renderStepBody(step: WizardStep, props: SetupWizardProps) {
  switch (step.type) {
    case "select":
      return renderSelectStep(step, props);
    case "text":
      return renderTextStep(step, props);
    case "confirm":
      return renderConfirmStep(step, props);
    case "multiselect":
      return renderMultiselectStep(step, props);
    case "note":
    case "action":
      return renderContinueStep(step, props);
    case "progress":
      return html`<div class="callout info">${sw("Waiting for gateway")}</div>`;
  }
}

function renderStep(props: SetupWizardProps) {
  const step = props.step;
  if (!step) {
    return nothing;
  }
  return html`
    <section class="setup-step">
      ${renderStepHeader(step, props)}
      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
      ${renderStepBody(step, props)}
    </section>
  `;
}

function renderTerminalStatus(props: SetupWizardProps) {
  if (props.step || props.status === "idle" || props.status === "running") {
    return props.error ? html`<div class="callout danger">${props.error}</div>` : nothing;
  }
  const tone = props.status === "done" ? "info" : props.status === "cancelled" ? "warn" : "danger";
  return html`
    <div class="callout ${tone}">
      ${statusLabel(props.status)} ${props.error ? html`<span> ${props.error}</span>` : nothing}
    </div>
  `;
}

export function renderSetupWizard(props: SetupWizardProps) {
  const startDisabled = !props.connected || props.busy || Boolean(props.sessionId);
  const advancedOpen = Boolean(props.sessionId || props.step || props.error);
  return html`
    <div class="setup-wizard">
      ${renderSummary(props)} ${renderQuickModelSetup(props)}

      <details class="setup-wizard__advanced" ?open=${advancedOpen}>
        <summary>
          <span>
            <b>${sw("Advanced setup")}</b>
            <small>${sw("Original onboard wizard")}</small>
          </span>
        </summary>
        <div class="setup-wizard__advanced-body">
          <div class="setup-wizard__hero-actions">
            <button
              type="button"
              class="btn"
              ?disabled=${startDisabled}
              @click=${() => props.onStart("local")}
            >
              ${icons.monitor}${sw("Start local setup")}
            </button>
            <button
              type="button"
              class="btn"
              ?disabled=${startDisabled}
              @click=${() => props.onStart("remote")}
            >
              ${icons.globe}${sw("Start remote setup")}
            </button>
          </div>
          ${renderTerminalStatus(props)} ${renderStep(props)}
        </div>
      </details>
    </div>
  `;
}
