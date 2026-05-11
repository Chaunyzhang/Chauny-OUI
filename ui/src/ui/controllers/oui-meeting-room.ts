import type {
  OuiArtifactRecord,
  OuiMeetingDiscussionState,
  OuiMeetingMessageRecord,
  OuiMeetingParticipant,
  OuiMeetingRecord,
} from "../../oui/shared/product-types.ts";
import { formatOuiCompanyError, ouiCompanyCopy } from "../oui-company-copy.ts";
import { normalizeAgentId } from "../session-key.ts";
import type { AgentsListResult } from "../types.ts";
import { resolveOuiCompanyCeoCandidates } from "./oui-company.ts";

export type OuiMeetingRoomMessage = { kind: "success" | "error"; text: string };

export type OuiMeetingParticipantCandidate = OuiMeetingParticipant & {
  modelRef: string | null;
};

export type OuiMeetingRoomUiState = {
  agentsList: AgentsListResult | null;
  ouiMeetingLoading: boolean;
  ouiMeetingBusy: boolean;
  ouiMeetingError: string | null;
  ouiMeetingMessage: OuiMeetingRoomMessage | null;
  ouiMeetings: OuiMeetingRecord[];
  ouiSelectedMeetingId: string | null;
  ouiMeetingMessages: OuiMeetingMessageRecord[];
  ouiMeetingArtifacts: OuiArtifactRecord[];
  ouiMeetingTitleDraft: string;
  ouiMeetingObjectiveDraft: string;
  ouiMeetingInviteDialogOpen: boolean;
  ouiMeetingSettingsParticipantId: string | null;
  ouiMeetingDocumentDraft: string;
  ouiMeetingParticipantDraftId: string;
  ouiMeetingDraftParticipants: OuiMeetingParticipant[];
  ouiMeetingPromptDraft: string;
  requestUpdate?: () => void;
};

type MeetingsBody = { meetings?: OuiMeetingRecord[] };
type MeetingDetailBody = {
  meeting?: OuiMeetingRecord | null;
  messages?: OuiMeetingMessageRecord[];
  artifacts?: OuiArtifactRecord[];
};
type MeetingCreateBody = { meeting?: OuiMeetingRecord };
type MeetingTurnBody = {
  meeting?: OuiMeetingRecord | null;
  ownerMessage?: OuiMeetingMessageRecord;
  participantMessages?: OuiMeetingMessageRecord[];
};
type MeetingMinutesBody = {
  meeting?: OuiMeetingRecord | null;
  artifact?: OuiArtifactRecord;
};
type MeetingDocumentBody = { meeting?: OuiMeetingRecord | null };

const OUI_API_BASE = "/api/oui";

