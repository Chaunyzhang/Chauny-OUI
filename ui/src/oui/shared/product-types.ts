import type {
  OuiAdapterKind,
  OuiEnqueueRunInput,
  OuiJsonObject,
  OuiRunLogEntry,
  OuiRunRecord,
} from "./types.ts";

export type OuiAgentStatus = "active" | "paused" | "disabled";

export type OuiRunbookKind = "project" | "routine";

export type OuiCompanyMode = OuiRunbookKind;

export type OuiCompanyStatus = "idle" | "running" | "waiting_user" | "blocked" | "paused";

export type OuiConversationStatus = "active" | "archived";

export type OuiMessageRole = "user" | "assistant" | "system";

export type OuiTaskStatus =
  | "draft"
  | "ready"
  | "blocked"
  | "running"
  | "review"
  | "done"
  | "cancelled";

export type OuiTaskReviewState = "none" | "requested" | "changes_requested" | "approved";

export type OuiRunbookStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "active"
  | "completed"
  | "archived"
  | "superseded";

export type OuiRunbookSourceType = "ceo_chat" | "meeting_minutes" | "imported_markdown" | "manual";

export type OuiInboxItemType =
  | "choice"
  | "approval"
  | "revision"
  | "blocked"
  | "exception"
  | "report_ack";

export type OuiInboxItemStatus = "open" | "resolved" | "rejected" | "stopped";

export type OuiInboxResolutionAction = "approve" | "reject" | "stop" | "reply";

export type OuiWorkNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting_user"
  | "blocked"
  | "done"
  | "skipped";

export type OuiCompanyRecord = {
  id: string;
  name: string;
  description?: string | null;
  mode: OuiCompanyMode;
  status: OuiCompanyStatus;
  ceoAgentId?: string | null;
  defaultLeaderAgentId?: string | null;
  currentRunbookVersionId?: string | null;
  currentObjective?: string | null;
  currentStage?: string | null;
  autonomyPolicy: OuiJsonObject;
  reportingPreference: OuiJsonObject;
  createdAt: string;
  updatedAt: string;
};

