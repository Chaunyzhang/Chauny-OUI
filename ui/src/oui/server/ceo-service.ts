import type {
  OuiAgentRecord,
  OuiCompanyRecord,
  OuiConversationRecord,
  OuiCreateRunbookDraftResult,
  OuiInboxItemRecord,
  OuiMessageRecord,
  OuiProductStore,
  OuiRunbookKind,
  OuiRunbookVersionRecord,
} from "../shared/product-types.ts";
import type { OuiJsonObject } from "../shared/types.ts";

export type OuiCeoContextSnapshot = {
  company: Pick<OuiCompanyRecord, "id" | "name" | "status" | "currentObjective" | "currentStage">;
  ceo: Pick<OuiAgentRecord, "id" | "label" | "adapterKind" | "openclawAgentId"> | null;
  activeRunbookVersion: Pick<
    OuiRunbookVersionRecord,
    "id" | "objective" | "operatingMode" | "status"
  > | null;
  openInboxItems: Array<Pick<OuiInboxItemRecord, "id" | "itemType" | "title" | "summary">>;
  recentMessages: Array<Pick<OuiMessageRecord, "role" | "content" | "createdAt">>;
};

export type OuiCeoMessageResult = {
  conversation: OuiConversationRecord;
  messages: OuiMessageRecord[];
  userMessage: OuiMessageRecord;
  assistantMessage: OuiMessageRecord;
  context: OuiCeoContextSnapshot;
};

export type OuiGenerateRunbookDraftResult = {
  conversation: OuiConversationRecord;
  runbookDraft: OuiCreateRunbookDraftResult;
  assistantMessage: OuiMessageRecord;
};

function resolveCeo(company: OuiCompanyRecord, agents: OuiAgentRecord[]): OuiAgentRecord | null {
  return (
    agents.find((agent) => agent.id === company.ceoAgentId) ??
    agents.find((agent) => agent.id === company.defaultLeaderAgentId) ??
    agents.find((agent) => agent.isLeader) ??
    null
  );
}