function markChanged(state: OuiMeetingRoomUiState) {
  state.requestUpdate?.();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.trim() ? (JSON.parse(text) as unknown) : {};
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  console.warn("[oui-meeting] request", {
    path,
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? init.body : null,
  });
  const response = await fetch(`${OUI_API_BASE}${path}`, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const body = await readResponseJson(response);
  console.warn("[oui-meeting] response", {
    path,
    method: init?.method ?? "GET",
    status: response.status,
    body,
  });
  if (!response.ok) {
    const record = asRecord(body);
    const message = optionalString(record.message) ?? optionalString(record.error);
    throw new Error(message ?? `OUI API request failed: ${response.status}`);
  }
  return body as T;
}

function formatError(error: unknown): string {
  return formatOuiCompanyError(error);
}

function fallbackMeetingDiscussion(meeting: OuiMeetingRecord): OuiMeetingDiscussionState {
  return {
    phase: meeting.status === "ended" ? "ended" : "drafting",
    currentRound: 0,
    activeDocument: {
      round: 0,
      text: [
        `Meeting topic: ${meeting.title}`,
        meeting.objective ? `Context: ${meeting.objective}` : null,
      ]
        .filter((line): line is string => line != null)
        .join("\n"),
      updatedAt: meeting.updatedAt || meeting.createdAt,
      updatedBy: "seed",
    },
    roundHistory: [],
  };
}

function meetingDiscussion(meeting: OuiMeetingRecord): OuiMeetingDiscussionState {
  return meeting.discussion?.activeDocument
    ? meeting.discussion
    : fallbackMeetingDiscussion(meeting);
}

export function resolveOuiMeetingParticipantCandidates(
  agentsList: AgentsListResult | null,
): OuiMeetingParticipantCandidate[] {
  return resolveOuiCompanyCeoCandidates(agentsList).map((candidate) => ({
    id: normalizeAgentId(candidate.id),
    label: candidate.label,
    adapterKind: "openclaw",
    adapterId: "openclaw-local",
    openclawAgentId: normalizeAgentId(candidate.id),
    modelRef: candidate.modelRef,
    role: "free_agent",
  }));
}

export function sortMeetingParticipants(participants: readonly OuiMeetingParticipant[]) {
  return [...participants].sort((left, right) => {
    const leftOrder =
      typeof left.speakingOrder === "number" && Number.isFinite(left.speakingOrder)
        ? left.speakingOrder
        : Number.MAX_SAFE_INTEGER;
    const rightOrder =
      typeof right.speakingOrder === "number" && Number.isFinite(right.speakingOrder)
        ? right.speakingOrder
        : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.label.localeCompare(right.label);
  });
}

function normalizeMeetingParticipants(participants: readonly OuiMeetingParticipant[]) {
  return sortMeetingParticipants(participants).map((participant, index) => ({
    ...participant,
    muted: participant.muted === true,
    speakingOrder: index + 1,
    thinkingIntensity: participant.thinkingIntensity ?? "medium",
  }));
}

function createMeetingParticipantFromCandidate(
  candidate: OuiMeetingParticipantCandidate,
  speakingOrder: number,
): OuiMeetingParticipant {
  return {
    id: candidate.id,
    label: candidate.label,
    adapterKind: candidate.adapterKind,
    adapterId: candidate.adapterId,
    agentId: candidate.agentId,
    openclawAgentId: candidate.openclawAgentId,
    modelRef: candidate.modelRef,
    role: candidate.role,
    muted: false,
    speakingOrder,
    thinkingIntensity: "medium",
  };
}

function selectedMeeting(state: OuiMeetingRoomUiState): OuiMeetingRecord | null {
  return state.ouiMeetings.find((meeting) => meeting.id === state.ouiSelectedMeetingId) ?? null;
}

function syncMeetingDocumentDraft(state: OuiMeetingRoomUiState, meeting: OuiMeetingRecord | null) {
  state.ouiMeetingDocumentDraft = meeting ? meetingDiscussion(meeting).activeDocument.text : "";
}

function editableParticipants(state: OuiMeetingRoomUiState) {
  return normalizeMeetingParticipants(
    selectedMeeting(state)?.participants ?? state.ouiMeetingDraftParticipants,
  );
}

async function saveSelectedMeetingParticipants(
  state: OuiMeetingRoomUiState,
  participants: readonly OuiMeetingParticipant[],
) {
  const meeting = selectedMeeting(state);
  if (!meeting) {
    return;
  }
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<MeetingCreateBody>(
      `/meetings/${encodeURIComponent(meeting.id)}/participants`,
      {
        method: "PUT",
        body: JSON.stringify({
          participants: normalizeMeetingParticipants(participants),
        }),
      },
    );
    if (body.meeting) {
      applyMeetingDetail(state, {
        meeting: body.meeting,
        messages: state.ouiMeetingMessages,
        artifacts: state.ouiMeetingArtifacts,
      });
    }
    await reloadMeetings(state);
    state.ouiMeetingInviteDialogOpen = false;
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}

function saveDraftMeetingParticipants(
  state: OuiMeetingRoomUiState,
  participants: readonly OuiMeetingParticipant[],
) {
  state.ouiMeetingDraftParticipants = normalizeMeetingParticipants(participants);
  if (
    state.ouiMeetingSettingsParticipantId &&
    !state.ouiMeetingDraftParticipants.some(
      (participant) => participant.id === state.ouiMeetingSettingsParticipantId,
    )
  ) {
    state.ouiMeetingSettingsParticipantId = null;
  }
  markChanged(state);
}

async function updateMeetingParticipantsState(
  state: OuiMeetingRoomUiState,
  updater: (participants: OuiMeetingParticipant[]) => OuiMeetingParticipant[],
) {
  const meeting = selectedMeeting(state);
  const nextParticipants = updater(editableParticipants(state));
  if (meeting) {
    await saveSelectedMeetingParticipants(state, nextParticipants);
    return;
  }
  saveDraftMeetingParticipants(state, nextParticipants);
}

function clearSelectedMeeting(state: OuiMeetingRoomUiState) {
  state.ouiSelectedMeetingId = null;
  state.ouiMeetingMessages = [];
  state.ouiMeetingArtifacts = [];
  syncMeetingDocumentDraft(state, null);
}

function applyMeetingDetail(state: OuiMeetingRoomUiState, body: MeetingDetailBody) {
  const meeting = body.meeting ?? null;
  if (meeting) {
    const index = state.ouiMeetings.findIndex((entry) => entry.id === meeting.id);
    state.ouiMeetings =
      index >= 0
        ? [...state.ouiMeetings.slice(0, index), meeting, ...state.ouiMeetings.slice(index + 1)]
        : [meeting, ...state.ouiMeetings];
    state.ouiSelectedMeetingId = meeting.id;
    if (
      state.ouiMeetingSettingsParticipantId &&
      !meeting.participants.some(
        (participant) => participant.id === state.ouiMeetingSettingsParticipantId,
      )
    ) {
      state.ouiMeetingSettingsParticipantId = null;
    }
    syncMeetingDocumentDraft(state, meeting);
  }
  state.ouiMeetingMessages = Array.isArray(body.messages) ? body.messages : [];
  state.ouiMeetingArtifacts = Array.isArray(body.artifacts) ? body.artifacts : [];
}

async function reloadMeetingDetail(state: OuiMeetingRoomUiState, meetingId: string) {
  applyMeetingDetail(
    state,
    await fetchJson<MeetingDetailBody>(`/meetings/${encodeURIComponent(meetingId)}`),
  );
}

async function reloadMeetings(state: OuiMeetingRoomUiState) {
  const body = await fetchJson<MeetingsBody>("/meetings");
  state.ouiMeetings = Array.isArray(body.meetings) ? body.meetings : [];
}

export async function loadOuiMeetings(state: OuiMeetingRoomUiState) {
  state.ouiMeetingLoading = true;
  state.ouiMeetingError = null;
  markChanged(state);
  try {
    await reloadMeetings(state);
    const selectedId =
      state.ouiSelectedMeetingId &&
      state.ouiMeetings.some((meeting) => meeting.id === state.ouiSelectedMeetingId)
        ? state.ouiSelectedMeetingId
        : state.ouiMeetings[0]?.id;
    if (selectedId) {
      await reloadMeetingDetail(state, selectedId);
    } else {
      clearSelectedMeeting(state);
    }
  } catch (error) {
    state.ouiMeetingError = formatError(error);
    state.ouiMeetings = [];
    clearSelectedMeeting(state);
  } finally {
    state.ouiMeetingLoading = false;
    markChanged(state);
  }
}

export async function selectOuiMeeting(state: OuiMeetingRoomUiState, meetingId: string) {
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    await reloadMeetingDetail(state, meetingId);
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}

export async function addOuiMeetingDraftParticipant(state: OuiMeetingRoomUiState) {
  const candidates = resolveOuiMeetingParticipantCandidates(state.agentsList);
  const meeting = selectedMeeting(state);
  const existingIds = new Set(
    meeting?.participants.map((participant) => participant.id) ??
      state.ouiMeetingDraftParticipants.map((participant) => participant.id),
  );
  const fallbackId = candidates.find((candidate) => !existingIds.has(candidate.id))?.id ?? "";
  const rawCandidateId = state.ouiMeetingParticipantDraftId || fallbackId;
  const candidateId = rawCandidateId ? normalizeAgentId(rawCandidateId) : "";
  if (!candidateId || existingIds.has(candidateId)) {
    return;
  }
  const candidate = candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    return;
  }
  const nextParticipant = createMeetingParticipantFromCandidate(candidate, existingIds.size + 1);
  if (meeting) {
    await saveSelectedMeetingParticipants(state, [...meeting.participants, nextParticipant]);
    return;
  }
  saveDraftMeetingParticipants(state, [...state.ouiMeetingDraftParticipants, nextParticipant]);
  state.ouiMeetingInviteDialogOpen = false;
}

