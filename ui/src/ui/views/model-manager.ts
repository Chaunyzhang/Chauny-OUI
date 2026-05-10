import { html, nothing } from "lit";
import { isZhCnConfigCopy, localizeConfigCopy } from "../../i18n/lib/config-copy.ts";
import { buildQualifiedChatModelValue } from "../chat-model-ref.ts";
import "../components/oui-select.ts";
import type {
  ModelAuthStatusProvider,
  ModelAuthStatusResult,
  ModelCatalogEntry,
  SessionsUsageResult,
} from "../types.ts";
import { renderQuickModelSetup, type QuickModelSetupProps } from "./setup-wizard.ts";
import { formatCost, formatTokens } from "./usage-metrics.ts";
import type { UsageTotals } from "./usageTypes.ts";

export type ModelManagerProps = QuickModelSetupProps & {
  basePath?: string | null;
  catalog: ModelCatalogEntry[];
  catalogLoading: boolean;
  authStatus: ModelAuthStatusResult | null;
  authLoading: boolean;
  authError: string | null;
  config: Record<string, unknown> | null;
  configLoading: boolean;
  configDirty: boolean;
  connected: boolean;
  usageResult: SessionsUsageResult | null;
  usageLoading: boolean;
  usageError: string | null;
  onRefresh: () => void | Promise<void>;
  onUsageRefresh: () => void | Promise<void>;
  onSetDefaultModel: (modelRef: string, runtimeId?: string | null) => void;
  onRemoveProvider: (providerId: string) => void;
};

type ProviderModel = {
  id: string;
  name: string;
  ref: string;
  reasoning?: boolean;
  contextWindow?: number;
  input?: readonly string[];
  source: "config" | "catalog";
};

type ProviderCard = {
  id: string;
  label: string;
  planLabel: string;
  group: PlanGroupId;
  accessKind: ProviderAccessKind;
  hasConfigEntry: boolean;
  auth?: ModelAuthStatusProvider;
  baseUrl?: string;
  api?: string;
  authMode?: string;
  models: ProviderModel[];
};

type PlanGroupId = "codex" | "china" | "custom" | "other";
type ProviderAccessKind = "oauth" | "token-plan" | "coding-plan" | "api-key" | "custom-api";
type ProviderDailyUsage = {
  date: string;
  tokens: number;
  cost: number;
  count: number;
};
type ProviderUsageStats = {
  count: number;
  totals: UsageTotals;
  daily: ProviderDailyUsage[];
};

