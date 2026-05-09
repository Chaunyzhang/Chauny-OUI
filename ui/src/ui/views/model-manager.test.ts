/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelAuthStatusResult, ModelCatalogEntry } from "../types.ts";
import { renderModelManager, type ModelManagerProps } from "./model-manager.ts";

function createProps(overrides: Partial<ModelManagerProps> = {}): ModelManagerProps {
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
      id: "claude-sonnet-4.6",
      name: "Claude Sonnet 4.6",
      provider: "anthropic",
      reasoning: true,
      contextWindow: 200000,
      input: ["text"],
    },
  ];
  const authStatus: ModelAuthStatusResult = {
    ts: Date.now(),
    providers: [
      {
        provider: "openai-codex",
        displayName: "OpenAI Codex",
        status: "ok",
        profiles: [{ profileId: "default", type: "oauth", status: "ok" }],
      },
      {
        provider: "minimax",
        displayName: "MiniMax",
        status: "static",
        profiles: [{ profileId: "default", type: "api_key", status: "static" }],
        usage: { windows: [], plan: "Token Plan" },
      },
    ],
  };
  return {
    catalog,
    catalogLoading: false,
    authStatus,
    authLoading: false,
    authError: null,
    config: {
      agents: {
        defaults: {
          model: { primary: "minimax/MiniMax-M2.7" },
          agentRuntime: { id: "codex" },
        },
      },
      models: {
        mode: "merge",
        providers: {
          minimax: {
            baseUrl: "https://api.minimaxi.com/anthropic",
            apiKey: "${MINIMAX_CODE_PLAN_KEY}",
            api: "anthropic-messages",
            models: [
              { id: "MiniMax-M2.7", name: "MiniMax M2.7", reasoning: true },
              {
                id: "MiniMax-M2.7-highspeed",
                name: "MiniMax M2.7 Highspeed",
                reasoning: true,
              },
            ],
          },
          custom: {
            baseUrl: "https://api.example.com/v1",
            apiKey: "${CUSTOM_API_KEY}",
            api: "openai-completions",
            models: [{ id: "custom-chat", name: "Custom Chat", reasoning: false }],
          },
        },
      },
    },
    configLoading: false,
    configDirty: false,
    connected: true,
    basePath: "",
    configReady: true,
    setupModelProviderId: "minimax",
    setupModelPlanId: "minimax-cn-api",
    setupModelApiKey: "",
    setupModelSaving: false,
    setupModelMessage: null,
    onSetupModelProviderChange: vi.fn(),
    onSetupModelPlanChange: vi.fn(),
    onSetupModelApiKeyChange: vi.fn(),
    onSetupModelApply: vi.fn(),
    onRefresh: vi.fn(),
    onSetDefaultModel: vi.fn(),
    onRemoveProvider: vi.fn(),
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

describe("renderModelManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("renders only setup and configured model cards", async () => {
    const container = createContainer();

    render(renderModelManager(createProps()), container);
    await flushOuiSelects(container);

    const sections = Array.from(container.querySelector(".model-manager")?.children ?? []).filter(
      (element) => element.tagName === "SECTION",
    );
    expect(sections.map((section) => section.className)).toEqual([
      "setup-quick",
      "model-manager__configured",
    ]);
    expect(container.querySelector(".model-manager__summary")).toBeNull();
    expect(container.querySelector(".model-plan-group")).toBeNull();
    expect(container.querySelector(".model-manager__custom")).toBeNull();
    expect(container.querySelectorAll(".model-provider-card")).toHaveLength(3);
    expect(container.textContent).toContain("MiniMax M2.7");
    expect(container.textContent).toContain("Custom Chat");
    expect(container.textContent).not.toContain("Claude Sonnet 4.6");
    expect(container.textContent).toContain("Current default");
    expect(container.textContent).toContain("Token Plan");
    expect(container.textContent).not.toContain("anthropic-messages");
    expect(container.textContent).not.toContain("https://api.minimaxi.com/anthropic");
    expect(container.querySelector('img[src="/provider-logos/minimax.svg"]')).toBeTruthy();
  });

  it("submits quick setup and card default model changes through callbacks", async () => {
    const onSetupModelApply = vi.fn();
    const onSetupModelProviderChange = vi.fn();
    const onSetDefaultModel = vi.fn();
    const container = createContainer();

    render(
      renderModelManager(
        createProps({
          setupModelApiKey: "sk-test",
          onSetupModelApply,
          onSetupModelProviderChange,
          onSetDefaultModel,
        }),
      ),
      container,
    );
    await flushOuiSelects(container);

    const providerSelect = container.querySelector<HTMLElement & { value: string }>(
      ".setup-field oui-select",
    );
    expect(providerSelect).toBeTruthy();
    providerSelect!.value = "qwen";
    providerSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetupModelProviderChange).toHaveBeenCalledWith("qwen");

    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("default"))
      ?.click();
    expect(onSetupModelApply).toHaveBeenCalled();

    const openAiCard = Array.from(
      container.querySelectorAll<HTMLFormElement>(".model-provider-card"),
    ).find((card) => card.textContent?.includes("GPT-5.5"));
    expect(openAiCard).toBeTruthy();
    openAiCard?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    expect(onSetDefaultModel).toHaveBeenCalledWith("openai/gpt-5.5");
    expect(container.querySelector("select")).toBeNull();
  });

  it("removes configured providers from card actions", async () => {
    const onRemoveProvider = vi.fn();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const container = createContainer();

    render(renderModelManager(createProps({ onRemoveProvider })), container);
    await flushOuiSelects(container);

    const minimaxCard = Array.from(
      container.querySelectorAll<HTMLFormElement>(".model-provider-card"),
    ).find((card) => card.textContent?.includes("MiniMax"));
    expect(minimaxCard).toBeTruthy();
    Array.from(minimaxCard!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Remove"))
      ?.click();

    expect(onRemoveProvider).toHaveBeenCalledWith("minimax");
  });
});
