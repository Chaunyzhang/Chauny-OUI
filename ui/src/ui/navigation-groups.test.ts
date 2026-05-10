import { describe, expect, it } from "vitest";
import { TAB_GROUPS, tabFromPath } from "./navigation.ts";

describe("TAB_GROUPS", () => {
  it("does not expose unfinished settings slices in the sidebar", () => {
    const settings = TAB_GROUPS.find((group) => group.label === "settings");
    expect(settings?.tabs).toEqual([
      "config",
      "communications",
      "appearance",
      "automation",
      "infrastructure",
      "aiAgents",
      "debug",
      "logs",
    ]);
  });

  it("routes every published settings slice", () => {
    expect(tabFromPath("/communications")).toBe("communications");
    expect(tabFromPath("/appearance")).toBe("appearance");
    expect(tabFromPath("/automation")).toBe("automation");
    expect(tabFromPath("/infrastructure")).toBe("infrastructure");
    expect(tabFromPath("/ai-agents")).toBe("aiAgents");
    expect(tabFromPath("/config")).toBe("config");
  });

  it("keeps OUI pages out of the original sidebar groups", () => {
    const allTabs = TAB_GROUPS.flatMap((group) => group.tabs);
    expect(allTabs).not.toContain("ouiOverview");
    expect(allTabs).not.toContain("ouiChat");
    expect(allTabs).not.toContain("setupWizard");
    expect(allTabs).not.toContain("modelManager");
    expect(allTabs).not.toContain("agentManager");
    expect(tabFromPath("/oui/overview")).toBe("ouiOverview");
    expect(tabFromPath("/oui/chat")).toBe("ouiChat");
    expect(tabFromPath("/oui/setup")).toBe("setupWizard");
    expect(tabFromPath("/oui/models")).toBe("modelManager");
    expect(tabFromPath("/oui/agents")).toBe("agentManager");
  });
});
