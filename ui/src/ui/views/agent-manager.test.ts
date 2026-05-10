/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentsListResult, ModelCatalogEntry } from "../types.ts";
import { renderAgentManager, type AgentManagerProps } from "./agent-manager.ts";

function createProps(overrides: Partial<AgentManagerProps> = {}): AgentManagerProps {
  const catalog: ModelCatalogEntry[] = [
    {
      id: "gpt-5.5",
      name: "GPT-5.5",
      provider: "openai",
      reasoning: true,
      contextWindow: 256000,
      input: ["text"],
    },
    {
      id: "MiniMax-M2.7",
      name: "MiniMax M2.7",
      provider: "minimax",
      reasoning: true,
      contextWindow: 204800,
      input: ["text"],
    },
    {
      id: "MiniMax-M2.7",
      name: "MiniMax M2.7",
      provider: "minimax",
      reasoning: true,
      contextWindow: 204800,
      input: ["text"],
    },
    {
      id: "kimi-k2.6",
      name: "MoonshotAI: Kimi K2.6",
      provider: "moonshot",
      reasoning: true,
      contextWindow: 262144,
      input: ["text"],
    },
  ];
  const agentsList: AgentsListResult = {
    defaultId: "main",
    mainKey: "main",
    scope: "global",
    agents: [
      {
        id: "main",
        name: "OpenClaw",
        workspace: "C:/Users/demo/.openclaw/workspace",
        model: { primary: "minimax/MiniMax-M2.7" },
      },
      {
        id: "ops",
        name: "Ops",
        identity: { emoji: "O" },
        workspace: "C:/Users/demo/.openclaw/workspace-ops",
        model: { primary: "minimax/MiniMax-M2.7" },
      },
    ],
  };
  return {
    basePath: "",
    connected: true,
    agentsLoading: false,
    agentsError: null,
    agentsList,
    identityById: {},
    catalog,
    catalogLoading: false,
    config: {
      agents: { defaults: { model: { primary: "minimax/MiniMax-M2.7" } } },
      models: {
        providers: {
          minimax: {
            models: [
              { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
              { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed" },
            ],
          },
        },
      },
    },
    configLoading: false,
    setupAgentName: "",
    setupAgentWorkspace: "",
    setupAgentModel: "",
    setupAgentEmoji: "",
    setupAgentSaving: false,
    setupAgentMessage: null,
    onSetupAgentNameChange: vi.fn(),
    onSetupAgentWorkspaceChange: vi.fn(),
    onSetupAgentModelChange: vi.fn(),
    onSetupAgentEmojiChange: vi.fn(),
    onSetupAgentApply: vi.fn(),
    onRefresh: vi.fn(),
    onSetDefaultAgent: vi.fn(),
    onRemoveAgent: vi.fn(),
    ...overrides,
  };
}

async function flushOuiSelects(container: HTMLElement) {
  await customElements.whenDefined("oui-select");
  await Promise.all(
    Array.from(container.querySelectorAll("oui-select")).map((element) => {
      const updateComplete = (element as { updateComplete?: Promise<unknown> }).updateComplete;
      return updateComplete ?? Promise.resolve();
    }),
  );
}

function createContainer(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

describe("renderAgentManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("renders quick setup and configured agent cards", async () => {
    const container = createContainer();

    render(renderAgentManager(createProps()), container);
    await flushOuiSelects(container);

    const sections = Array.from(container.querySelector(".agent-manager")?.children ?? []).filter(
      (element) => element.tagName === "SECTION",
    );
    expect(sections.map((section) => section.className)).toEqual([
      "setup-quick agent-setup",
      "agent-manager__configured",
    ]);
    expect(container.querySelectorAll(".agent-card")).toHaveLength(2);
    expect(container.textContent).toContain("Agent setup");
    expect(container.textContent).toContain("Configured agents");
    expect(container.textContent).toContain("Current default");
    expect(container.textContent).toContain("MiniMax M2.7");
    const modelOptions = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".setup-field oui-select .oui-select__option"),
    ).map((button) => button.textContent?.trim());
    expect(modelOptions).toEqual(["Use default model", "MiniMax M2.7", "MiniMax M2.7 Highspeed"]);
    expect(modelOptions).not.toContain("MoonshotAI: Kimi K2.6");
    expect(container.querySelector("select")).toBeNull();
  });

  it("submits quick agent setup through callbacks", async () => {
    const onSetupAgentApply = vi.fn();
    const onSetupAgentNameChange = vi.fn();
    const onSetupAgentModelChange = vi.fn();
    const container = createContainer();

    render(
      renderAgentManager(
        createProps({
          setupAgentName: "ops",
          setupAgentWorkspace: "~/.openclaw/workspace-ops",
          onSetupAgentApply,
          onSetupAgentNameChange,
          onSetupAgentModelChange,
        }),
      ),
      container,
    );
    await flushOuiSelects(container);

    const nameInput = container.querySelector<HTMLInputElement>(".setup-field input");
    expect(nameInput).toBeTruthy();
    nameInput!.value = "work";
    nameInput!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(onSetupAgentNameChange).toHaveBeenCalledWith("work");

    const modelSelect = container.querySelector<HTMLElement & { value: string }>("oui-select");
    expect(modelSelect).toBeTruthy();
    modelSelect!.value = "minimax/MiniMax-M2.7";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetupAgentModelChange).toHaveBeenCalledWith("minimax/MiniMax-M2.7");

    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save agent"))
      ?.click();
    expect(onSetupAgentApply).toHaveBeenCalled();
  });

  it("sets the default agent and removes configured agents from card actions", async () => {
    const onSetDefaultAgent = vi.fn();
    const onRemoveAgent = vi.fn();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const container = createContainer();

    render(renderAgentManager(createProps({ onSetDefaultAgent, onRemoveAgent })), container);
    await flushOuiSelects(container);

    const opsCard = Array.from(container.querySelectorAll<HTMLElement>(".agent-card")).find(
      (card) => card.textContent?.includes("ops"),
    );
    expect(opsCard).toBeTruthy();

    Array.from(opsCard!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Set default"))
      ?.click();
    expect(onSetDefaultAgent).toHaveBeenCalledWith("ops");

    Array.from(opsCard!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Remove config"))
      ?.click();
    expect(onRemoveAgent).toHaveBeenCalledWith("ops");
  });
});
