import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type {
  OuiArtifactRecord,
  OuiMeetingMessageRecord,
  OuiMeetingRecord,
} from "../../oui/shared/product-types.ts";
import type { OuiMeetingParticipantCandidate } from "../controllers/oui-meeting-room.ts";
import { renderOuiMeetingRoom, type OuiMeetingRoomProps } from "./oui-meeting-room.ts";

const now = "2026-05-11T09:00:00.000Z";

function meetingRecord(overrides: Partial<OuiMeetingRecord> = {}): OuiMeetingRecord {
  return {
    id: "meeting-1",
    title: "Strategy room",
    objective: "Discuss the product plan",
    status: "active",
    participants: [
      {
        id: "agent-alpha",
        label: "Alpha",
        adapterKind: "openclaw",
        adapterId: "openclaw-local",
        openclawAgentId: "alpha",
        modelRef: "alpha-model",
        role: "CEO",
        muted: false,
        speakingOrder: 1,
        thinkingIntensity: "medium",
      },
      {
        id: "agent-beta",
        label: "Beta",
        adapterKind: "claude",
        adapterId: "claude-local",
        modelRef: "beta-model",
        role: "Reviewer",
        muted: true,
        speakingOrder: 2,
        thinkingIntensity: "high",
      },
    ],
    discussion: {
      phase: "awaiting_user",
      currentRound: 2,
      activeDocument: {
        round: 2,
        text: "Round 2 moderator document",
        updatedAt: now,
        updatedBy: "moderator",
      },
      roundHistory: [],
    },
    minutesArtifactId: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    endedAt: null,
    ...overrides,
  };
}

function meetingMessage(overrides: Partial<OuiMeetingMessageRecord> = {}): OuiMeetingMessageRecord {
  return {
    id: "message-1",
    meetingId: "meeting-1",
    role: "participant",
    participantId: "agent-alpha",
    content: "Alpha view",
    metadata: {},
    createdAt: now,
    ...overrides,
  };
}