export async function removeOuiMeetingDraftParticipant(
  state: OuiMeetingRoomUiState,
  participantId: string,
) {
  await updateMeetingParticipantsState(state, (participants) =>
    participants.filter((participant) => participant.id !== participantId),
  );
}

export async function toggleOuiMeetingParticipantMuted(
  state: OuiMeetingRoomUiState,
  participantId: string,
) {
  await updateMeetingParticipantsState(state, (participants) =>
    participants.map((participant) =>
      participant.id === participantId
        ? { ...participant, muted: participant.muted !== true ? true : false }
        : participant,
    ),
  );
}

export async function setOuiMeetingParticipantSpeakingOrder(
  state: OuiMeetingRoomUiState,
  participantId: string,
  speakingOrder: number,
) {
  const source = editableParticipants(state);
  const index = source.findIndex((participant) => participant.id === participantId);
  const targetIndex = Math.max(0, Math.min(source.length - 1, speakingOrder - 1));
  if (index < 0 || targetIndex === index) {
    return;
  }
  const reordered = source.slice();
  const [participant] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, participant);
  await updateMeetingParticipantsState(state, () => reordered);
}

export async function setOuiMeetingParticipantThinkingIntensity(
  state: OuiMeetingRoomUiState,
  participantId: string,
  thinkingIntensity: NonNullable<OuiMeetingParticipant["thinkingIntensity"]>,
) {
  await updateMeetingParticipantsState(state, (participants) =>
    participants.map((participant) =>
      participant.id === participantId ? { ...participant, thinkingIntensity } : participant,
    ),
  );
}