const COPY: Record<string, string> = {
  "Model Manager": "模型管理",
  "Configured models": "已配置模型",
  "Auth profiles": "授权档案",
  "Default model": "默认模型",
  Runtime: "运行时",
  "Not set": "未设置",
  "No runtime pin": "未固定运行时",
  "Refreshing...": "刷新中...",
  Refresh: "刷新",
  Configured: "已配置",
  "Needs sign-in": "需要登录",
  "Expires soon": "即将过期",
  Expired: "已过期",
  "API key": "API key",
  OAuth: "OAuth",
  Token: "Token",
  Static: "静态凭据",
  Missing: "缺失",
  Models: "模型",
  Model: "模型",
  Provider: "Provider",
  Plan: "套餐",
  "Set default": "设为默认",
  "No models in this group yet.": "这个分组还没有模型。",
  "Add custom API": "添加自定义 API",
  "Provider ID": "Provider ID",
  "Base URL": "Base URL",
  "Auth / env ref": "认证 / 环境变量引用",
  Protocol: "协议",
  "Model ID": "Model ID",
  "Display name": "显示名称",
  "Context window": "上下文窗口",
  "Max output": "最大输出",
  "Reasoning model": "推理模型",
  "Add provider": "添加 provider",
  "Auth status unavailable": "无法读取授权状态",
  "Model catalog is loading.": "正在读取模型目录。",
  "No configured models yet. Add a provider or sign in to an OAuth plan.":
    "还没有已配置模型。可以先添加 provider，或登录 OAuth 套餐。",
  Current: "当前",
  "Current default": "当前默认",
  "Configured in file": "配置文件",
  Discovered: "已发现",
  "No models": "暂无模型",
  "OpenAI / Codex subscription": "OpenAI / Codex 订阅",
  "MiniMax Coding Plan": "MiniMax Coding Plan",
  "MiniMax Token Plan": "MiniMax Token Plan",
  "China model plans": "国产模型套餐",
  "Custom API": "自定义 API",
  "Other providers": "其他 provider",
  "ChatGPT/Codex subscription and refreshable sign-in profiles.":
    "ChatGPT/Codex 订阅和可刷新的登录授权。",
  "MiniMax, z.ai, Qwen, DeepSeek and similar domestic plan providers.":
    "MiniMax、智谱、通义、DeepSeek 等国产模型套餐。",
  "Provider entries backed by a Base URL, API protocol and model IDs.":
    "由 Base URL、协议和模型 ID 组成的自定义 provider。",
  "Built-in or discovered providers that are not part of the plan groups above.":
    "未归入上面套餐分组的内置或自动发现 provider。",
  "Token Plan": "Token Plan",
  "Coding Plan": "Coding Plan",
  Remove: "移除",
  "Remove provider": "移除 provider",
  "Remove this provider?": "确定移除这个 provider 吗？",
  "OAuth removal needs sign-out": "OAuth 需要退出授权",
  Usage: "使用量",
  "No usage yet": "暂无使用",
  "Loading usage": "读取中",
  "Query usage": "查询使用情况",
  Calls: "调用",
  Cost: "费用",
  Quota: "额度",
};

function mm(text: string): string {
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function createEmptyUsageTotals(): UsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    missingCostEntries: 0,
  };
}

function addUsageTotals(target: UsageTotals, source: UsageTotals) {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.totalTokens += source.totalTokens;
  target.totalCost += source.totalCost;
  target.inputCost += source.inputCost;
  target.outputCost += source.outputCost;
  target.cacheReadCost += source.cacheReadCost;
  target.cacheWriteCost += source.cacheWriteCost;
  target.missingCostEntries += source.missingCostEntries;
}

function getConfigProviders(config: Record<string, unknown> | null): Record<string, unknown> {
  return asRecord(asRecord(config?.models)?.providers) ?? {};
}

function resolveDefaultModel(config: Record<string, unknown> | null): string | null {
  const defaults = asRecord(asRecord(config?.agents)?.defaults);
  const model = defaults?.model;
  if (typeof model === "string") {
    return model.trim() || null;
  }
  const modelRecord = asRecord(model);
  return asString(modelRecord?.primary) ?? asString(modelRecord?.model) ?? null;
}

function resolveDefaultRuntime(config: Record<string, unknown> | null): string | null {
  const defaults = asRecord(asRecord(config?.agents)?.defaults);
  return asString(asRecord(defaults?.agentRuntime)?.id) ?? null;
}

function providerDisplayName(providerId: string, auth?: ModelAuthStatusProvider): string {
  if (auth?.displayName) {
    return auth.displayName;
  }
  const map: Record<string, string> = {
    openai: "OpenAI",
    "openai-codex": "OpenAI Codex",
    anthropic: "Anthropic",
    claude: "Anthropic",
    minimax: "MiniMax",
    "minimax-portal": "MiniMax Portal",
    zai: "z.ai",
    "z.ai": "z.ai",
    qwen: "Qwen",
    dashscope: "DashScope",
    deepseek: "DeepSeek",
    moonshot: "Moonshot",
    kimi: "Kimi",
    xiaomi: "Xiaomi",
  };
  return map[providerId.toLowerCase()] ?? providerId;
}

