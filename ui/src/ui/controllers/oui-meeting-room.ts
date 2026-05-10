import type {
  OuiArtifactRecord,
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
  ouiMeetingParticipantDraftId: string;
  ouiMeetingDraftParticipantIds: string[];
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

function clearSelectedMeeting(state: OuiMeetingRoomUiState) {
  state.ouiSelectedMeetingId = null;
  state.ouiMeetingMessages = [];
  state.ouiMeetingArtifacts = [];
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

export function addOuiMeetingDraftParticipant(state: OuiMeetingRoomUiState) {
  const fallbackId = resolveOuiMeetingParticipantCandidates(state.agentsList)[0]?.id ?? "";
  const rawCandidateId = state.ouiMeetingParticipantDraftId || fallbackId;
  const candidateId = rawCandidateId ? normalizeAgentId(rawCandidateId) : "";
  if (!candidateId || state.ouiMeetingDraftParticipantIds.includes(candidateId)) {
    return;
  }
  state.ouiMeetingDraftParticipantIds = [...state.ouiMeetingDraftParticipantIds, candidateId];
  markChanged(state);
}

export function removeOuiMeetingDraftParticipant(
  state: OuiMeetingRoomUiState,
  participantId: string,
) {
  state.ouiMeetingDraftParticipantIds = state.ouiMeetingDraftParticipantIds.filter(
    (id) => id !== participantId,
  );
  markChanged(state);
}

export async function createOuiMeeting(state: OuiMeetingRoomUiState) {
  const title = state.ouiMeetingTitleDraft.trim();
  if (!title) {
    state.ouiMeetingMessage = { kind: "error", text: ouiCompanyCopy("Meeting title is required.") };
    markChanged(state);
    return;
  }
  const candidates = resolveOuiMeetingParticipantCandidates(state.agentsList);
  const selectedIds = new Set(state.ouiMeetingDraftParticipantIds);
  const participants = candidates.filter((candidate) => selectedIds.has(candidate.id));
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
    state.ouiMeetingDraftParticipantIds = [];
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
