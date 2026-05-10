import { html, nothing } from "lit";
import { isZhCnConfigCopy, localizeConfigCopy } from "../../i18n/lib/config-copy.ts";
import { formatDurationHuman } from "../format.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import { icons } from "../icons.ts";
import { renderCostBreakdownCompact, renderDailyChartCompact } from "./usage-render-overview.ts";
import type { CostDailyEntry, UsageTotals } from "./usageTypes.ts";

export type OuiOverviewProps = {
  connected: boolean;
  hello: GatewayHelloOk | null;
  gatewayUrl: string;
  hasToken: boolean;
  lastError: string | null;
  tokenBusy: boolean;
  tokenMessage: { kind: "success" | "error"; text: string } | null;
  usageDaily: CostDailyEntry[];
  usageTotals: UsageTotals | null;
  usageError: string | null;
  usageLoading: boolean;
  usageDailyChartMode: "total" | "by-type";
  onGetToken: () => void | Promise<void>;
  onConnect: () => void;
  onRefresh: () => void | Promise<void>;
  onUsageRefresh: () => void | Promise<void>;
  onUsageDailyChartModeChange: (mode: "total" | "by-type") => void;
};

const COPY: Record<string, string> = {
  Overview: "概览",
  "Gateway Status": "Gateway 状态",
  Online: "在线",
  Offline: "离线",
  "Gateway URL": "Gateway 地址",
  Token: "Token",
  Ready: "已获取",
  Missing: "未获取",
  Version: "版本",
  Uptime: "运行时间",
  "Get Token": "获取 Token",
  Connect: "连接",
  Refresh: "刷新",
  "No error": "无错误",
  "Token Usage": "Token 使用量",
};

function oui(text: string): string {
  if (isZhCnConfigCopy()) {
    return COPY[text] ?? localizeConfigCopy(text);
  }
  return text;
}

function overviewAction(text: string, zhText: string): string {
  return isZhCnConfigCopy() ? zhText : text;
}

function resolveSnapshot(hello: GatewayHelloOk | null) {
  return hello?.snapshot as { uptimeMs?: number } | null | undefined;
}

function renderTokenUsage(props: OuiOverviewProps) {
  const hasUsage = props.usageDaily.length > 0 || Boolean(props.usageTotals);

  return html`
    <div class="card usage-left-card oui-overview__usage-card">
      <div class="oui-overview__usage-head">
        <div class="oui-overview__usage-title">${oui("Token Usage")}</div>
        <button
          type="button"
          class="btn btn--sm btn--subtle oui-overview__usage-refresh"
          ?disabled=${props.usageLoading || !props.connected}
          @click=${() => props.onUsageRefresh()}
        >
          ${props.usageLoading
            ? overviewAction("Loading", "读取中")
            : overviewAction("Query usage", "查询使用情况")}
        </button>
      </div>
      ${props.usageError
        ? html`<div class="oui-overview__error">${props.usageError}</div>`
        : nothing}
      ${props.usageLoading && !hasUsage
        ? html`<div class="usage-empty-block">${localizeConfigCopy("Loading")}</div>`
        : html`
            ${renderDailyChartCompact(
              props.usageDaily,
              [],
              "tokens",
              props.usageDailyChartMode,
              props.onUsageDailyChartModeChange,
              () => undefined,
            )}
            ${props.usageTotals ? renderCostBreakdownCompact(props.usageTotals, "tokens") : nothing}
          `}
    </div>
  `;
}

export function renderOuiOverview(props: OuiOverviewProps) {
  const uptimeMs = resolveSnapshot(props.hello)?.uptimeMs;
  const uptime = typeof uptimeMs === "number" && uptimeMs > 0 ? formatDurationHuman(uptimeMs) : "—";
  const version = props.hello?.server?.version ?? "—";
  const statusLabel = props.connected ? oui("Online") : oui("Offline");
  const tokenLabel = props.hasToken ? oui("Ready") : oui("Missing");

  return html`
    <section class="oui-overview">
      <div class="oui-overview__module">
        <div class="oui-overview__module-head">
          <div>
            <div class="oui-overview__eyebrow">OUI</div>
            <h2>${oui("Gateway Status")}</h2>
          </div>
          <div
            class="oui-overview__status ${props.connected
              ? "oui-overview__status--online"
              : "oui-overview__status--offline"}"
          >
            <span></span>
            ${statusLabel}
          </div>
        </div>

        <div class="oui-overview__stats">
          <div class="oui-overview__stat">
            <span>${oui("Gateway URL")}</span>
            <strong>${props.gatewayUrl || "—"}</strong>
          </div>
          <div class="oui-overview__stat">
            <span>${oui("Token")}</span>
            <strong>${tokenLabel}</strong>
          </div>
          <div class="oui-overview__stat">
            <span>${oui("Version")}</span>
            <strong>${version}</strong>
          </div>
          <div class="oui-overview__stat">
            <span>${oui("Uptime")}</span>
            <strong>${uptime}</strong>
          </div>
        </div>

        ${props.lastError
          ? html`<div class="oui-overview__error">${props.lastError}</div>`
          : nothing}

        <div class="oui-overview__actions">
          <button
            class="btn primary oui-overview__button"
            ?disabled=${props.tokenBusy}
            @click=${() => props.onGetToken()}
          >
            ${icons.settings} <span>${oui("Get Token")}</span>
          </button>
          <button class="btn oui-overview__button" @click=${() => props.onConnect()}>
            ${icons.link} <span>${oui("Connect")}</span>
          </button>
          <button class="btn btn--subtle oui-overview__button" @click=${() => props.onRefresh()}>
            ${icons.refresh} <span>${oui("Refresh")}</span>
          </button>
        </div>

        ${props.tokenMessage
          ? html`<div
              class="oui-overview__message oui-overview__message--${props.tokenMessage.kind}"
            >
              ${props.tokenMessage.text}
            </div>`
          : nothing}
      </div>
      ${renderTokenUsage(props)}
    </section>
  `;
}
