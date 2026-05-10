import { localizeConfigCopy, isZhCnConfigCopy } from "../i18n/lib/config-copy.ts";

const ZH_CN_OUI_COMPANY_COPY = {
  Company: "公司",
  "Company, tasks, and run timeline": "公司、任务和运行时间线",
  "OUI Company": "OUI 公司",
  "Refreshing...": "正在刷新...",
  Refresh: "刷新",
  "Four-pane chat": "四宫格聊天",
  Leader: "领导者",
  Tasks: "任务",
  Runs: "运行",
  "OUI server": "OUI 服务",
  Connected: "已连接",
  Preview: "预览",
  Unassigned: "未分配",
  Active: "启用",
  Executable: "可执行",
  Disabled: "已禁用",
  "OpenClaw-led agents": "OpenClaw 主导的 agent",
  "No agents yet.": "暂无 agent。",
  Task: "任务",
  "Create work": "创建工作",
  Title: "标题",
  Assignee: "负责人",
  "What should the company do?": "要让公司做什么？",
  "Use leader": "使用领导者",
  Brief: "任务说明",
  "Add context, constraints, or expected output.": "补充背景、约束或期望输出。",
  "Create task": "创建任务",
  Run: "运行",
  Review: "复核",
  Done: "完成",
  Changes: "要求修改",
  Draft: "草稿",
  Ready: "待执行",
  Blocked: "阻塞",
  Running: "运行中",
  Empty: "空",
  "Run timeline": "运行时间线",
  "Select a task": "选择任务",
  "Blocked by": "被依赖阻塞：",
  "Assigned to": "分配给",
  "No task selected.": "未选择任务。",
  "No runs yet.": "暂无运行。",
  "No logs yet": "暂无日志。",
  "OUI server is not active. Company actions are preview-only.":
    "OUI 后端未启动，公司操作当前是预览模式。",
  "OUI API is not available (HTTP {status}). Company actions are preview-only.":
    "OUI 后端 API 未启动或未挂载（HTTP {status}）。当前仅预览，创建/运行任务已禁用。",
  "Task title is required.": "请先填写任务标题。",
  "Task created: {title}": "已创建任务：{title}",
  "Run queued: {runId}": "已排队运行：{runId}",
  "Task is blocked.": "任务被阻塞。",
  "OUI company is unavailable.": "OUI 公司不可用。",
  "Follow up with {agent}": "让 {agent} 跟进",
  "Created from four-pane {index}: {session}": "来自四宫格 {index}：{session}",
  "Task created from pane {index}.": "已从第 {index} 个窗口创建任务。",
  "External adapter execution is disabled.": "外部 adapter 执行当前已禁用。",
  draft: "草稿",
  ready: "待执行",
  blocked: "阻塞",
  running: "运行中",
  review: "复核",
  done: "完成",
  active: "启用",
  disabled: "已禁用",
  none: "未提交",
  requested: "待复核",
  approved: "已批准",
  "changes requested": "要求修改",
  missing: "缺失",
  unknown: "未知",
} as const;

type OuiCompanyCopyParams = Record<string, string | number | null | undefined>;

function interpolate(template: string, params?: OuiCompanyCopyParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value == null ? match : String(value);
  });
}

export function ouiCompanyCopy(text: string | null | undefined, params?: OuiCompanyCopyParams) {
  if (!text) {
    return "";
  }
  const localized = isZhCnConfigCopy()
    ? (ZH_CN_OUI_COMPANY_COPY[text as keyof typeof ZH_CN_OUI_COMPANY_COPY] ??
      localizeConfigCopy(text))
    : text;
  return interpolate(localized, params);
}

export function ouiCompanyStatusLabel(value: string | null | undefined): string {
  return ouiCompanyCopy((value ?? "unknown").replace(/_/g, " "));
}

export function formatOuiCompanyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const apiFailure = /^OUI API request failed: (\d+)$/.exec(message);
  if (apiFailure) {
    return ouiCompanyCopy(
      "OUI API is not available (HTTP {status}). Company actions are preview-only.",
      {
        status: apiFailure[1],
      },
    );
  }
  return ouiCompanyCopy(message);
}