export async function createOuiMeeting(state: OuiMeetingRoomUiState) {
  const title = state.ouiMeetingTitleDraft.trim();
  if (!title) {
    state.ouiMeetingMessage = { kind: "error", text: ouiCompanyCopy("Meeting title is required.") };
    markChanged(state);
    return;
  }
  const participants = normalizeMeetingParticipants(state.ouiMeetingDraftParticipants);
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<MeetingCreateBody>("/meetings", {
      method: "POST",
      body: JSON.stringify({
        title,
        objective: state.ouiMeetingObjectiveDraft.trim() || null,
        participants,
      }),
    });
    const meetingId = body.meeting?.id;
    if (!meetingId) {
      throw new Error(ouiCompanyCopy("Meeting was not created."));
    }
    await reloadMeetings(state);
    await reloadMeetingDetail(state, meetingId);
    state.ouiMeetingTitleDraft = "";
    state.ouiMeetingObjectiveDraft = "";
    state.ouiMeetingInviteDialogOpen = false;
    state.ouiMeetingSettingsParticipantId = null;
    state.ouiMeetingDocumentDraft = body.meeting
      ? meetingDiscussion(body.meeting).activeDocument.text
      : "";
    state.ouiMeetingParticipantDraftId = "";
    state.ouiMeetingDraftParticipants = [];
    state.ouiMeetingMessage = {
      kind: "success",
      text: ouiCompanyCopy("Meeting created: {title}", { title: body.meeting?.title ?? title }),
    };
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}

