export type QuickModelPlanKind = "api" | "coding-plan" | "token-plan" | "auto";

export type QuickModelDefinition = {
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image" | "video" | "audio">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

export type QuickModelPlan = {
  id: string;
  label: string;
  labelZh: string;
  kind: QuickModelPlanKind;
  kindLabel: string;
  kindLabelZh: string;
  regionLabel: string;
  regionLabelZh: string;
  description: string;
  descriptionZh: string;
  providerId: string;
  envVar: string;
  authChoice?: string;
  baseUrl?: string;
  api?: string;
  defaultModelId: string;
  models?: QuickModelDefinition[];
  notes?: string[];
  notesZh?: string[];
};

export type QuickModelVendor = {
  id: string;
  label: string;
  description: string;
  descriptionZh: string;
  plans: QuickModelPlan[];
};

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const minimaxModels: QuickModelDefinition[] = [
  {
    id: "MiniMax-M2.7",
    name: "MiniMax M2.7",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
    contextWindow: 204800,
    maxTokens: 131072,
  },
  {
    id: "MiniMax-M2.7-highspeed",
    name: "MiniMax M2.7 Highspeed",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.6, output: 2.4, cacheRead: 0.06, cacheWrite: 0.375 },
    contextWindow: 204800,
    maxTokens: 131072,
  },
];

const qwenStandardModels: QuickModelDefinition[] = [
  {
    id: "qwen3.6-plus",
    name: "Qwen 3.6 Plus",
    reasoning: true,
    input: ["text", "image"],
    cost: zeroCost,
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    id: "qwen3.5-plus",
    name: "Qwen 3.5 Plus",
    reasoning: true,
    input: ["text", "image"],
    cost: zeroCost,
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    id: "qwen3-coder-plus",
    name: "Qwen 3 Coder Plus",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 1000000,
    maxTokens: 65536,
  },
];

const qwenCodingModels: QuickModelDefinition[] = [
  {
    id: "qwen3.5-plus",
    name: "Qwen 3.5 Plus",
    reasoning: true,
    input: ["text", "image"],
    cost: zeroCost,
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    id: "qwen3-coder-plus",
    name: "Qwen 3 Coder Plus",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    id: "qwen3-coder-next",
    name: "Qwen 3 Coder Next",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 262144,
    maxTokens: 65536,
  },
];

const stepfunStandardModels: QuickModelDefinition[] = [
  {
    id: "step-3.5-flash",
    name: "Step 3.5 Flash",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 262144,
    maxTokens: 65536,
  },
];

const stepfunPlanModels: QuickModelDefinition[] = [
  ...stepfunStandardModels,
  {
    id: "step-3.5-flash-2603",
    name: "Step 3.5 Flash 2603",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 262144,
    maxTokens: 65536,
  },
];

const moonshotModels: QuickModelDefinition[] = [
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    reasoning: false,
    input: ["text", "image"],
    cost: zeroCost,
    contextWindow: 262144,
    maxTokens: 262144,
  },
  {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    reasoning: false,
    input: ["text", "image"],
    cost: zeroCost,
    contextWindow: 262144,
    maxTokens: 262144,
  },
  {
    id: "kimi-k2-thinking",
    name: "Kimi K2 Thinking",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 262144,
    maxTokens: 262144,
  },
];