function providerPlanLabel(providerId: string, auth?: ModelAuthStatusProvider): string {
  const lower = providerId.toLowerCase();
  if (lower === "openai-codex" || lower === "openai") {
    return mm("OpenAI / Codex subscription");
  }
  if (lower === "minimax-portal") {
    return mm("MiniMax Coding Plan");
  }
  if (lower === "minimax") {
    return mm("MiniMax Token Plan");
  }
  if (auth?.usage?.plan) {
    return auth.usage.plan;
  }
  return mm("Custom API");
}

function providerAccessKind(params: {
  providerId: string;
  auth?: ModelAuthStatusProvider;
  providerConfig?: Record<string, unknown> | null;
}): ProviderAccessKind {
  const lower = params.providerId.toLowerCase();
  const authMode = asString(params.providerConfig?.auth)?.toLowerCase();
  const plan = params.auth?.usage?.plan?.toLowerCase() ?? "";
  const profileTypes = new Set(params.auth?.profiles.map((profile) => profile.type) ?? []);
  if (profileTypes.has("oauth") || authMode === "oauth") {
    return "oauth";
  }
  if (lower === "minimax-portal" || plan.includes("coding")) {
    return "coding-plan";
  }
  if (lower === "minimax" || plan.includes("token")) {
    return "token-plan";
  }
  if (profileTypes.has("api_key") || authMode === "api-key" || params.providerConfig?.apiKey) {
    return "api-key";
  }
  return "custom-api";
}

function accessKindLabel(kind: ProviderAccessKind): string {
  switch (kind) {
    case "oauth":
      return "OAuth";
    case "token-plan":
      return "Token Plan";
    case "coding-plan":
      return "Coding Plan";
    case "api-key":
      return "API key";
    case "custom-api":
      return "Custom API";
  }
}

function isChinaProvider(providerId: string): boolean {
  return [
    "minimax",
    "minimax-portal",
    "zai",
    "z.ai",
    "bigmodel",
    "glm",
    "qwen",
    "dashscope",
    "alibaba",
    "deepseek",
    "moonshot",
    "kimi",
    "xiaomi",
    "baidu",
    "qianfan",
    "tencent",
    "hunyuan",
    "volcengine",
    "byteplus",
    "stepfun",
  ].includes(providerId.toLowerCase());
}

function assetUrl(basePath: string | null | undefined, path: string): string {
  const base = typeof basePath === "string" ? basePath.trim().replace(/\/$/, "") : "";
  return base ? `${base}/${path}` : `/${path}`;
}

function providerLogoUrl(basePath: string | null | undefined, providerId: string): string | null {
  const key = providerId.toLowerCase();
  const logo =
    {
      openai: "openai.svg",
      "openai-codex": "openai.svg",
      anthropic: "anthropic.svg",
      claude: "anthropic.svg",
      minimax: "minimax.svg",
      "minimax-portal": "minimax.svg",
      qwen: "qwen.svg",
      dashscope: "qwen.svg",
      alibaba: "alibabacloud.svg",
      deepseek: "deepseek.svg",
      moonshot: "moonshot.svg",
      kimi: "moonshot.svg",
    }[key] ?? null;
  return logo ? assetUrl(basePath, `provider-logos/${logo}`) : null;
}

function classifyProvider(params: {
  id: string;
  providerConfig?: Record<string, unknown> | null;
  auth?: ModelAuthStatusProvider;
  defaultRuntime: string | null;
}): PlanGroupId {
  const lower = params.id.toLowerCase();
  if (
    lower === "openai-codex" ||
    (lower === "openai" &&
      (params.defaultRuntime === "codex" || params.auth?.provider === "openai-codex"))
  ) {
    return "codex";
  }
  if (isChinaProvider(lower)) {
    return "china";
  }
  if (
    params.providerConfig &&
    (params.providerConfig.baseUrl || params.providerConfig.apiKey || params.providerConfig.models)
  ) {
    return "custom";
  }
  return "other";
}