export type OuiRoleRecord = {
  id: string;
  companyId: string;
  name: string;
  parentRoleId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OuiAgentRecord = {
  id: string;
  companyId: string;
  adapterId: string;
  adapterKind: OuiAdapterKind;
  label: string;
  roleId?: string | null;
  reportsToAgentId?: string | null;
  openclawAgentId?: string | null;
  modelRef?: string | null;
  status: OuiAgentStatus;
  isLeader: boolean;
  config: OuiJsonObject;
  createdAt: string;
  updatedAt: string;
};

export type OuiConversationRecord = {
  id: string;
  companyId: string;
  ceoAgentId?: string | null;
  title?: string | null;
  summary?: string | null;
  status: OuiConversationStatus;
  createdAt: string;
  updatedAt: string;
};

export type OuiMessageRecord = {
  id: string;
  conversationId: string;
  companyId: string;
  role: OuiMessageRole;
  content: string;
  metadata: OuiJsonObject;
  createdAt: string;
};

export type OuiTaskRecord = {
  id: string;
  companyId: string;
  title: string;
  description?: string | null;
  status: OuiTaskStatus;
  reviewState: OuiTaskReviewState;
  assignedAgentId?: string | null;
  createdBy?: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export type OuiTaskDependencyRecord = {
  taskId: string;
  dependsOnTaskId: string;
  createdAt: string;
};

export type OuiTaskReadiness = {
  ready: boolean;
  pendingDependencyIds: string[];
};

export type OuiTaskRunLink = {
  taskId: string;
  runId: string;
  kind: "primary" | "review" | "followup";
  createdAt: string;
};

export type OuiCostEventRecord = {
  id: string;
  runId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  amountMicros?: number | null;
  currency?: string | null;
  usage: OuiJsonObject;
  source: string;
  createdAt: string;
};

export type OuiRunbookRecord = {
  id: string;
  companyId: string;
  title: string;
  status: OuiRunbookStatus;
  activeVersionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OuiRunbookVersionRecord = {
  id: string;
  runbookId: string;
  companyId: string;
  version: number;
  sourceType: OuiRunbookSourceType;
  sourceRef?: string | null;
  status: OuiRunbookStatus;
  objective: string;
  operatingMode: OuiRunbookKind;
  stages: OuiJsonObject[];
  decisionPoints: OuiJsonObject[];
  artifactPolicy: OuiJsonObject;
  pausePolicy: OuiJsonObject;
  reportPolicy: OuiJsonObject;
  markdownPath?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OuiWorkNodeRecord = {
  id: string;
  companyId: string;
  runbookVersionId: string;
  stageId: string;
  title: string;
  nodeType: string;
  status: OuiWorkNodeStatus;
  assignedAgentId?: string | null;
  orderIndex: number;
  summary?: string | null;
  input: OuiJsonObject;
  output: OuiJsonObject;
  runId?: string | null;
  inboxItemId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OuiInboxItemRecord = {
  id: string;
  companyId: string;
  itemType: OuiInboxItemType;
  status: OuiInboxItemStatus;
  title: string;
  summary?: string | null;
  runbookVersionId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  payload: OuiJsonObject;
  resolution?: OuiJsonObject | null;
  createdBy?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OuiControlRoomNodeStatus =
  | "idle"
  | "queued"
  | "current"
  | "waiting_user"
  | "blocked"
  | "done";

export type OuiControlRoomNode = {
  id: string;
  title: string;
  status: OuiControlRoomNodeStatus;
  kind: "stage" | "task" | "inbox";
  assigneeLabel?: string | null;
  summary?: string | null;
  sourceStatus?: string | null;
  updatedAt?: string | null;
};

export type OuiCompanySummary = {
  company: OuiCompanyRecord;
  ceo: OuiAgentRecord | null;
  taskCount: number;
  openInboxCount: number;
  activeRunbook: OuiRunbookRecord | null;
  latestActivityAt: string;
};

export type OuiControlRoomReadModel = {
  companyId: string;
  status: OuiCompanyStatus;
  ceo: OuiAgentRecord | null;
  currentObjective?: string | null;
  currentStage?: string | null;
  activeRunbook: OuiRunbookRecord | null;
  activeRunbookVersion: OuiRunbookVersionRecord | null;
  openInboxItems: OuiInboxItemRecord[];
  nodes: OuiControlRoomNode[];
  nextStep: string;
  updatedAt: string;
};

export type OuiCompanyDetail = {
  company: OuiCompanyRecord;
  agents: OuiAgentRecord[];
  ceoConversations: OuiConversationRecord[];
  ceoMessages: OuiMessageRecord[];
  tasks: OuiTaskRecord[];
  runbooks: OuiRunbookRecord[];
  runbookVersions: OuiRunbookVersionRecord[];
  activeRunbookVersion: OuiRunbookVersionRecord | null;
  workNodes: OuiWorkNodeRecord[];
  inboxItems: OuiInboxItemRecord[];
  controlRoom: OuiControlRoomReadModel;
};

export type OuiCreateCompanyInput = {
  id?: string;
  name: string;
  description?: string | null;
  openclawCeo: {
    id?: string;
    label: string;
    openclawAgentId: string;
    adapterId?: string;
    modelRef?: string | null;
  };
  now?: Date;
};

export type OuiTaskTimelineRun = {
  link: OuiTaskRunLink;
  run: OuiRunRecord | null;
  logs: OuiRunLogEntry[];
  costEvents: OuiCostEventRecord[];
};

export type OuiTaskTimeline = {
  task: OuiTaskRecord;
  readiness: OuiTaskReadiness;
  runs: OuiTaskTimelineRun[];
};

export type OuiEmployeeAdapterPreview = {
  adapterId: string;
  kind: OuiAdapterKind;
  label: string;
  enabled: boolean;
  executable: boolean;
  reason?: string;
};

export type OuiCreateAgentInput = {
  id?: string;
  companyId: string;
  adapterId: string;
  adapterKind: OuiAdapterKind;
  label: string;
  roleId?: string | null;
  reportsToAgentId?: string | null;
  openclawAgentId?: string | null;
  modelRef?: string | null;
  status?: OuiAgentStatus;
  isLeader?: boolean;
  config?: OuiJsonObject;
  now?: Date;
};

export type OuiGetOrCreateConversationInput = {
  id?: string;
  companyId: string;
  ceoAgentId?: string | null;
  title?: string | null;
  now?: Date;
};

export type OuiAppendMessageInput = {
  id?: string;
  conversationId: string;
  companyId: string;
  role: OuiMessageRole;
  content: string;
  metadata?: OuiJsonObject;
  now?: Date;
};

export type OuiCreateTaskInput = {
  id?: string;
  companyId: string;
  title: string;
  description?: string | null;
  assignedAgentId?: string | null;
  createdBy?: string | null;
  priority?: number;
  now?: Date;
};

export type OuiCreateRunbookDraftInput = {
  id?: string;
  versionId?: string;
  companyId: string;
  title: string;
  sourceType: OuiRunbookSourceType;
  sourceRef?: string | null;
  objective: string;
  operatingMode?: OuiRunbookKind;
  stages?: OuiJsonObject[];
  decisionPoints?: OuiJsonObject[];
  artifactPolicy?: OuiJsonObject;
  pausePolicy?: OuiJsonObject;
  reportPolicy?: OuiJsonObject;
  markdownPath?: string | null;
  now?: Date;
};

export type OuiCreateRunbookDraftResult = {
  runbook: OuiRunbookRecord;
  version: OuiRunbookVersionRecord;
};

export type OuiStartRunbookVersionResult = {
  company: OuiCompanyRecord;
  runbook: OuiRunbookRecord;
  version: OuiRunbookVersionRecord;
  workNodes: OuiWorkNodeRecord[];
};

export type OuiCreateInboxItemInput = {
  id?: string;
  companyId: string;
  itemType: OuiInboxItemType;
  title: string;
  summary?: string | null;
  runbookVersionId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  payload?: OuiJsonObject;
  createdBy?: string | null;
  now?: Date;
};

export type OuiResolveInboxItemInput = {
  itemId: string;
  action: OuiInboxResolutionAction;
  responseText?: string | null;
  actorId?: string | null;
  now?: Date;
};

export type OuiQueueTaskRunInput = {
  taskId: string;
  runId?: string;
  message?: string;
  sessionKey?: string | null;
  adapterId?: string;
  adapterKind?: OuiAdapterKind;
  maxAttempts?: number;
  now?: Date;
};

export type OuiQueuedTaskRunResult =
  | {
      status: "queued";
      task: OuiTaskRecord;
      run: OuiRunRecord;
      readiness: OuiTaskReadiness;
    }
  | {
      status: "blocked";
      task: OuiTaskRecord;
      readiness: OuiTaskReadiness;
    };

export type OuiProductStore = {
  listCompanies(): Promise<OuiCompanyRecord[]>;
  createCompany(input: OuiCreateCompanyInput): Promise<{
    company: OuiCompanyRecord;
    ceo: OuiAgentRecord;
  }>;
  getCompany(companyId: string): Promise<OuiCompanyRecord | null>;
  listAgents(companyId: string): Promise<OuiAgentRecord[]>;
  getAgent(agentId: string): Promise<OuiAgentRecord | null>;
  createAgent(input: OuiCreateAgentInput): Promise<OuiAgentRecord>;
  setDefaultLeaderAgent(companyId: string, agentId: string, now?: Date): Promise<OuiCompanyRecord>;
  listCeoConversations(companyId: string): Promise<OuiConversationRecord[]>;
  getOrCreateCeoConversation(
    input: OuiGetOrCreateConversationInput,
  ): Promise<OuiConversationRecord>;
  listConversationMessages(conversationId: string, limit?: number): Promise<OuiMessageRecord[]>;
  appendConversationMessage(input: OuiAppendMessageInput): Promise<OuiMessageRecord>;
  createTask(input: OuiCreateTaskInput): Promise<OuiTaskRecord>;
  getTask(taskId: string): Promise<OuiTaskRecord | null>;
  listTasks(companyId: string): Promise<OuiTaskRecord[]>;
  addTaskDependency(
    taskId: string,
    dependsOnTaskId: string,
    now?: Date,
  ): Promise<OuiTaskDependencyRecord>;
  getTaskReadiness(taskId: string): Promise<OuiTaskReadiness>;
  assignTask(taskId: string, agentId: string, now?: Date): Promise<OuiTaskRecord>;
  transitionTaskReview(
    taskId: string,
    next: OuiTaskReviewState,
    now?: Date,
  ): Promise<OuiTaskRecord>;
  updateTaskStatus(taskId: string, status: OuiTaskStatus, now?: Date): Promise<OuiTaskRecord>;
  attachRunToTask(
    taskId: string,
    runId: string,
    kind?: OuiTaskRunLink["kind"],
    now?: Date,
  ): Promise<OuiTaskRunLink>;
  listTaskRunLinks(taskId: string): Promise<OuiTaskRunLink[]>;
  recordCostEvent(input: {
    id?: string;
    runId?: string | null;
    taskId?: string | null;
    agentId?: string | null;
    amountMicros?: number | null;
    currency?: string | null;
    usage?: OuiJsonObject;
    source: string;
    now?: Date;
  }): Promise<OuiCostEventRecord>;
  listCostEventsForRun(runId: string): Promise<OuiCostEventRecord[]>;
  createRunbookDraft(input: OuiCreateRunbookDraftInput): Promise<OuiCreateRunbookDraftResult>;
  listRunbooks(companyId: string): Promise<OuiRunbookRecord[]>;
  listRunbookVersions(companyId: string): Promise<OuiRunbookVersionRecord[]>;
  getRunbookVersion(versionId: string): Promise<OuiRunbookVersionRecord | null>;
  approveRunbookVersion(
    versionId: string,
    approvedBy: string,
    now?: Date,
  ): Promise<OuiRunbookVersionRecord>;
  startRunbookVersion(
    versionId: string,
    startedBy: string,
    now?: Date,
  ): Promise<OuiStartRunbookVersionResult>;
  listWorkNodes(companyId: string, runbookVersionId?: string | null): Promise<OuiWorkNodeRecord[]>;
  createInboxItem(input: OuiCreateInboxItemInput): Promise<OuiInboxItemRecord>;
  listInboxItems(companyId: string, status?: OuiInboxItemStatus): Promise<OuiInboxItemRecord[]>;
  resolveInboxItem(input: OuiResolveInboxItemInput): Promise<OuiInboxItemRecord>;
};

export type OuiTaskRunEnqueue = OuiEnqueueRunInput & {
  taskId: string;
};
