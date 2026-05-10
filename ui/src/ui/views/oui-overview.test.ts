/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderOuiOverview, type OuiOverviewProps } from "./oui-overview.ts";

function createProps(overrides: Partial<OuiOverviewProps> = {}): OuiOverviewProps {
  return {
    connected: false,
    hello: null,
    gatewayUrl: "ws://127.0.0.1:18789",
    hasToken: false,
    lastError: null,
    tokenBusy: false,
    tokenMessage: null,
    usageDaily: [],
    usageTotals: null,
    usageError: null,
    usageLoading: false,
    usageDailyChartMode: "by-type",
    onGetToken: () => undefined,
    onConnect: () => undefined,
    onRefresh: () => undefined,
    onUsageRefresh: () => undefined,
    onUsageDailyChartModeChange: () => undefined,
    ...overrides,
  };
}

describe("OUI overview", () => {
  it("renders the gateway status and token action as a single module", async () => {
    const container = document.createElement("div");
    render(renderOuiOverview(createProps()), container);
    await Promise.resolve();

    expect(container.querySelector(".oui-overview__module")).not.toBeNull();
    expect(container.textContent).toContain("Gateway Status");
    expect(container.textContent).toContain("Offline");
    expect(container.textContent).toContain("ws://127.0.0.1:18789");
    expect(container.textContent).toContain("Get Token");
  });

  it("invokes the token action from the primary button", async () => {
    const onGetToken = vi.fn();
    const container = document.createElement("div");
    render(renderOuiOverview(createProps({ onGetToken })), container);
    await Promise.resolve();

    container
      .querySelector<HTMLButtonElement>(".oui-overview__actions .btn.primary")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(onGetToken).toHaveBeenCalledTimes(1);
  });

  it("renders the daily token usage chart from usage data", async () => {
    const onUsageDailyChartModeChange = vi.fn();
    const onUsageRefresh = vi.fn();
    const usageTotals = {
      input: 1000,
      output: 83,
      cacheRead: 10200,
      cacheWrite: 10900,
      totalTokens: 22183,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    };
    const container = document.createElement("div");

    render(
      renderOuiOverview(
        createProps({
          connected: true,
          usageDaily: [{ date: "2026-05-09", ...usageTotals }],
          usageTotals,
          onUsageRefresh,
          onUsageDailyChartModeChange,
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".oui-overview__usage-card")).not.toBeNull();
    expect(container.querySelector(".daily-bar--stacked")).not.toBeNull();
    expect(container.textContent).toContain("Daily Token Usage");
    expect(container.textContent).toContain("22.2K");

    container.querySelector<HTMLButtonElement>(".daily-chart-header .toggle-btn")?.click();
    expect(onUsageDailyChartModeChange).toHaveBeenCalledWith("total");

    container.querySelector<HTMLButtonElement>(".oui-overview__usage-refresh")?.click();
    expect(onUsageRefresh).toHaveBeenCalledTimes(1);
  });
});