function modelFromCatalog(entry: ModelCatalogEntry): ProviderModel {
  return {
    id: entry.id,
    name: entry.name || entry.id,
    ref: buildQualifiedChatModelValue(entry.id, entry.provider),
    reasoning: entry.reasoning,
    contextWindow: entry.contextWindow,
    input: entry.input,
    source: "catalog",
  };
}

function modelFromConfig(providerId: string, raw: unknown): ProviderModel | null {
  const record = asRecord(raw);
  const id = asString(record?.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: asString(record?.name) ?? id,
    ref: buildQualifiedChatModelValue(id, providerId),
    reasoning: typeof record?.reasoning === "boolean" ? record.reasoning : undefined,
    contextWindow: asNumber(record?.contextWindow) ?? asNumber(record?.contextTokens),
    input: Array.isArray(record?.input)
      ? record.input.filter((item) => typeof item === "string")
      : undefined,
    source: "config",
  };
}

function dedupeModels(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  const out: ProviderModel[] = [];
  for (const model of models) {
    const key = model.ref.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(model);
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name));
}

function cardIdForAuthProvider(providerId: string): string {
  return providerId.toLowerCase() === "openai-codex" ? "openai" : providerId;
}

function isConfiguredAuthProvider(provider?: ModelAuthStatusProvider): boolean {
  return Boolean(provider && provider.status !== "missing");
}

function hasConfiguredModelSurface(card: ProviderCard): boolean {
  return (
    card.hasConfigEntry ||
    card.models.some((model) => model.source === "config") ||
    Boolean(card.baseUrl || card.api || card.authMode) ||
    isConfiguredAuthProvider(card.auth)
  );
}

function modelKey(provider?: string, model?: string): string | null {
  if (!provider || !model) {
    return null;
  }
  return `${provider.trim().toLowerCase()}/${model.trim().toLowerCase()}`;
}

function providerModelMatches(params: {
  providerAliases: Set<string>;
  modelRefs: Set<string>;
  modelIds: Set<string>;
  provider?: string;
  model?: string;
}): boolean {
  const entryKey = modelKey(params.provider, params.model);
  const entryProvider = params.provider?.trim().toLowerCase();
  const entryModel = params.model?.trim().toLowerCase();
  return Boolean(
    (entryKey && params.modelRefs.has(entryKey)) ||
    (entryProvider &&
      entryModel &&
      params.providerAliases.has(entryProvider) &&
      params.modelIds.has(entryModel)),
  );
}

function resolveProviderAliases(card: ProviderCard): Set<string> {
  const aliases = new Set<string>([card.id.toLowerCase()]);
  if (card.auth?.provider) {
    aliases.add(card.auth.provider.toLowerCase());
  }
  if (aliases.has("openai")) {
    aliases.add("openai-codex");
  }
  if (aliases.has("openai-codex")) {
    aliases.add("openai");
  }
  return aliases;
}

function parseYmdDate(dateStr: string | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? "");
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function formatYmdDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function resolveSevenDayDates(endDate: string | undefined): string[] {
  const end = parseYmdDate(endDate) ?? new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (6 - index));
    return formatYmdDate(date);
  });
}

function formatMiniDayLabel(date: string): string {
  const parsed = parseYmdDate(date);
  return parsed ? String(parsed.getDate()) : date.slice(5);
}

