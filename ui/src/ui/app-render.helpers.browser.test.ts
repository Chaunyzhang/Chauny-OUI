import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { i18n, t } from "../i18n/index.ts";
import {
  renderChatControls,
  renderChatMobileToggle,
  renderOuiMainChatWindowHeader,
  renderOuiChatSessionSelect,
} from "./app-render.helpers.ts";
import type { AppViewState } from "./app-view-state.ts";
import type { OuiSelectElement } from "./components/oui-select.ts";
import type { SessionsListResult } from "./types.ts";
import { renderParallelChat } from "./views/parallel-chat.ts";

type SessionRow = SessionsListResult["sessions"][number];

function row(overrides: Partial<SessionRow> & { key: string }): SessionRow {
  return { kind: "direct", updatedAt: 0, ...overrides };
}

function createState(overrides: Partial<AppViewState> = {}) {
  return {
    connected: true,
    chatLoading: false,
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    onboarding: false,
    sessionKey: "main",
    sessionsHideCron: true,
    sessionsResult: {
      ts: 0,
      path: "",
      count: 0,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [],
    },
    settings: {
      gatewayUrl: "",
      token: "",
      locale: "en",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "dark",
      splitRatio: 0.6,
      navWidth: 280,
      navCollapsed: false,
      navGroupsCollapsed: {},
      borderRadius: 50,
      chatFocusMode: false,
      chatShowThinking: false,
      chatShowToolCalls: true,
    },
    applySettings: () => undefined,
    chatMobileControlsOpen: false,
    setChatMobileControlsOpen: () => undefined,
    chatModelCatalog: [],
    chatModelOverrides: {},
    chatModelsLoading: false,
    configDraftBaseHash: "hash-1",
    configForm: null,
    configFormDirty: false,
    configFormMode: "form",
    configFormOriginal: null,
    configLoading: false,
    configRaw: "{}",
    configRawOriginal: "{}",
    configSaving: false,
    configSchema: null,
    configSnapshot: {
      hash: "hash-1",
      config: {
        plugins: {
          entries: {
            oms: {
              enabled: true,
              config: {
                mode: "medium",
              },
            },
          },
          slots: {
            memory: "oms",
          },
        },
      },
    },
    client: { request: vi.fn() },
    ...overrides,
  } as unknown as AppViewState;
}

async function flushTasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function renderRefreshButton(overrides: Partial<AppViewState> = {}) {
  const container = document.createElement("div");
  render(renderChatControls(createState(overrides)), container);

  const button = container.querySelector<HTMLButtonElement>(
    `.chat-controls .btn--icon[data-tooltip="${t("chat.refreshTitle")}"]`,
  );
  expect(button).not.toBeNull();
  return button!;
}