export async function saveOuiMeetingDocument(state: OuiMeetingRoomUiState) {
  const meeting = selectedMeeting(state);
  const documentText = state.ouiMeetingDocumentDraft.trim();
  if (!meeting || !documentText) {
    return;
  }
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<MeetingDocumentBody>(
      `/meetings/${encodeURIComponent(meeting.id)}/document`,
      {
        method: "PUT",
        body: JSON.stringify({ document: documentText }),
      },
    );
    if (body.meeting) {
      applyMeetingDetail(state, {
        meeting: body.meeting,
        messages: state.ouiMeetingMessages,
        artifacts: state.ouiMeetingArtifacts,
      });
    }
    state.ouiMeetingMessage = {
      kind: "success",
      text: ouiCompanyCopy("Moderator document saved."),
    };
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}

export async function reviseOuiMeetingModerator(state: OuiMeetingRoomUiState) {
  const meeting = selectedMeeting(state);
  const instruction = state.ouiMeetingPromptDraft.trim();
  if (!meeting || !instruction) {
    return;
  }
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<MeetingDetailBody & { ownerMessage?: OuiMeetingMessageRecord }>(
      `/meetings/${encodeURIComponent(meeting.id)}/moderator/revise`,
      {
        method: "POST",
        body: JSON.stringify({ instruction }),
      },
    );
    if (body.meeting) {
      applyMeetingDetail(state, body);
    }
    state.ouiMeetingPromptDraft = "";
    state.ouiMeetingMessage = {
      kind: "success",
      text: ouiCompanyCopy("Moderator document updated."),
    };
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}

export async function runOuiMeetingNextRound(state: OuiMeetingRoomUiState) {
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    let meeting = selectedMeeting(state);
    let targetMeetingId = meeting?.id ?? null;
    console.warn("[oui-meeting] run-next-round:start", {
      selectedMeetingId: state.ouiSelectedMeetingId,
      targetMeetingId,
      titleDraft: state.ouiMeetingTitleDraft,
      objectiveDraft: state.ouiMeetingObjectiveDraft,
      draftParticipantIds: state.ouiMeetingDraftParticipants.map((participant) => participant.id),
    });
    if (!meeting) {
      const title = state.ouiMeetingTitleDraft.trim();
      if (!title) {
        state.ouiMeetingMessage = {
          kind: "error",
          text: ouiCompanyCopy("Meeting title is required."),
        };
        return;
      }
      const created = await fetchJson<MeetingCreateBody>("/meetings", {
        method: "POST",
        body: JSON.stringify({
          title,
          objective: state.ouiMeetingObjectiveDraft.trim() || null,
          participants: normalizeMeetingParticipants(state.ouiMeetingDraftParticipants),
        }),
      });
      const createdMeetingId = created.meeting?.id;
      if (!createdMeetingId) {
        throw new Error(ouiCompanyCopy("Meeting was not created."));
      }
      targetMeetingId = createdMeetingId;
      console.warn("[oui-meeting] run-next-round:created", {
        createdMeetingId,
      });
      await reloadMeetings(state);
      await reloadMeetingDetail(state, createdMeetingId);
      state.ouiMeetingTitleDraft = "";
      state.ouiMeetingObjectiveDraft = "";
      state.ouiMeetingInviteDialogOpen = false;
      state.ouiMeetingSettingsParticipantId = null;
      state.ouiMeetingParticipantDraftId = "";
      state.ouiMeetingDraftParticipants = [];
      meeting = selectedMeeting(state);
    }
    if (!targetMeetingId) {
      return;
    }
    console.warn("[oui-meeting] run-next-round:posting-round", {
      targetMeetingId,
    });
    let body: (MeetingDetailBody & { participantMessages?: OuiMeetingMessageRecord[] }) | null =
      null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        body = await fetchJson<
          MeetingDetailBody & { participantMessages?: OuiMeetingMessageRecord[] }
        >(`/meetings/${encodeURIComponent(targetMeetingId)}/rounds/next`, {
          method: "POST",
        });
        break;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "not_found" || attempt > 0) {
          throw error;
        }
        await reloadMeetings(state);
        if (state.ouiMeetings.some((entry) => entry.id === targetMeetingId)) {
          await reloadMeetingDetail(state, targetMeetingId);
        }
      }
    }
    if (!body) {
      throw new Error("not_found");
    }
    if (body.meeting) {
      applyMeetingDetail(state, body);
    }
    state.ouiMeetingMessage = {
      kind: "success",
      text: ouiCompanyCopy("Round {round} completed.", {
        round: String(
          (body.meeting
            ? meetingDiscussion(body.meeting).currentRound
            : meeting
              ? meetingDiscussion(meeting).currentRound
              : 1) || 1,
        ),
      }),
    };
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}