function resolveProviderUsageStats(
  card: ProviderCard,
  result: SessionsUsageResult | null,
): ProviderUsageStats | null {
  if (!result?.aggregates) {
    return null;
  }

  const totals = createEmptyUsageTotals();
  let count = 0;
  const modelRefs = new Set(card.models.map((model) => model.ref.toLowerCase()));
  const modelIds = new Set(card.models.map((model) => model.id.toLowerCase()));
  const providerAliases = resolveProviderAliases(card);
  const dates = resolveSevenDayDates(result.endDate);
  const dailyByDate = new Map<string, ProviderDailyUsage>(
    dates.map((date) => [date, { date, tokens: 0, cost: 0, count: 0 }]),
  );
  let matchedModelEntries = 0;

  for (const entry of result.aggregates.byModel) {
    if (
      !providerModelMatches({
        providerAliases,
        modelRefs,
        modelIds,
        provider: entry.provider,
        model: entry.model,
      })
    ) {
      continue;
    }
    addUsageTotals(totals, entry.totals);
    count += entry.count;
    matchedModelEntries += 1;
  }

  if (matchedModelEntries === 0) {
    for (const entry of result.aggregates.byProvider) {
      const provider = entry.provider?.trim().toLowerCase();
      if (!provider || !providerAliases.has(provider)) {
        continue;
      }
      addUsageTotals(totals, entry.totals);
      count += entry.count;
    }
  }

  for (const entry of result.aggregates.modelDaily ?? []) {
    const daily = dailyByDate.get(entry.date);
    if (!daily) {
      continue;
    }
    if (
      !providerModelMatches({
        providerAliases,
        modelRefs,
        modelIds,
        provider: entry.provider,
        model: entry.model,
      })
    ) {
      continue;
    }
    daily.tokens += entry.tokens;
    daily.cost += entry.cost;
    daily.count += entry.count;
  }

  const daily = dates.map(
    (date) => dailyByDate.get(date) ?? { date, tokens: 0, cost: 0, count: 0 },
  );

  return count > 0 || totals.totalTokens > 0 || totals.totalCost > 0
    ? { count, totals, daily }
    : null;
}

function renderSevenDayUsageChart(stats: ProviderUsageStats) {
  const maxTokens = Math.max(...stats.daily.map((entry) => entry.tokens), 0);
  if (maxTokens <= 0) {
    return html`<div class="model-provider-card__usage-empty">${mm("No usage yet")}</div>`;
  }
  return html`
    <div class="model-provider-card__usage-chart">
      ${stats.daily.map((entry) => {
        const height = entry.tokens > 0 ? Math.max(8, (entry.tokens / maxTokens) * 58) : 0;
        return html`
          <div
            class="model-provider-card__usage-day"
            title="${entry.date} - ${formatTokens(entry.tokens)}"
          >
            <span
              class="model-provider-card__usage-column"
              style="height: ${height.toFixed(0)}px"
            ></span>
            <span class="model-provider-card__usage-day-label">
              ${formatMiniDayLabel(entry.date)}
            </span>
          </div>
        `;
      })}
    </div>
  `;
}