describe("chat header controls (browser)", () => {
  it("renders explicit hover tooltip metadata for the top-right action buttons", async () => {
    const container = document.createElement("div");
    render(renderChatControls(createState()), container);
    await Promise.resolve();

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".chat-controls .btn--icon[data-tooltip]"),
    );

    expect(buttons).toHaveLength(5);

    const labels = buttons.map((button) => button.getAttribute("data-tooltip"));
    expect(labels).toEqual([
      t("chat.refreshTitle"),
      t("chat.thinkingToggle"),
      t("chat.toolCallsToggle"),
      t("chat.focusToggle"),
      t("chat.showCronSessions"),
    ]);

    for (const button of buttons) {
      expect(button.getAttribute("title")).toBe(button.getAttribute("data-tooltip"));
      expect(button.getAttribute("aria-label")).toBe(button.getAttribute("data-tooltip"));
    }
  });

  it.each([
    ["connected and idle", {}, false],
    ["chat history loading", { chatLoading: true }, true],
    ["chat send in flight", { chatSending: true }, true],
    ["active run", { chatRunId: "run-123" }, true],
    ["active stream", { chatStream: "streaming" }, true],
    ["disconnected", { connected: false }, true],
  ] as const)("sets refresh disabled state while %s", (_name, overrides, disabled) => {
    const button = renderRefreshButton(overrides);

    expect(button.disabled).toBe(disabled);
  });

  it("renders OUI chat action buttons as grid, focus, refresh", async () => {
    const container = document.createElement("div");
    render(
      renderChatControls(
        createState({
          tab: "ouiChat",
          setChatParallelMode: vi.fn(),
        }),
      ),
      container,
    );
    await Promise.resolve();

    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>(".chat-controls .btn--icon[data-tooltip]"),
    );

    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.getAttribute("data-tooltip"))).toEqual([
      "Four-pane view",
      "Focus mode",
      t("chat.refreshTitle"),
    ]);
  });

  it("hides the top settings button while OUI four-pane chat is active", async () => {
    const container = document.createElement("div");
    render(
      renderChatControls(
        createState({
          tab: "ouiChat",
          chatParallelMode: true,
          chatParallelPanes: [],
          setChatParallelMode: vi.fn(),
          refreshParallelChatPanes: vi.fn(),
        }),
      ),
      container,
    );
    await Promise.resolve();

    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>(".chat-controls .btn--icon[data-tooltip]"),
    );

    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.getAttribute("data-tooltip"))).toEqual([
      "Single view",
      "Focus mode",
      t("chat.refreshTitle"),
    ]);
  });

  it("renders the cron session filter in the mobile dropdown controls", async () => {
    const state = createState({
      sessionKey: "agent:alpha:main",
      agentsList: {
        defaultId: "alpha",
        mainKey: "agent:alpha:main",
        scope: "all",
        agents: [
          { id: "alpha", name: "Alpha" },
          { id: "beta", name: "Beta" },
        ],
      },
      sessionsResult: {
        ts: 0,
        path: "",
        count: 3,
        defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
        sessions: [
          row({ key: "agent:alpha:main" }),
          row({ key: "agent:alpha:cron:daily-briefing" }),
          row({ key: "agent:beta:cron:nightly-check" }),
        ],
      },
    });
    const container = document.createElement("div");
    render(renderChatMobileToggle(state), container);
    await Promise.resolve();

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".chat-controls__thinking .btn--icon"),
    );

    expect(buttons).toHaveLength(4);
    const cronButton = buttons.at(-1);
    expect(cronButton?.classList.contains("active")).toBe(true);
    expect(cronButton?.getAttribute("aria-pressed")).toBe("true");
    expect(cronButton?.getAttribute("title")).toBe(
      t("chat.showCronSessionsHidden", { count: "1" }),
    );

    cronButton?.click();

    expect(state.sessionsHideCron).toBe(false);
  });

  it("uses the shared chat session controls in the mobile dropdown", async () => {
    const state = createState({
      sessionKey: "agent:alpha:main",
      chatMobileControlsOpen: true,
      agentsList: {
        defaultId: "alpha",
        mainKey: "agent:alpha:main",
        scope: "all",
        agents: [
          { id: "alpha", name: "Alpha" },
          { id: "beta", name: "Beta" },
        ],
      },
      sessionsResult: {
        ts: 0,
        path: "",
        count: 2,
        defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
        sessions: [
          row({ key: "agent:alpha:main" }),
          row({ key: "agent:beta:dashboard:recent", label: "Beta recent" }),
        ],
      },
    });
    const container = document.createElement("div");
    render(renderChatMobileToggle(state), container);
    await Promise.resolve();

    const sessionRows = container.querySelectorAll(".chat-controls__session-row");
    expect(sessionRows).toHaveLength(1);
    expect(container.querySelector('select[data-chat-agent-filter="true"]')).not.toBeNull();
    expect(container.querySelector('select[data-chat-session-select="true"]')).not.toBeNull();
    expect(container.querySelector('select[data-chat-model-select="true"]')).not.toBeNull();
    expect(container.querySelector('select[data-chat-thinking-select="true"]')).not.toBeNull();
  });

  it("renders the OUI chat header as five labeled custom selects", async () => {
    const state = createState({
      tab: "ouiChat",
      sessionKey: "agent:alpha:main",
      agentsList: {
        defaultId: "alpha",
        mainKey: "agent:alpha:main",
        scope: "all",
        agents: [
          { id: "alpha", name: "Alpha" },
          { id: "beta", name: "Beta" },
        ],
      },
      sessionsResult: {
        ts: 0,
        path: "",
        count: 2,
        defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
        sessions: [
          row({ key: "agent:alpha:main" }),
          row({ key: "agent:beta:dashboard:recent", label: "Beta recent" }),
        ],
      },
    });
    const container = document.createElement("div");
    render(renderOuiChatSessionSelect(state), container);
    await Promise.resolve();

    const controls = Array.from(container.querySelectorAll<OuiSelectElement>("oui-select"));
    expect(controls).toHaveLength(5);
    expect(controls.map((control) => control.getAttribute("data-chat-control"))).toEqual([
      "agent",
      "session",
      "model",
      "thinking",
      "oms",
    ]);
    expect(
      Array.from(container.querySelectorAll(".oui-chat-control__title")).map((node) =>
        node.textContent?.trim(),
      ),
    ).toEqual(["Agent", "Session", "Model", "Thinking", "OMS"]);
    expect(
      container.querySelector<OuiSelectElement>('oui-select[data-chat-control="oms"]')?.value,
    ).toBe("medium");
  });

  it("renders the OUI chat window header with identity, thinking, OMS, and settings", async () => {
    const state = createState({
      tab: "ouiChat",
      sessionKey: "agent:alpha:main",
      assistantName: "Assistant",
      assistantAvatar: null,
      chatAvatarUrl: null,
      agentsList: {
        defaultId: "alpha",
        mainKey: "agent:alpha:main",
        scope: "all",
        agents: [
          { id: "alpha", name: "Alpha" },
          { id: "beta", name: "Beta" },
        ],
      },
    });
    const container = document.createElement("div");
    render(renderOuiMainChatWindowHeader(state), container);
    await Promise.resolve();

    const controls = Array.from(
      container.querySelectorAll<OuiSelectElement>("oui-select[data-chat-window-control]"),
    );
    expect(container.querySelector(".oui-chat-window-header__avatar")).not.toBeNull();
    expect(container.querySelector(".oui-chat-window-header__name")?.textContent?.trim()).toBe(
      "Alpha",
    );
    expect(controls.map((control) => control.getAttribute("data-chat-window-control"))).toEqual([
      "thinking",
      "oms",
    ]);
    expect(container.querySelector(".oui-chat-settings")).not.toBeNull();
  });

  it("renders OUI four-pane chat with per-pane agent, thinking, and settings controls", async () => {
    const state = createState({
      tab: "ouiChat",
      chatParallelPanes: [],
      agentsList: {
        defaultId: "alpha",
        mainKey: "agent:alpha:main",
        scope: "all",
        agents: [
          { id: "alpha", name: "Alpha" },
          { id: "beta", name: "Beta" },
        ],
      },
      requestUpdate: vi.fn(),
    });
    const container = document.createElement("div");
    render(renderParallelChat(state), container);
    await Promise.resolve();

    expect(container.querySelectorAll(".parallel-chat__pane")).toHaveLength(4);
    expect(container.querySelectorAll(".oui-chat-window-header")).toHaveLength(4);
    expect(container.querySelectorAll(".oui-chat-window-header__avatar")).toHaveLength(4);
    expect(
      container.querySelectorAll(
        '.oui-chat-window-header__controls oui-select[data-chat-window-control="thinking"]',
      ),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(
        '.oui-chat-window-header__controls oui-select[data-chat-window-control="oms"]',
      ),
    ).toHaveLength(4);
    expect(container.querySelectorAll(".parallel-chat__pane .oui-chat-settings")).toHaveLength(4);
    expect(
      container.querySelectorAll(
        ".parallel-chat__pane .oui-chat-settings oui-select[data-chat-window-control]",
      ),
    ).toHaveLength(16);
    expect(
      Array.from(
        container.querySelectorAll(
          ".parallel-chat__pane:first-of-type .oui-chat-settings .oui-chat-control__title",
        ),
      ).map((node) => node.textContent?.trim()),
    ).toEqual(["Agent", "Session", "Model", "OMS"]);
    expect(
      Array.from(
        container.querySelectorAll(
          ".parallel-chat__pane:first-of-type .oui-chat-settings__toggle span:first-child",
        ),
      )
        .map((node) => node.textContent?.trim())
        .slice(0, 3),
    ).toEqual(["Show thinking", "Show tools", "Hide cron sessions"]);
    expect(
      container.querySelectorAll(
        '.parallel-chat__pane .oui-chat-settings oui-select[data-chat-window-control="agent"]',
      ),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(
        '.parallel-chat__pane .oui-chat-settings oui-select[data-chat-window-control="session"]',
      ),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(
        '.parallel-chat__pane .oui-chat-settings oui-select[data-chat-window-control="model"]',
      ),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(
        '.parallel-chat__pane .oui-chat-settings oui-select[data-chat-window-control="oms"]',
      ),
    ).toHaveLength(4);
  });

  it("localizes OUI chat secondary labels without translating main labels", async () => {
    await i18n.setLocale("zh-CN");
    try {
      const state = createState({
        tab: "ouiChat",
        sessionKey: "agent:alpha:main",
        agentsList: {
          defaultId: "alpha",
          mainKey: "agent:alpha:main",
          scope: "all",
          agents: [{ id: "alpha", name: "Alpha" }],
        },
      });
      const container = document.createElement("div");
      render(renderOuiChatSessionSelect(state), container);
      await Promise.resolve();

      expect(
        Array.from(container.querySelectorAll(".oui-chat-control__title")).map((node) =>
          node.textContent?.trim(),
        ),
      ).toEqual(["Agent", "Session", "Model", "Thinking", "OMS"]);
      expect(
        Array.from(container.querySelectorAll(".oui-chat-control__detail")).map((node) =>
          node.textContent?.trim(),
        ),
      ).toEqual(["助手身份", "当前话题", "回答引擎", "推理深度", "记忆检索"]);
    } finally {
      await i18n.setLocale("en");
    }
  });

  it("saves OUI OMS retrieval strength to the plugin config", async () => {
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "config.set") {
        return { ok: true };
      }
      if (method === "config.get") {
        return {
          hash: "hash-2",
          config: {
            plugins: {
              entries: {
                oms: {
                  enabled: true,
                  config: {
                    mode: "high",
                  },
                },
              },
              slots: {
                memory: "oms",
              },
            },
          },
          valid: true,
          issues: [],
        };
      }
      return {};
    });
    const state = createState({
      tab: "ouiChat",
      client: { request } as never,
    });
    const container = document.createElement("div");
    render(renderOuiChatSessionSelect(state), container);
    await Promise.resolve();

    const omsSelect = container.querySelector<OuiSelectElement>(
      'oui-select[data-chat-control="oms"]',
    );
    expect(omsSelect).not.toBeNull();
    omsSelect!.value = "high";
    omsSelect!.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await flushTasks();

    const setCall = request.mock.calls.find(([method]) => method === "config.set");
    expect(setCall).toBeDefined();
    const payload = setCall?.[1] as { raw: string; baseHash: string };
    expect(payload.baseHash).toBe("hash-1");
    expect(JSON.parse(payload.raw).plugins.entries.oms.config.mode).toBe("high");
  });

  it("renders the mobile dropdown from state instead of mutating DOM classes", async () => {
    const setChatMobileControlsOpen = vi.fn();
    const state = createState({
      chatMobileControlsOpen: false,
      setChatMobileControlsOpen,
    });
    const container = document.createElement("div");
    render(renderChatMobileToggle(state), container);
    await Promise.resolve();

    const toggle = container.querySelector<HTMLButtonElement>(".chat-controls-mobile-toggle");
    const dropdown = container.querySelector<HTMLElement>(".chat-controls-dropdown");
    expect(toggle).not.toBeNull();
    expect(dropdown).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.getAttribute("aria-controls")).toBe("chat-mobile-controls-dropdown");
    expect(dropdown?.id).toBe("chat-mobile-controls-dropdown");
    expect(dropdown?.classList.contains("open")).toBe(false);

    toggle?.click();

    expect(setChatMobileControlsOpen).toHaveBeenCalledWith(true, { trigger: toggle });
    expect(dropdown?.classList.contains("open")).toBe(false);

    render(
      renderChatMobileToggle(
        createState({
          chatMobileControlsOpen: true,
          setChatMobileControlsOpen,
        }),
      ),
      container,
    );
    await Promise.resolve();

    const openToggle = container.querySelector<HTMLButtonElement>(".chat-controls-mobile-toggle");
    const openDropdown = container.querySelector<HTMLElement>(".chat-controls-dropdown");
    expect(openToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(openDropdown?.classList.contains("open")).toBe(true);
  });
});