export async function startOuiMeeting(state: OuiMeetingRoomUiState, meetingId: string) {
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<MeetingCreateBody>(
      `/meetings/${encodeURIComponent(meetingId)}/start`,
      {
        method: "POST",
      },
    );
    if (body.meeting) {
      applyMeetingDetail(state, { meeting: body.meeting, messages: state.ouiMeetingMessages });
    }
    await reloadMeetings(state);
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}

export async function endOuiMeeting(state: OuiMeetingRoomUiState, meetingId: string) {
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<MeetingCreateBody>(
      `/meetings/${encodeURIComponent(meetingId)}/end`,
      {
        method: "POST",
      },
    );
    if (body.meeting) {
      applyMeetingDetail(state, { meeting: body.meeting, messages: state.ouiMeetingMessages });
    }
    await reloadMeetings(state);
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}

export async function sendOuiMeetingTurn(state: OuiMeetingRoomUiState) {
  const meetingId = state.ouiSelectedMeetingId;
  const prompt = state.ouiMeetingPromptDraft.trim();
  if (!meetingId || !prompt) {
    state.ouiMeetingMessage = {
      kind: "error",
      text: ouiCompanyCopy("Meeting prompt is required."),
    };
    markChanged(state);
    return;
  }
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    await fetchJson<MeetingTurnBody>(`/meetings/${encodeURIComponent(meetingId)}/turn`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    state.ouiMeetingPromptDraft = "";
    await reloadMeetings(state);
    await reloadMeetingDetail(state, meetingId);
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}

export async function generateOuiMeetingMinutes(state: OuiMeetingRoomUiState, meetingId: string) {
  state.ouiMeetingBusy = true;
  state.ouiMeetingMessage = null;
  markChanged(state);
  try {
    const body = await fetchJson<MeetingMinutesBody>(
      `/meetings/${encodeURIComponent(meetingId)}/minutes`,
      { method: "POST" },
    );
    if (body.meeting) {
      applyMeetingDetail(state, {
        meeting: body.meeting,
        messages: state.ouiMeetingMessages,
        artifacts: body.artifact
          ? [
              body.artifact,
              ...state.ouiMeetingArtifacts.filter((entry) => entry.id !== body.artifact?.id),
            ]
          : state.ouiMeetingArtifacts,
      });
    }
    state.ouiMeetingMessage = {
      kind: "success",
      text: ouiCompanyCopy("Meeting minutes generated: {title}", {
        title: body.artifact?.title ?? meetingId,
      }),
    };
    await reloadMeetings(state);
    await reloadMeetingDetail(state, meetingId);
  } catch (error) {
    state.ouiMeetingMessage = { kind: "error", text: formatError(error) };
  } finally {
    state.ouiMeetingBusy = false;
    markChanged(state);
  }
}