function formatResetAt(resetAt: number | undefined): string {
  if (typeof resetAt !== "number" || !Number.isFinite(resetAt)) {
    return "";
  }
  return new Date(resetAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderProviderQuota(card: ProviderCard) {
  const windows = card.auth?.usage?.windows ?? [];
  if (windows.length === 0) {
    return nothing;
  }
  return html`
    <div class="model-provider-card__quota">
      ${windows.slice(0, 2).map((window) => {
        const used = Math.max(0, Math.min(100, window.usedPercent));
        const reset = formatResetAt(window.resetAt);
        return html`
          <div class="model-provider-card__quota-row">
            <div class="model-provider-card__quota-label">
              <span>${window.label || mm("Quota")}</span>
              <strong>${used.toFixed(0)}%</strong>
            </div>
            <div class="model-provider-card__quota-bar" aria-hidden="true">
              <span style="width: ${used}%"></span>
            </div>
            ${reset ? html`<div class="model-provider-card__quota-reset">${reset}</div>` : nothing}
          </div>
        `;
      })}
    </div>
  `;
}

function renderProviderUsage(
  props: ModelManagerProps,
  card: ProviderCard,
  stats: ProviderUsageStats | null,
) {
  const loading = props.usageLoading && !stats;
  const hasQuota = Boolean(card.auth?.usage?.windows.length);
  return html`
    <div class="model-provider-card__usage">
      <div class="model-provider-card__usage-head">
        <span>${mm("Usage")}</span>
        <strong>
          ${stats
            ? formatTokens(stats.totals.totalTokens)
            : loading
              ? mm("Loading usage")
              : hasQuota
                ? mm("Quota")
                : mm("No usage yet")}
        </strong>
      </div>
      ${renderProviderQuota(card)}
      ${stats
        ? html`
            ${renderSevenDayUsageChart(stats)}
            <div class="model-provider-card__usage-grid">
              <span>
                <strong>${stats.count}</strong>
                ${mm("Calls")}
              </span>
              <span>
                <strong>${formatCost(stats.totals.totalCost)}</strong>
                ${mm("Cost")}
              </span>
            </div>
          `
        : nothing}
      ${props.usageError && !stats && !loading
        ? html`<div class="model-provider-card__usage-error">${props.usageError}</div>`
        : nothing}
    </div>
  `;
}

function buildProviderCards(props: ModelManagerProps): ProviderCard[] {
  const providers = new Map<string, ProviderCard>();
  const configProviders = getConfigProviders(props.config);
  const authByProvider = new Map(
    (props.authStatus?.providers ?? []).map((provider) => [
      provider.provider.toLowerCase(),
      provider,
    ]),
  );
  const defaultRuntime = resolveDefaultRuntime(props.config);

  const ensure = (providerId: string): ProviderCard => {
    const key = providerId.toLowerCase();
    const existing = providers.get(key);
    if (existing) {
      return existing;
    }
    const hasExactConfigEntry = Object.hasOwn(configProviders, providerId);
    const hasLowerConfigEntry = Object.hasOwn(configProviders, key);
    const hasConfigEntry = hasExactConfigEntry || hasLowerConfigEntry;
    const providerConfig = hasExactConfigEntry
      ? asRecord(configProviders[providerId])
      : hasLowerConfigEntry
        ? asRecord(configProviders[key])
        : null;
    const auth =
      authByProvider.get(key) ??
      (key === "openai" ? authByProvider.get("openai-codex") : undefined);
    const card: ProviderCard = {
      id: providerId,
      label: providerDisplayName(providerId, auth),
      planLabel: providerPlanLabel(providerId, auth),
      group: classifyProvider({ id: providerId, providerConfig, auth, defaultRuntime }),
      accessKind: providerAccessKind({ providerId, auth, providerConfig }),
      hasConfigEntry,
      auth,
      baseUrl: asString(providerConfig?.baseUrl),
      api: asString(providerConfig?.api),
      authMode: asString(providerConfig?.auth),
      models: [],
    };
    providers.set(key, card);
    return card;
  };

  for (const [providerId, rawProvider] of Object.entries(configProviders)) {
    const card = ensure(providerId);
    const provider = asRecord(rawProvider);
    const models = Array.isArray(provider?.models) ? provider.models : [];
    for (const rawModel of models) {
      const model = modelFromConfig(providerId, rawModel);
      if (model) {
        card.models.push(model);
      }
    }
  }

  for (const auth of props.authStatus?.providers ?? []) {
    if (!isConfiguredAuthProvider(auth)) {
      continue;
    }
    ensure(cardIdForAuthProvider(auth.provider));
  }

  for (const entry of props.catalog) {
    const providerId = entry.provider?.trim();
    if (!providerId || !providers.has(providerId.toLowerCase())) {
      continue;
    }
    ensure(providerId).models.push(modelFromCatalog(entry));
  }

  return Array.from(providers.values())
    .map((card) => ({ ...card, models: dedupeModels(card.models) }))
    .filter(hasConfiguredModelSurface)
    .toSorted((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}

function renderProviderCard(props: ModelManagerProps, card: ProviderCard) {
  const defaultModel = resolveDefaultModel(props.config);
  const selectedModel =
    card.models.find((model) => model.ref === defaultModel)?.ref ?? card.models[0]?.ref ?? "";
  const logoUrl = providerLogoUrl(props.basePath, card.id);
  const isCurrentProvider = card.models.some((model) => model.ref === defaultModel);
  const usageStats = resolveProviderUsageStats(card, props.usageResult);
  return html`
    <form
      class="model-provider-card"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const select = form.querySelector("oui-select[name='modelRef']") as
          | (HTMLElement & { value?: string })
          | null;
        const modelRef = String(select?.value ?? "").trim();
        if (modelRef) {
          props.onSetDefaultModel(modelRef);
        }
      }}
    >
      <div class="model-provider-card__top">
        <div class="model-provider-card__logo" aria-hidden="true">
          ${logoUrl
            ? html`<img src=${logoUrl} alt="" loading="lazy" />`
            : html`<span>${card.label.slice(0, 1).toUpperCase()}</span>`}
        </div>
        <div class="model-provider-card__title">
          <strong>${card.label}</strong>
          <span>${isCurrentProvider ? mm("Current default") : card.id}</span>
        </div>
        <span class="model-access model-access--${card.accessKind}">
          ${mm(accessKindLabel(card.accessKind))}
        </span>
      </div>

      ${renderProviderUsage(props, card, usageStats)}
      ${card.models.length > 0
        ? html`
            <label class="model-provider-card__model">
              <span>${mm("Model")}</span>
              <oui-select
                name="modelRef"
                .value=${selectedModel}
                .options=${card.models.map((model) => ({ value: model.ref, label: model.name }))}
                aria-label=${mm("Model")}
              ></oui-select>
            </label>
            <div class="model-provider-card__actions">
              <button
                type="submit"
                class="btn btn--sm"
                ?disabled=${!props.connected || props.configLoading}
              >
                ${mm("Set default")}
              </button>
              <button
                type="button"
                class="btn btn--sm btn--danger"
                ?disabled=${!card.hasConfigEntry || !props.connected || props.configLoading}
                title=${card.hasConfigEntry
                  ? mm("Remove provider")
                  : mm("OAuth removal needs sign-out")}
                @click=${() => {
                  if (globalThis.confirm?.(mm("Remove this provider?")) ?? true) {
                    props.onRemoveProvider(card.id);
                  }
                }}
              >
                ${mm("Remove")}
              </button>
            </div>
          `
        : html`<div class="model-provider-card__empty">${mm("No models")}</div>`}
    </form>
  `;
}

function renderConfiguredModelsSection(props: ModelManagerProps, cards: ProviderCard[]) {
  return html`
    <section class="model-manager__configured">
      <div class="model-manager__configured-head">
        <h3>${mm("Configured models")}</h3>
        <div class="model-manager__configured-actions">
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${props.catalogLoading || props.authLoading || !props.connected}
            @click=${() => props.onRefresh()}
          >
            ${props.catalogLoading || props.authLoading ? mm("Refreshing...") : mm("Refresh")}
          </button>
          <button
            type="button"
            class="btn btn--sm btn--subtle"
            ?disabled=${props.usageLoading || !props.connected}
            @click=${() => props.onUsageRefresh()}
          >
            ${props.usageLoading ? mm("Loading usage") : mm("Query usage")}
          </button>
        </div>
      </div>
      ${props.authError
        ? html`<div class="callout warn">${mm("Auth status unavailable")}: ${props.authError}</div>`
        : nothing}
      ${props.catalogLoading
        ? html`<div class="callout info">${mm("Model catalog is loading.")}</div>`
        : nothing}
      ${cards.length > 0
        ? html`<div class="model-provider-grid">
            ${cards.map((card) => renderProviderCard(props, card))}
          </div>`
        : html`<div class="model-manager__empty">
            ${mm("No configured models yet. Add a provider or sign in to an OAuth plan.")}
          </div>`}
    </section>
  `;
}

export function renderModelManager(props: ModelManagerProps) {
  const cards = buildProviderCards(props);
  return html`
    <div class="model-manager">
      ${renderQuickModelSetup(props)} ${renderConfiguredModelsSection(props, cards)}
    </div>
  `;
}