function truncate(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}...` : trimmed;
}

function inferRunbookKind(text: string): OuiRunbookKind {
  const normalized = text.toLowerCase();
  const routineHints = [
    "daily",
    "weekly",
    "monthly",
    "recurring",
    "routine",
    "always",
    "monitor",
    "每",
    "每天",
    "每周",
    "定时",
    "周期",
    "持续",
    "监控",
    "常驻",
    "生产线",
  ];
  return routineHints.some((hint) => normalized.includes(hint)) ? "routine" : "project";
}

function buildProjectStages(objective: string): OuiJsonObject[] {
  return [
    {
      id: "understand",
      title: "目标确认",
      type: "work",
      order: 1,
      role: "CEO",
      summary: `确认目标边界：${truncate(objective, 80)}`,
    },
    {
      id: "plan",
      title: "方案设计",
      type: "work",
      order: 2,
      role: "产品/架构 agent",
      summary: "把目标拆成可执行阶段、风险和验收标准。",
    },
    {
      id: "execute",
      title: "执行推进",
      type: "work",
      order: 3,
      role: "worker agent",
      summary: "按阶段执行低风险工作，高风险动作进入收件箱。",
    },
    {
      id: "report",
      title: "阶段汇报",
      type: "report",
      order: 4,
      role: "CEO",
      summary: "用人话汇报结果、风险、下一步和需要用户处理的事项。",
    },
  ];
}

function buildRoutineStages(objective: string): OuiJsonObject[] {
  return [
    {
      id: "collect",
      title: "输入收集",
      type: "work",
      order: 1,
      role: "收集 agent",
      summary: `围绕长期目标收集输入：${truncate(objective, 80)}`,
    },
    {
      id: "curate",
      title: "整理候选",
      type: "work",
      order: 2,
      role: "整理 agent",
      summary: "把输入整理成可选择的候选项。",
    },
    {
      id: "owner_choice",
      title: "等待用户选择",
      type: "user_decision",
      order: 3,
      role: "CEO",
      summary: "需要用户判断的内容进入收件箱。",
    },
    {
      id: "produce",
      title: "生产输出",
      type: "work",
      order: 4,
      role: "worker agent",
      summary: "根据用户选择继续生产成果。",
    },
    {
      id: "archive",
      title: "验收归档",
      type: "report",
      order: 5,
      role: "CEO",
      summary: "汇报并把成果写入成果仓库。",
    },
  ];
}

function buildDecisionPoints(kind: OuiRunbookKind): OuiJsonObject[] {
  if (kind === "routine") {
    return [
      {
        id: "owner_choice",
        stageId: "owner_choice",
        type: "choice",
        prompt: "用户选择候选项后，公司继续生产输出。",
      },
    ];
  }
  return [
    {
      id: "stage_report_ack",
      stageId: "report",
      type: "report_ack",
      prompt: "阶段汇报需要用户确认后再进入下一轮。",
    },
  ];
}

function objectiveFromMessages(messages: OuiMessageRecord[], explicitObjective?: string | null) {
  if (explicitObjective?.trim()) {
    return explicitObjective.trim();
  }
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  return lastUser?.content.trim() || "确认公司下一阶段方向。";
}

function titleFromObjective(objective: string): string {
  return `运行文档：${truncate(objective, 32)}`;
}

function buildAssistantReply(input: {
  company: OuiCompanyRecord;
  ceo: OuiAgentRecord | null;
  openInboxCount: number;
  hasActiveRunbook: boolean;
}): string {
  const ceoLabel = input.ceo?.label ?? "CEO";
  const hints: string[] = [`${ceoLabel} 已把这条方向记录到 ${input.company.name} 的公司上下文里。`];
  if (!input.hasActiveRunbook) {
    hints.push("现在还没有确认过的运行文档，可以继续补充目标，也可以生成运行文档草稿。");
  } else {
    hints.push("公司已有运行文档，我会把这条补充作为后续调整依据。");
  }
  if (input.openInboxCount > 0) {
    hints.push(`当前还有 ${input.openInboxCount} 个收件箱事项，继续推进前建议先处理。`);
  }
  return hints.join("\n");
}

export class OuiCeoService {
  constructor(private readonly productStore: OuiProductStore) {}

  async buildContext(
    companyId: string,
    conversationId?: string | null,
  ): Promise<OuiCeoContextSnapshot> {
    const company = await this.productStore.getCompany(companyId);
    if (!company) {
      throw new Error(`OUI company not found: ${companyId}`);
    }
    const agents = await this.productStore.listAgents(companyId);
    const ceo = resolveCeo(company, agents);
    const activeRunbookVersion = company.currentRunbookVersionId
      ? await this.productStore.getRunbookVersion(company.currentRunbookVersionId)
      : null;
    const openInboxItems = await this.productStore.listInboxItems(companyId, "open");
    const recentMessages = conversationId
      ? await this.productStore.listConversationMessages(conversationId, 12)
      : [];
    return {
      company: {
        id: company.id,
        name: company.name,
        status: company.status,
        currentObjective: company.currentObjective,
        currentStage: company.currentStage,
      },
      ceo: ceo
        ? {
            id: ceo.id,
            label: ceo.label,
            adapterKind: ceo.adapterKind,
            openclawAgentId: ceo.openclawAgentId,
          }
        : null,
      activeRunbookVersion: activeRunbookVersion
        ? {
            id: activeRunbookVersion.id,
            objective: activeRunbookVersion.objective,
            operatingMode: activeRunbookVersion.operatingMode,
            status: activeRunbookVersion.status,
          }
        : null,
      openInboxItems: openInboxItems.map((item) => ({
        id: item.id,
        itemType: item.itemType,
        title: item.title,
        summary: item.summary,
      })),
      recentMessages: recentMessages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
    };
  }

  async sendMessage(input: {
    companyId: string;
    conversationId?: string | null;
    text: string;
    now?: Date;
  }): Promise<OuiCeoMessageResult> {
    const now = input.now ?? new Date();
    const assistantNow = new Date(now.getTime() + 1);
    const company = await this.productStore.getCompany(input.companyId);
    if (!company) {
      throw new Error(`OUI company not found: ${input.companyId}`);
    }
    const agents = await this.productStore.listAgents(input.companyId);
    const ceo = resolveCeo(company, agents);
    if (!ceo || ceo.adapterKind !== "openclaw") {
      throw new Error("Company CEO must be backed by an OpenClaw agent.");
    }
    const conversation = await this.productStore.getOrCreateCeoConversation({
      id: input.conversationId ?? undefined,
      companyId: input.companyId,
      ceoAgentId: ceo.id,
      title: truncate(input.text, 80),
      now,
    });
    const userMessage = await this.productStore.appendConversationMessage({
      conversationId: conversation.id,
      companyId: input.companyId,
      role: "user",
      content: input.text,
      metadata: { source: "owner" },
      now,
    });
    const context = await this.buildContext(input.companyId, conversation.id);
    const assistantMessage = await this.productStore.appendConversationMessage({
      conversationId: conversation.id,
      companyId: input.companyId,
      role: "assistant",
      content: buildAssistantReply({
        company,
        ceo,
        openInboxCount: context.openInboxItems.length,
        hasActiveRunbook: Boolean(context.activeRunbookVersion),
      }),
      metadata: {
        source: "oui_ceo_context",
        openclawDispatch: "feature_gated",
        note: "P1 stores company-scoped CEO context without starting work.",
      },
      now: assistantNow,
    });
    return {
      conversation: await this.productStore.getOrCreateCeoConversation({
        id: conversation.id,
        companyId: input.companyId,
      }),
      messages: await this.productStore.listConversationMessages(conversation.id),
      userMessage,
      assistantMessage,
      context,
    };
  }

  async generateRunbookDraft(input: {
    companyId: string;
    conversationId?: string | null;
    objective?: string | null;
    now?: Date;
  }): Promise<OuiGenerateRunbookDraftResult> {
    const company = await this.productStore.getCompany(input.companyId);
    if (!company) {
      throw new Error(`OUI company not found: ${input.companyId}`);
    }
    const conversation = await this.productStore.getOrCreateCeoConversation({
      id: input.conversationId ?? undefined,
      companyId: input.companyId,
      ceoAgentId: company.ceoAgentId ?? company.defaultLeaderAgentId,
      title: "运行文档草稿",
      now: input.now,
    });
    const messages = await this.productStore.listConversationMessages(conversation.id);
    const objective = objectiveFromMessages(messages, input.objective);
    const kind = inferRunbookKind(objective);
    const draft = await this.productStore.createRunbookDraft({
      companyId: input.companyId,
      title: titleFromObjective(objective),
      sourceType: "ceo_chat",
      sourceRef: conversation.id,
      objective,
      operatingMode: kind,
      stages: kind === "routine" ? buildRoutineStages(objective) : buildProjectStages(objective),
      decisionPoints: buildDecisionPoints(kind),
      artifactPolicy: {
        storage: "local",
        types: ["runbook", "stage_report", "deliverable"],
      },
      pausePolicy: {
        pauseOn: ["user_decision", "high_risk_action", "blocked"],
      },
      reportPolicy: {
        cadence: kind === "routine" ? "per_cycle" : "per_stage",
        style: "plain_language",
      },
      now: input.now,
    });
    const assistantMessage = await this.productStore.appendConversationMessage({
      conversationId: conversation.id,
      companyId: input.companyId,
      role: "assistant",
      content: `已生成运行文档草稿：${draft.runbook.title}。请在“运行文档”里检查，确认前公司不会开始执行。`,
      metadata: {
        source: "oui_runbook_generator",
        runbookId: draft.runbook.id,
        runbookVersionId: draft.version.id,
      },
      now: input.now,
    });
    return { conversation, runbookDraft: draft, assistantMessage };
  }
}
