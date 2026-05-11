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

export type OuiRoutineStatus = "active" | "paused" | "disabled";

export type OuiRoutineTriggerKind = "manual" | "schedule" | "api" | "webhook";

export type OuiRoutineConcurrencyPolicy =
  | "coalesce_if_active"
  | "skip_if_active"
  | "always_enqueue";

export type OuiRoutineTriggerStatus = "received" | "queued" | "skipped" | "succeeded" | "failed";

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

export type OuiWorkWakeupStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type OuiWorkWakeupReason =
  | "runbook_started"
  | "inbox_resolved"
  | "work_node_requested"
  | "running_sync"
  | "retry";

export type OuiArtifactKind =
  | "runbook"
  | "meeting_minutes"
  | "report"
  | "document"
  | "code_patch"
  | "media"
  | "dataset"
  | "stage_output";

export type OuiMeetingStatus = "draft" | "active" | "ended";

export type OuiMeetingMessageRole = "owner" | "participant" | "system";

export type OuiMeetingDiscussionPhase = "drafting" | "awaiting_user" | "ended";

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

export type OuiRoutineRecord = {
  id: string;
  companyId: string;
  runbookVersionId: string;
  title: string;
  description?: string | null;
  status: OuiRoutineStatus;
  triggerKind: OuiRoutineTriggerKind;
  schedule: OuiJsonObject;
  concurrencyPolicy: OuiRoutineConcurrencyPolicy;
  lastTriggeredAt?: string | null;
  nextTriggerAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OuiRoutineTriggerRecord = {
  id: string;
  routineId: string;
  companyId: string;
  runbookVersionId: string;
  triggerKind: OuiRoutineTriggerKind;
  status: OuiRoutineTriggerStatus;
  payload: OuiJsonObject;
  createdAt: string;
  updatedAt: string;
  error?: string | null;
};

export type OuiAuditLogRecord = {
  id: string;
  actorType: string;
  actorId: string;
  companyId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  details: OuiJsonObject;
  createdAt: string;
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

export type OuiWorkWakeupRecord = {
  id: string;
  companyId: string;
  runbookVersionId?: string | null;
  workNodeId?: string | null;
  agentId?: string | null;
  reason: OuiWorkWakeupReason;
  status: OuiWorkWakeupStatus;
  payload: OuiJsonObject;
  attempts: number;
  maxAttempts: number;
  leaseOwner?: string | null;
  leaseToken?: string | null;
  leaseExpiresAt?: string | null;
  heartbeatAt?: string | null;
  queuedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OuiArtifactRecord = {
  id: string;
  companyId?: string | null;
  meetingId?: string | null;
  runId?: string | null;
  kind: OuiArtifactKind;
  title: string;
  summary?: string | null;
  path?: string | null;
  contentType: string;
  content: OuiJsonObject;
  metadata: OuiJsonObject;
  createdAt: string;
  updatedAt: string;
};

export type OuiMeetingParticipant = {
  id: string;
  label: string;
  adapterKind: OuiAdapterKind;
  adapterId?: string | null;
  agentId?: string | null;
  openclawAgentId?: string | null;
  modelRef?: string | null;
  role?: string | null;
  muted?: boolean | null;
  speakingOrder?: number | null;
  thinkingIntensity?: "low" | "medium" | "high" | null;
};

export type OuiMeetingModeratorDocument = {
  round: number;
  text: string;
  updatedAt: string;
  updatedBy: "seed" | "moderator" | "user";
};

export type OuiMeetingRoundRecord = {
  round: number;
  sourceDocumentText: string;
  participantMessageIds: string[];
  moderatorMessageId?: string | null;
  createdAt: string;
};

export type OuiMeetingDiscussionState = {
  phase: OuiMeetingDiscussionPhase;
  currentRound: number;
  activeDocument: OuiMeetingModeratorDocument;
  roundHistory: OuiMeetingRoundRecord[];
};

export type OuiMeetingRecord = {
  id: string;
  title: string;
  objective?: string | null;
  status: OuiMeetingStatus;
  participants: OuiMeetingParticipant[];
  discussion: OuiMeetingDiscussionState;
  minutesArtifactId?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
};

export type OuiMeetingMessageRecord = {
  id: string;
  meetingId: string;
  role: OuiMeetingMessageRole;
  participantId?: string | null;
  content: string;
  metadata: OuiJsonObject;
  createdAt: string;
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
  completedTaskCount: number;
  openInboxCount: number;
  tokenUsageTotal: number;
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
  artifactCount: number;
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
  routines: OuiRoutineRecord[];
  activeRunbookVersion: OuiRunbookVersionRecord | null;
  workNodes: OuiWorkNodeRecord[];
  inboxItems: OuiInboxItemRecord[];
  artifacts: OuiArtifactRecord[];
  auditLog: OuiAuditLogRecord[];
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

export type OuiCreateRoutineInput = {
  id?: string;
  companyId: string;
  runbookVersionId: string;
  title: string;
  description?: string | null;
  triggerKind?: OuiRoutineTriggerKind;
  schedule?: OuiJsonObject;
  concurrencyPolicy?: OuiRoutineConcurrencyPolicy;
  status?: OuiRoutineStatus;
  now?: Date;
};

export type OuiUpdateRoutineStatusInput = {
  routineId: string;
  status: OuiRoutineStatus;
  now?: Date;
};

export type OuiMarkRoutineTriggeredInput = {
  routineId: string;
  triggerKind?: OuiRoutineTriggerKind;
  nextTriggerAt?: string | null;
  now?: Date;
};

export type OuiCreateRoutineTriggerInput = {
  id?: string;
  routineId: string;
  status: OuiRoutineTriggerStatus;
  triggerKind?: OuiRoutineTriggerKind;
  payload?: OuiJsonObject;
  error?: string | null;
  now?: Date;
};

export type OuiRecordAuditLogInput = {
  id?: string;
  actorType?: string;
  actorId?: string;
  companyId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  details?: OuiJsonObject;
  now?: Date;
};

export type OuiResolveInboxItemInput = {
  itemId: string;
  action: OuiInboxResolutionAction;
  responseText?: string | null;
  actorId?: string | null;
  now?: Date;
};

export type OuiEnqueueWorkWakeupInput = {
  id?: string;
  companyId: string;
  runbookVersionId?: string | null;
  workNodeId?: string | null;
  agentId?: string | null;
  reason: OuiWorkWakeupReason;
  payload?: OuiJsonObject;
  maxAttempts?: number;
  now?: Date;
};

export type OuiClaimWorkWakeupInput = {
  workerId: string;
  leaseMs: number;
  now?: Date;
};

export type OuiHeartbeatWorkWakeupInput = {
  wakeupId: string;
  workerId: string;
  leaseToken: string;
  leaseMs: number;
  now?: Date;
};

export type OuiFinishWorkWakeupInput = {
  wakeupId: string;
  workerId: string;
  leaseToken: string;
  status: Extract<OuiWorkWakeupStatus, "succeeded" | "failed" | "cancelled">;
  error?: string | null;
  now?: Date;
};

export type OuiRecoverWorkWakeupsInput = {
  now?: Date;
};

export type OuiWorkWakeupLease = {
  wakeup: OuiWorkWakeupRecord;
  leaseToken: string;
};

export type OuiCreateArtifactInput = {
  id?: string;
  companyId?: string | null;
  meetingId?: string | null;
  runId?: string | null;
  kind: OuiArtifactKind;
  title: string;
  summary?: string | null;
  path?: string | null;
  contentType?: string;
  content?: OuiJsonObject;
  metadata?: OuiJsonObject;
  now?: Date;
};

export type OuiListArtifactsFilter = {
  companyId?: string | null;
  meetingId?: string | null;
  runId?: string | null;
};

export type OuiCreateMeetingInput = {
  id?: string;
  title: string;
  objective?: string | null;
  participants?: OuiMeetingParticipant[];
  now?: Date;
};

export type OuiUpdateMeetingStatusInput = {
  meetingId: string;
  status: OuiMeetingStatus;
  minutesArtifactId?: string | null;
  now?: Date;
};

export type OuiUpdateMeetingParticipantsInput = {
  meetingId: string;
  participants: OuiMeetingParticipant[];
  now?: Date;
};

export type OuiUpdateMeetingDiscussionInput = {
  meetingId: string;
  discussion: OuiMeetingDiscussionState;
  now?: Date;
};

export type OuiAppendMeetingMessageInput = {
  id?: string;
  meetingId: string;
  role: OuiMeetingMessageRole;
  participantId?: string | null;
  content: string;
  metadata?: OuiJsonObject;
  now?: Date;
};

export type OuiCompleteWorkNodeInput = {
  nodeId: string;
  completedBy?: string | null;
  summary?: string | null;
  output?: OuiJsonObject;
  now?: Date;
};

export type OuiUpdateWorkNodeRunStateInput = {
  nodeId: string;
  status: Extract<OuiWorkNodeStatus, "ready" | "running" | "blocked" | "waiting_user">;
  runId?: string | null;
  inboxItemId?: string | null;
  clearRunId?: boolean;
  clearInboxItemId?: boolean;
  summary?: string | null;
  output?: OuiJsonObject;
  now?: Date;
};

export type OuiCompleteWorkNodeResult = {
  node: OuiWorkNodeRecord;
  nextNode: OuiWorkNodeRecord | null;
  artifact: OuiArtifactRecord;
  company: OuiCompanyRecord;
  runbook: OuiRunbookRecord;
  version: OuiRunbookVersionRecord;
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
  deleteCompany(companyId: string): Promise<OuiCompanyRecord | null>;
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
  createRoutine(input: OuiCreateRoutineInput): Promise<OuiRoutineRecord>;
  getRoutine(routineId: string): Promise<OuiRoutineRecord | null>;
  listRoutines(companyId?: string | null): Promise<OuiRoutineRecord[]>;
  listDueRoutines(now?: Date): Promise<OuiRoutineRecord[]>;
  updateRoutineStatus(input: OuiUpdateRoutineStatusInput): Promise<OuiRoutineRecord>;
  markRoutineTriggered(input: OuiMarkRoutineTriggeredInput): Promise<OuiRoutineRecord>;
  createRoutineTrigger(input: OuiCreateRoutineTriggerInput): Promise<OuiRoutineTriggerRecord>;
  listRoutineTriggers(routineId: string): Promise<OuiRoutineTriggerRecord[]>;
  recordAuditLog(input: OuiRecordAuditLogInput): Promise<OuiAuditLogRecord>;
  listAuditLog(companyId?: string | null, limit?: number): Promise<OuiAuditLogRecord[]>;
  listWorkNodes(companyId: string, runbookVersionId?: string | null): Promise<OuiWorkNodeRecord[]>;
  getWorkNode(nodeId: string): Promise<OuiWorkNodeRecord | null>;
  updateWorkNodeRunState(input: OuiUpdateWorkNodeRunStateInput): Promise<OuiWorkNodeRecord>;
  createInboxItem(input: OuiCreateInboxItemInput): Promise<OuiInboxItemRecord>;
  listInboxItems(companyId: string, status?: OuiInboxItemStatus): Promise<OuiInboxItemRecord[]>;
  resolveInboxItem(input: OuiResolveInboxItemInput): Promise<OuiInboxItemRecord>;
  enqueueWorkWakeup(input: OuiEnqueueWorkWakeupInput): Promise<OuiWorkWakeupRecord>;
  claimNextWorkWakeup(input: OuiClaimWorkWakeupInput): Promise<OuiWorkWakeupLease | null>;
  heartbeatWorkWakeupLease(input: OuiHeartbeatWorkWakeupInput): Promise<OuiWorkWakeupRecord | null>;
  finishWorkWakeup(input: OuiFinishWorkWakeupInput): Promise<OuiWorkWakeupRecord | null>;
  recoverExpiredWorkWakeups(input?: OuiRecoverWorkWakeupsInput): Promise<OuiWorkWakeupRecord[]>;
  listWorkWakeups(companyId: string, status?: OuiWorkWakeupStatus): Promise<OuiWorkWakeupRecord[]>;
  createArtifact(input: OuiCreateArtifactInput): Promise<OuiArtifactRecord>;
  listArtifacts(filter?: OuiListArtifactsFilter): Promise<OuiArtifactRecord[]>;
  createMeeting(input: OuiCreateMeetingInput): Promise<OuiMeetingRecord>;
  getMeeting(meetingId: string): Promise<OuiMeetingRecord | null>;
  listMeetings(): Promise<OuiMeetingRecord[]>;
  updateMeetingStatus(input: OuiUpdateMeetingStatusInput): Promise<OuiMeetingRecord>;
  updateMeetingParticipants(input: OuiUpdateMeetingParticipantsInput): Promise<OuiMeetingRecord>;
  updateMeetingDiscussion(input: OuiUpdateMeetingDiscussionInput): Promise<OuiMeetingRecord>;
  appendMeetingMessage(input: OuiAppendMeetingMessageInput): Promise<OuiMeetingMessageRecord>;
  listMeetingMessages(meetingId: string): Promise<OuiMeetingMessageRecord[]>;
  completeWorkNode(input: OuiCompleteWorkNodeInput): Promise<OuiCompleteWorkNodeResult>;
};

export type OuiTaskRunEnqueue = OuiEnqueueRunInput & {
  taskId: string;
};
