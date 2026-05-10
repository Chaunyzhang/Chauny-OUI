import { describe, expect, it } from "vitest";
import {
  buildQuickModelSetupPatch,
  getDefaultQuickModelPlanId,
  resolveQuickModelPlan,
} from "./model-plan-setup.ts";

describe("model plan setup", () => {
  it("builds a MiniMax CN API config patch", () => {
    const plan = resolveQuickModelPlan("minimax", "minimax-cn-api");

    const patch = buildQuickModelSetupPatch(plan, " sk-live ");

    expect(patch).toMatchObject({
      agents: { defaults: { model: { primary: "minimax/MiniMax-M2.7" } } },
      models: {
        mode: "merge",
        providers: {
          minimax: {
            baseUrl: "https://api.minimaxi.com/anthropic",
            apiKey: "sk-live",
            api: "anthropic-messages",
          },
        },
      },
    });
    expect(patch).not.toHaveProperty("env");
  });

  it("pins Qwen coding plan endpoint and model catalog", () => {
    const plan = resolveQuickModelPlan("qwen", "qwen-coding-cn");

    const patch = buildQuickModelSetupPatch(plan, "qwen-key");

    expect(patch).toMatchObject({
      agents: { defaults: { model: { primary: "qwen/qwen3.5-plus" } } },
      models: {
        providers: {
          qwen: {
            baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
            apiKey: "qwen-key",
            api: "openai-completions",
          },
        },
      },
    });
    expect(
      (patch.models as { providers: { qwen: { models: unknown[] } } }).providers.qwen.models.length,
    ).toBeGreaterThan(1);
  });

  it("uses the first vendor plan as the default plan", () => {
    expect(getDefaultQuickModelPlanId("stepfun")).toBe("stepfun-standard-cn");
  });

  it("stores env-only providers in env vars when no explicit provider patch is needed", () => {
    const plan = resolveQuickModelPlan("deepseek", "deepseek-api");

    const patch = buildQuickModelSetupPatch(plan, "deep-key");

    expect(patch).toMatchObject({
      env: { vars: { DEEPSEEK_API_KEY: "deep-key" } },
      agents: { defaults: { model: { primary: "deepseek/deepseek-v4-flash" } } },
    });
    expect(patch).not.toHaveProperty("models");
  });
});