export const QUICK_MODEL_VENDORS: QuickModelVendor[] = [
  {
    id: "minimax",
    label: "MiniMax",
    description: "MiniMax M2.7 with China or global endpoints.",
    descriptionZh: "MiniMax M2.7，可选国内或海外 endpoint。",
    plans: [
      {
        id: "minimax-cn-api",
        label: "API key · China",
        labelZh: "API Key · 国内",
        kind: "api",
        kindLabel: "API key",
        kindLabelZh: "API Key",
        regionLabel: "China",
        regionLabelZh: "国内",
        description: "Hosted MiniMax API through api.minimaxi.com.",
        descriptionZh: "使用 api.minimaxi.com 的 MiniMax API。",
        providerId: "minimax",
        envVar: "MINIMAX_API_KEY",
        authChoice: "minimax-cn-api",
        baseUrl: "https://api.minimaxi.com/anthropic",
        api: "anthropic-messages",
        defaultModelId: "MiniMax-M2.7",
        models: minimaxModels,
      },
      {
        id: "minimax-global-api",
        label: "API key · Global",
        labelZh: "API Key · 海外",
        kind: "api",
        kindLabel: "API key",
        kindLabelZh: "API Key",
        regionLabel: "Global",
        regionLabelZh: "海外",
        description: "Hosted MiniMax API through api.minimax.io.",
        descriptionZh: "使用 api.minimax.io 的 MiniMax API。",
        providerId: "minimax",
        envVar: "MINIMAX_API_KEY",
        authChoice: "minimax-global-api",
        baseUrl: "https://api.minimax.io/anthropic",
        api: "anthropic-messages",
        defaultModelId: "MiniMax-M2.7",
        models: minimaxModels,
      },
      {
        id: "minimax-cn-token-plan",
        label: "Token Plan key · China",
        labelZh: "Token Plan Key · 国内",
        kind: "token-plan",
        kindLabel: "Token Plan key",
        kindLabelZh: "Token Plan Key",
        regionLabel: "China",
        regionLabelZh: "国内",
        description: "MiniMax Coding/Token Plan key routed through api.minimaxi.com.",
        descriptionZh: "MiniMax Coding/Token Plan key，走 api.minimaxi.com。",
        providerId: "minimax",
        envVar: "MINIMAX_CODE_PLAN_KEY",
        baseUrl: "https://api.minimaxi.com/anthropic",
        api: "anthropic-messages",
        defaultModelId: "MiniMax-M2.7",
        models: minimaxModels,
        notes: ["OAuth Coding Plan login is still available in advanced onboard."],
        notesZh: ["如果是 OAuth 订阅登录，仍可在高级 onboard 里走浏览器授权。"],
      },
      {
        id: "minimax-global-token-plan",
        label: "Token Plan key · Global",
        labelZh: "Token Plan Key · 海外",
        kind: "token-plan",
        kindLabel: "Token Plan key",
        kindLabelZh: "Token Plan Key",
        regionLabel: "Global",
        regionLabelZh: "海外",
        description: "MiniMax Coding/Token Plan key routed through api.minimax.io.",
        descriptionZh: "MiniMax Coding/Token Plan key，走 api.minimax.io。",
        providerId: "minimax",
        envVar: "MINIMAX_CODE_PLAN_KEY",
        baseUrl: "https://api.minimax.io/anthropic",
        api: "anthropic-messages",
        defaultModelId: "MiniMax-M2.7",
        models: minimaxModels,
        notes: ["OAuth Coding Plan login is still available in advanced onboard."],
        notesZh: ["如果是 OAuth 订阅登录，仍可在高级 onboard 里走浏览器授权。"],
      },
    ],
  },
  {
    id: "qwen",
    label: "Qwen",
    description: "Qwen Cloud / DashScope, standard or coding plan endpoints.",
    descriptionZh: "通义千问/Qwen Cloud，可选标准 API 或 Coding Plan。",
    plans: [
      {
        id: "qwen-standard-cn",
        label: "Standard API · China",
        labelZh: "标准 API · 国内",
        kind: "api",
        kindLabel: "Standard API",
        kindLabelZh: "标准 API",
        regionLabel: "China",
        regionLabelZh: "国内",
        description: "Pay-as-you-go DashScope endpoint.",
        descriptionZh: "按量付费 DashScope endpoint。",
        providerId: "qwen",
        envVar: "QWEN_API_KEY",
        authChoice: "qwen-standard-api-key-cn",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        api: "openai-completions",
        defaultModelId: "qwen3.6-plus",
        models: qwenStandardModels,
      },
      {
        id: "qwen-standard-global",
        label: "Standard API · Global",
        labelZh: "标准 API · 海外",
        kind: "api",
        kindLabel: "Standard API",
        kindLabelZh: "标准 API",
        regionLabel: "Global",
        regionLabelZh: "海外",
        description: "International pay-as-you-go DashScope endpoint.",
        descriptionZh: "海外按量付费 DashScope endpoint。",
        providerId: "qwen",
        envVar: "QWEN_API_KEY",
        authChoice: "qwen-standard-api-key",
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        api: "openai-completions",
        defaultModelId: "qwen3.6-plus",
        models: qwenStandardModels,
      },
      {
        id: "qwen-coding-cn",
        label: "Coding Plan · China",
        labelZh: "Coding Plan · 国内",
        kind: "coding-plan",
        kindLabel: "Coding Plan",
        kindLabelZh: "Coding Plan",
        regionLabel: "China",
        regionLabelZh: "国内",
        description: "Subscription-based Qwen Coding Plan endpoint.",
        descriptionZh: "订阅制 Qwen Coding Plan endpoint。",
        providerId: "qwen",
        envVar: "QWEN_API_KEY",
        authChoice: "qwen-api-key-cn",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        api: "openai-completions",
        defaultModelId: "qwen3.5-plus",
        models: qwenCodingModels,
      },
      {
        id: "qwen-coding-global",
        label: "Coding Plan · Global",
        labelZh: "Coding Plan · 海外",
        kind: "coding-plan",
        kindLabel: "Coding Plan",
        kindLabelZh: "Coding Plan",
        regionLabel: "Global",
        regionLabelZh: "海外",
        description: "International Qwen Coding Plan endpoint.",
        descriptionZh: "海外 Qwen Coding Plan endpoint。",
        providerId: "qwen",
        envVar: "QWEN_API_KEY",
        authChoice: "qwen-api-key",
        baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
        api: "openai-completions",
        defaultModelId: "qwen3.5-plus",
        models: qwenCodingModels,
      },
    ],
  },
  {
    id: "stepfun",
    label: "StepFun",
    description: "StepFun standard and Step Plan endpoints.",
    descriptionZh: "阶跃星辰标准 API 与 Step Plan。",
    plans: [
      {
        id: "stepfun-standard-cn",
        label: "Standard API · China",
        labelZh: "标准 API · 国内",
        kind: "api",
        kindLabel: "Standard API",
        kindLabelZh: "标准 API",
        regionLabel: "China",
        regionLabelZh: "国内",
        description: "Standard StepFun endpoint.",
        descriptionZh: "标准 StepFun endpoint。",
        providerId: "stepfun",
        envVar: "STEPFUN_API_KEY",
        authChoice: "stepfun-standard-api-key-cn",
        baseUrl: "https://api.stepfun.com/v1",
        api: "openai-completions",
        defaultModelId: "step-3.5-flash",
        models: stepfunStandardModels,
      },
      {
        id: "stepfun-standard-global",
        label: "Standard API · Global",
        labelZh: "标准 API · 海外",
        kind: "api",
        kindLabel: "Standard API",
        kindLabelZh: "标准 API",
        regionLabel: "Global",
        regionLabelZh: "海外",
        description: "International StepFun endpoint.",
        descriptionZh: "海外 StepFun endpoint。",
        providerId: "stepfun",
        envVar: "STEPFUN_API_KEY",
        authChoice: "stepfun-standard-api-key-intl",
        baseUrl: "https://api.stepfun.ai/v1",
        api: "openai-completions",
        defaultModelId: "step-3.5-flash",
        models: stepfunStandardModels,
      },
      {
        id: "stepfun-plan-cn",
        label: "Step Plan · China",
        labelZh: "Step Plan · 国内",
        kind: "token-plan",
        kindLabel: "Step Plan",
        kindLabelZh: "Step Plan",
        regionLabel: "China",
        regionLabelZh: "国内",
        description: "Step Plan endpoint for China keys.",
        descriptionZh: "国内 Step Plan endpoint。",
        providerId: "stepfun-plan",
        envVar: "STEPFUN_API_KEY",
        authChoice: "stepfun-plan-api-key-cn",
        baseUrl: "https://api.stepfun.com/step_plan/v1",
        api: "openai-completions",
        defaultModelId: "step-3.5-flash",
        models: stepfunPlanModels,
      },
      {
        id: "stepfun-plan-global",
        label: "Step Plan · Global",
        labelZh: "Step Plan · 海外",
        kind: "token-plan",
        kindLabel: "Step Plan",
        kindLabelZh: "Step Plan",
        regionLabel: "Global",
        regionLabelZh: "海外",
        description: "International Step Plan endpoint.",
        descriptionZh: "海外 Step Plan endpoint。",
        providerId: "stepfun-plan",
        envVar: "STEPFUN_API_KEY",
        authChoice: "stepfun-plan-api-key-intl",
        baseUrl: "https://api.stepfun.ai/step_plan/v1",
        api: "openai-completions",
        defaultModelId: "step-3.5-flash",
        models: stepfunPlanModels,
      },
    ],
  },
  {
    id: "moonshot",
    label: "Moonshot",
    description: "Moonshot Kimi K2.6 in China or global regions.",
    descriptionZh: "月之暗面 Kimi K2.6，可选国内或海外。",
    plans: [
      {
        id: "moonshot-cn",
        label: "API key · China",
        labelZh: "API Key · 国内",
        kind: "api",
        kindLabel: "API key",
        kindLabelZh: "API Key",
        regionLabel: "China",
        regionLabelZh: "国内",
        description: "Moonshot Open Platform CN endpoint.",
        descriptionZh: "Moonshot 国内开放平台 endpoint。",
        providerId: "moonshot",
        envVar: "MOONSHOT_API_KEY",
        authChoice: "moonshot-api-key-cn",
        baseUrl: "https://api.moonshot.cn/v1",
        api: "openai-completions",
        defaultModelId: "kimi-k2.6",
        models: moonshotModels,
      },
      {
        id: "moonshot-global",
        label: "API key · Global",
        labelZh: "API Key · 海外",
        kind: "api",
        kindLabel: "API key",
        kindLabelZh: "API Key",
        regionLabel: "Global",
        regionLabelZh: "海外",
        description: "Moonshot Open Platform global endpoint.",
        descriptionZh: "Moonshot 海外开放平台 endpoint。",
        providerId: "moonshot",
        envVar: "MOONSHOT_API_KEY",
        authChoice: "moonshot-api-key",
        baseUrl: "https://api.moonshot.ai/v1",
        api: "openai-completions",
        defaultModelId: "kimi-k2.6",
        models: moonshotModels,
      },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek API key with the bundled provider catalog.",
    descriptionZh: "DeepSeek API Key，使用内置模型目录。",
    plans: [
      {
        id: "deepseek-api",
        label: "API key",
        labelZh: "API Key",
        kind: "api",
        kindLabel: "API key",
        kindLabelZh: "API Key",
        regionLabel: "Auto",
        regionLabelZh: "自动",
        description: "Sets DEEPSEEK_API_KEY and default model.",
        descriptionZh: "写入 DEEPSEEK_API_KEY，并设为默认模型。",
        providerId: "deepseek",
        envVar: "DEEPSEEK_API_KEY",
        authChoice: "deepseek-api-key",
        defaultModelId: "deepseek-v4-flash",
      },
    ],
  },
  {
    id: "zai",
    label: "Z.AI / GLM",
    description: "GLM models with Z.AI endpoint auto-detection.",
    descriptionZh: "GLM 模型，Z.AI key 自动识别 endpoint。",
    plans: [
      {
        id: "zai-api",
        label: "API key · Auto",
        labelZh: "API Key · 自动识别",
        kind: "auto",
        kindLabel: "Auto",
        kindLabelZh: "自动",
        regionLabel: "Auto",
        regionLabelZh: "自动",
        description: "Sets ZAI_API_KEY and default model.",
        descriptionZh: "写入 ZAI_API_KEY，并设为默认 GLM 模型。",
        providerId: "zai",
        envVar: "ZAI_API_KEY",
        authChoice: "zai-api-key",
        defaultModelId: "glm-5.1",
      },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Direct OpenAI API key billing.",
    descriptionZh: "OpenAI 平台 API Key 直连。",
    plans: [
      {
        id: "openai-api",
        label: "API key",
        labelZh: "API Key",
        kind: "api",
        kindLabel: "API key",
        kindLabelZh: "API Key",
        regionLabel: "Global",
        regionLabelZh: "海外",
        description: "Sets OPENAI_API_KEY and gpt-5.5 as default.",
        descriptionZh: "写入 OPENAI_API_KEY，并将 gpt-5.5 设为默认。",
        providerId: "openai",
        envVar: "OPENAI_API_KEY",
        defaultModelId: "gpt-5.5",
        notes: ["For ChatGPT/Codex OAuth subscription auth, use advanced onboard."],
        notesZh: ["如果要用 ChatGPT/Codex OAuth 订阅授权，请走高级 onboard。"],
      },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Direct Anthropic API key billing.",
    descriptionZh: "Anthropic API Key 直连。",
    plans: [
      {
        id: "anthropic-api",
        label: "API key",
        labelZh: "API Key",
        kind: "api",
        kindLabel: "API key",
        kindLabelZh: "API Key",
        regionLabel: "Global",
        regionLabelZh: "海外",
        description: "Sets ANTHROPIC_API_KEY and Claude Opus as default.",
        descriptionZh: "写入 ANTHROPIC_API_KEY，并将 Claude Opus 设为默认。",
        providerId: "anthropic",
        envVar: "ANTHROPIC_API_KEY",
        defaultModelId: "claude-opus-4-6",
      },
    ],
  },
];

export const DEFAULT_QUICK_MODEL_VENDOR_ID = QUICK_MODEL_VENDORS[0]?.id ?? "minimax";

export function findQuickModelVendor(vendorId: string): QuickModelVendor | null {
  return QUICK_MODEL_VENDORS.find((vendor) => vendor.id === vendorId) ?? null;
}

export function findQuickModelPlan(planId: string): QuickModelPlan | null {
  for (const vendor of QUICK_MODEL_VENDORS) {
    const plan = vendor.plans.find((entry) => entry.id === planId);
    if (plan) {
      return plan;
    }
  }
  return null;
}

export function getDefaultQuickModelPlanId(vendorId: string): string {
  return findQuickModelVendor(vendorId)?.plans[0]?.id ?? QUICK_MODEL_VENDORS[0]?.plans[0]?.id ?? "";
}

export function resolveQuickModelPlan(vendorId: string, planId: string): QuickModelPlan {
  const vendor = findQuickModelVendor(vendorId) ?? QUICK_MODEL_VENDORS[0];
  if (!vendor) {
    throw new Error("No quick model vendors are configured.");
  }
  return vendor.plans.find((plan) => plan.id === planId) ?? vendor.plans[0]!;
}

function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function buildQuickModelSetupPatch(
  plan: QuickModelPlan,
  apiKey: string,
): Record<string, unknown> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("API key is required.");
  }
  const modelRef = `${plan.providerId}/${plan.defaultModelId}`;
  const patch: Record<string, unknown> = {
    agents: {
      defaults: {
        model: { primary: modelRef },
      },
    },
  };
  if (plan.baseUrl && plan.api && plan.models) {
    patch.models = {
      mode: "merge",
      providers: {
        [plan.providerId]: withoutUndefined({
          baseUrl: plan.baseUrl,
          apiKey: trimmedKey,
          api: plan.api,
          models: plan.models,
        }),
      },
    };
  } else {
    patch.env = { vars: { [plan.envVar]: trimmedKey } };
  }
  return patch;
}