function artifactRecord(overrides: Partial<OuiArtifactRecord> = {}): OuiArtifactRecord {
  return {
    id: "artifact-1",
    companyId: null,
    meetingId: "meeting-1",
    runId: null,
    kind: "meeting_minutes",
    title: "Meeting minutes",
    summary: null,
    path: "docs/meeting.md",
    contentType: "text/markdown",
    content: {},
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function meetingCandidate(
  overrides: Partial<OuiMeetingParticipantCandidate> = {},
): OuiMeetingParticipantCandidate {
  return {
    id: "agent-alpha",
    label: "Alpha",
    adapterKind: "openclaw",
    adapterId: "openclaw-local",
    openclawAgentId: "alpha",
    modelRef: "alpha-model",
    ...overrides,
  };
}

function props(overrides: Partial<OuiMeetingRoomProps> = {}): OuiMeetingRoomProps {
  return {
    loading: false,
    busy: false,
    error: null,
    message: null,
    meetings: [meetingRecord()],
    selectedMeetingId: "meeting-1",
    messages: [
      meetingMessage({ id: "owner-1", role: "owner", participantId: null, content: "Owner asks" }),
      meetingMessage({ id: "alpha-1", participantId: "agent-alpha", content: "Alpha answers" }),
      meetingMessage({ id: "beta-1", participantId: "agent-beta", content: "Beta challenges" }),
      meetingMessage({
        id: "noise-1",
        participantId: "agent-alpha",
        content: "Run oui-meeting:meeting-1:round:1:agent-alpha finished with status running.",
      }),
    ],
    artifacts: [artifactRecord()],
    participantCandidates: [meetingCandidate()],
    titleDraft: "",
    objectiveDraft: "",
    inviteDialogOpen: false,
    settingsParticipantId: null,
    documentDraft: "Round 2 moderator document",
    participantDraftId: "",
    draftParticipants: [],
    promptDraft: "Next agenda item",
    onRefresh: vi.fn(),
    onSelectMeeting: vi.fn(),
    onTitleDraftChange: vi.fn(),
    onObjectiveDraftChange: vi.fn(),
    onParticipantDraftChange: vi.fn(),
    onOpenInviteDialog: vi.fn(),
    onCloseInviteDialog: vi.fn(),
    onOpenParticipantSettings: vi.fn(),
    onCloseParticipantSettings: vi.fn(),
    onAddParticipant: vi.fn(),
    onRemoveParticipant: vi.fn(),
    onToggleParticipantMuted: vi.fn(),
    onSetParticipantSpeakingOrder: vi.fn(),
    onSetParticipantThinkingIntensity: vi.fn(),
    onDocumentDraftChange: vi.fn(),
    onSaveDocument: vi.fn(),
    onReviseModeratorDocument: vi.fn(),
    onRunNextRound: vi.fn(),
    onCreateMeeting: vi.fn(),
    onPromptDraftChange: vi.fn(),
    onStartMeeting: vi.fn(),
    onEndMeeting: vi.fn(),
    onGenerateMinutes: vi.fn(),
    ...overrides,
  };
}

describe("OUI meeting room view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("uses the shared chat layout for the selected meeting", async () => {
    const container = document.createElement("div");
    render(renderOuiMeetingRoom(props()), container);
    await Promise.resolve();

    expect(container.querySelector(".oui-meeting-room__workspace")).toBeTruthy();
    expect(container.querySelector(".oui-meeting-room__sidebar")).toBeTruthy();
    expect(container.querySelector(".oui-meeting-room__management-module")).toBeTruthy();
    expect(container.querySelector(".oui-meeting-room__chat-card .chat")).toBeTruthy();
    expect(container.querySelector(".oui-meeting-room__chat-card .agent-chat__input")).toBeTruthy();
    expect(container.querySelector(".oui-meeting-room__chat-header")).toBeTruthy();
    expect(container.querySelector(".oui-company__ceo-composer")).toBeNull();
    expect(container.querySelector(".oui-company__meeting-log")).toBeNull();
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Beta");
    expect(container.textContent).toContain("Alpha answers");
    expect(container.textContent).toContain("Beta challenges");
    expect(container.textContent).not.toContain("finished with status running");
    expect(container.textContent).not.toContain("Owner asks");
    expect(container.textContent).toContain("Meeting minutes");
    expect(container.textContent).toContain("Agent management");
    expect(container.textContent).toContain("Moderator document");
    expect(container.textContent).toContain("Run next round");
    expect(container.textContent).toContain("Speaking order");
    expect(container.textContent).toContain("Mic off");
    expect(container.textContent).toContain("Settings");
    expect(container.textContent).toContain("High");
  });

  it("keeps meeting history available below an active meeting chat", async () => {
    const container = document.createElement("div");
    render(renderOuiMeetingRoom(props()), container);
    await Promise.resolve();

    expect(container.querySelector(".oui-meeting-room__management")).toBeTruthy();
    expect(container.textContent).toContain("Meeting history");
  });

  it("uses the chat layout for a new meeting before anything is selected", async () => {
    const container = document.createElement("div");
    render(
      renderOuiMeetingRoom(
        props({
          meetings: [],
          selectedMeetingId: null,
          messages: [],
          artifacts: [],
          documentDraft: "",
          titleDraft: "New strategy",
          objectiveDraft: "Discuss launch timing",
          draftParticipants: [meetingCandidate({ speakingOrder: 1, muted: false })],
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".oui-company__hero")).toBeNull();
    expect(container.querySelector(".oui-company__meeting-create")).toBeNull();
    expect(container.querySelector(".oui-meeting-room__workspace")).toBeTruthy();
    expect(container.querySelector(".oui-meeting-room__sidebar")).toBeTruthy();
    expect(container.querySelector(".oui-meeting-room__management-module")).toBeTruthy();
    expect(container.querySelector(".oui-meeting-room__chat-card .chat")).toBeTruthy();
    expect(container.querySelector(".oui-meeting-room__chat-card .agent-chat__input")).toBeTruthy();
    expect(container.textContent).toContain("New strategy");
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Create meeting");
    expect(
      (
        container.querySelector(
          ".oui-meeting-room__description-input",
        ) as HTMLTextAreaElement | null
      )?.value,
    ).toBe("Discuss launch timing");
    expect(container.textContent).toContain("Invite agent");
    expect(container.textContent).toContain("Moderator document");
    const startRoundButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Start round 1"),
    );
    expect(startRoundButton?.hasAttribute("disabled")).toBe(false);
  });

  it("renders the invite dialog when the chooser is open", async () => {
    const container = document.createElement("div");
    render(
      renderOuiMeetingRoom(
        props({
          meetings: [],
          selectedMeetingId: null,
          inviteDialogOpen: true,
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector("openclaw-modal-dialog")).toBeTruthy();
    expect(container.textContent).toContain("Invite selected agent");
  });

  it("renders the participant settings dialog when a card gear is open", async () => {
    const container = document.createElement("div");
    render(
      renderOuiMeetingRoom(
        props({
          settingsParticipantId: "agent-alpha",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector("openclaw-modal-dialog")).toBeTruthy();
    expect(container.textContent).toContain("Adjust agent meeting preferences.");
    expect(container.textContent).toContain("Thinking intensity");
    expect(container.textContent).toContain("Medium");
  });

  it("falls back when a legacy meeting is missing discussion state", async () => {
    const container = document.createElement("div");
    render(
      renderOuiMeetingRoom(
        props({
          meetings: [{ ...meetingRecord(), discussion: undefined as never }],
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Moderator document");
    expect(container.textContent).toContain("Start round 1");
  });
});
