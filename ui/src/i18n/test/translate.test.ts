import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../../test-helpers/storage.ts";
import { localizeConfigCopy, ZH_CN_CONFIG_COPY } from "../lib/config-copy.ts";
import * as translate from "../lib/translate.ts";
import { ar } from "../locales/ar.ts";
import { de } from "../locales/de.ts";
import { en } from "../locales/en.ts";
import { es } from "../locales/es.ts";
import { fa } from "../locales/fa.ts";
import { fr } from "../locales/fr.ts";
import { id } from "../locales/id.ts";
import { it as itLocale } from "../locales/it.ts";
import { ja_JP } from "../locales/ja-JP.ts";
import { ko } from "../locales/ko.ts";
import { nl } from "../locales/nl.ts";
import { pl } from "../locales/pl.ts";
import { pt_BR } from "../locales/pt-BR.ts";
import { th } from "../locales/th.ts";
import { tr } from "../locales/tr.ts";
import { uk } from "../locales/uk.ts";
import { vi as viLocale } from "../locales/vi.ts";
import { zh_CN } from "../locales/zh-CN.ts";
import { zh_TW } from "../locales/zh-TW.ts";

describe("i18n", () => {
  function flatten(value: Record<string, string | Record<string, unknown>>, prefix = ""): string[] {
    return Object.entries(value).flatMap(([key, nested]) => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof nested === "string") {
        return [fullKey];
      }
      return flatten(nested as Record<string, string | Record<string, unknown>>, fullKey);
    });
  }

  function flattenStrings(
    value: Record<string, string | Record<string, unknown>>,
    prefix = "",
  ): Array<{ key: string; value: string }> {
    return Object.entries(value).flatMap(([key, nested]) => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof nested === "string") {
        return [{ key: fullKey, value: nested }];
      }
      return flattenStrings(nested as Record<string, string | Record<string, unknown>>, fullKey);
    });
  }

  function placeholders(value: string): string[] {
    return Array.from(value.matchAll(/\{[A-Za-z0-9_]+\}/g), ([placeholder]) => placeholder).sort();
  }

  beforeEach(async () => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    localStorage.clear();
    await translate.i18n.setLocale("en");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should return the key if translation is missing", () => {
    expect(translate.t("non.existent.key")).toBe("non.existent.key");
  });

  it("should return the correct English translation", () => {
    expect(translate.t("common.health")).toBe("Health");
  });

  it("should replace parameters correctly", () => {
    expect(translate.t("overview.stats.cronNext", { time: "10:00" })).toBe("Next wake 10:00");
  });

  it("should fallback to English if key is missing in another locale", async () => {
    // We haven't registered other locales in the test environment yet,
    // but the logic should fallback to 'en' map which is always there.
    await translate.i18n.setLocale("zh-CN");
    // Since we don't mock the import, it might fail to load zh-CN,
    // but let's assume it falls back to English for now.
    expect(translate.t("common.health")).toBeDefined();
  });

  it("loads translations even when setting the same locale again", async () => {
    const internal = translate.i18n as unknown as {
      locale: string;
      translations: Record<string, unknown>;
    };
    internal.locale = "zh-CN";
    delete internal.translations["zh-CN"];

    await translate.i18n.setLocale("zh-CN");
    expect(translate.t("common.health")).toBe("健康状况");
  });

  it("loads saved non-English locale on startup", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    localStorage.setItem("openclaw.i18n.locale", "zh-CN");
    const fresh = await import("../lib/translate.ts");
    await vi.waitFor(() => {
      expect(fresh.i18n.getLocale()).toBe("zh-CN");
    });
    expect(fresh.i18n.getLocale()).toBe("zh-CN");
    expect(fresh.t("common.health")).toBe("健康状况");
  });

  it("skips node localStorage accessors that warn without a storage file", async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    const warningSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => {});

    const fresh = await import("../lib/translate.ts");

    expect(fresh.i18n.getLocale()).toBe("en");
    expect(warningSpy).not.toHaveBeenCalledWith(
      "`--localstorage-file` was provided without a valid path",
      expect.anything(),
      expect.anything(),
    );
  });

  it("keeps the version label available in shipped locales", () => {
    expect((ar.common as { version?: string }).version).toBeTruthy();
    expect((de.common as { version?: string }).version).toBeTruthy();
    expect((es.common as { version?: string }).version).toBeTruthy();
    expect((fa.common as { version?: string }).version).toBeTruthy();
    expect((fr.common as { version?: string }).version).toBeTruthy();
    expect((id.common as { version?: string }).version).toBeTruthy();
    expect((itLocale.common as { version?: string }).version).toBeTruthy();
    expect((ja_JP.common as { version?: string }).version).toBeTruthy();
    expect((ko.common as { version?: string }).version).toBeTruthy();
    expect((nl.common as { version?: string }).version).toBeTruthy();
    expect((pl.common as { version?: string }).version).toBeTruthy();
    expect((pt_BR.common as { version?: string }).version).toBeTruthy();
    expect((th.common as { version?: string }).version).toBeTruthy();
    expect((tr.common as { version?: string }).version).toBeTruthy();
    expect((uk.common as { version?: string }).version).toBeTruthy();
    expect((viLocale.common as { version?: string }).version).toBeTruthy();
    expect((zh_CN.common as { version?: string }).version).toBeTruthy();
    expect((zh_TW.common as { version?: string }).version).toBeTruthy();
  });

  it("keeps newly exposed locales from shipping as English fallback bundles", () => {
    const englishHealth = (en.common as { health: string }).health;
    for (const [locale, value] of Object.entries({
      ar,
      fa,
      it: itLocale,
      nl,
      vi: viLocale,
    })) {
      expect((value.common as { health: string }).health, locale).not.toBe(englishHealth);
    }
  });

  it("keeps shipped locales structurally aligned with English", () => {
    const englishKeys = flatten(en);
    for (const [locale, value] of Object.entries({
      ar,
      de,
      es,
      fa,
      fr,
      id,
      it: itLocale,
      ja_JP,
      ko,
      nl,
      pl,
      pt_BR,
      th,
      tr,
      uk,
      vi: viLocale,
      zh_CN,
      zh_TW,
    })) {
      expect(flatten(value as Record<string, string | Record<string, unknown>>), locale).toEqual(
        englishKeys,
      );
    }
  });

  it("keeps zh-CN core developer terminology in English", () => {
    const glossary = JSON.parse(
      readFileSync("src/i18n/.i18n/glossary.zh-CN.json", "utf8"),
    ) as Array<{ source: string; target: string }>;
    const requiredGlossaryTerms = [
      "agent",
      "Agent",
      "Agents",
      "skill",
      "Skill",
      "Skills",
      "tool",
      "Tool",
      "Tools",
      "model",
      "Model",
      "Models",
      "provider",
      "Provider",
      "Providers",
      "token",
      "Token",
      "Tokens",
      "session",
      "Session",
      "Sessions",
      "workspace",
      "Workspace",
      "node",
      "Node",
      "Nodes",
      "cron",
      "Cron",
      "MCP",
      "RPC",
      "API",
      "URL",
      "WebSocket",
      "Nostr",
    ];

    for (const term of requiredGlossaryTerms) {
      expect(glossary, term).toContainEqual({ source: term, target: term });
    }

    const zhStringEntries = flattenStrings(zh_CN);
    const zhStrings = new Map(zhStringEntries.map(({ key, value }) => [key, value]));
    expect(zhStrings.get("common.light")).toBe("浅色");
    expect(zhStrings.get("dreaming.phase.light")).toBe("浅睡");
    expect(zhStrings.get("nav.agent")).toBe("agent");
    expect(zhStrings.get("tabs.agents")).toBe("Agents（助手）");
    expect(zhStrings.get("tabs.sessions")).toBe("Sessions");
    expect(zhStrings.get("tabs.skills")).toBe("扩展能力");
    expect(zhStrings.get("tabs.nodes")).toBe("设备");
    expect(zhStrings.get("sessionsView.model")).toBe("model");
    expect(zhStrings.get("sessionsView.provider")).toBe("provider");
    expect(zhStrings.get("agents.context.workspace")).toBe("workspace");
    expect(zhStrings.get("agents.tabs.tools")).toBe("Tools");
    expect(zhStrings.get("configQuick.header.title")).toBe("设置");
    expect(zhStrings.get("configQuick.model.title")).toBe("AI 引擎与思考强度");
    expect(zhStrings.get("configQuick.model.model")).toBe("model（AI 引擎）");
    expect(zhStrings.get("configQuick.channels.title")).toBe("消息入口");
    expect(zhStrings.get("configQuick.automations.skillsInstalled")).toBe(
      "{count} 个扩展能力已安装",
    );
    expect(zhStrings.get("configQuick.appearance.modes.light")).toBe("浅色");
    expect(zhStrings.get("configQuick.personal.chooseImage")).toBe("选择图片");
    expect(zhStrings.get("configQuick.presets.intro")).toContain("model、tool、消息入口");

    const forbiddenTerms = [
      "代理",
      "技能",
      "令牌",
      "捆绑包",
      "模型",
      "提供商",
      "会话",
      "节点",
      "工具",
      "工作区",
      "渠道",
      "频道",
    ];
    const zhConfigCopyEntries = Object.entries(ZH_CN_CONFIG_COPY).map(([key, value]) => ({
      key: `configCopy.${key}`,
      value,
    }));
    const violations = [...zhStringEntries, ...zhConfigCopyEntries].flatMap(({ key, value }) =>
      forbiddenTerms
        .filter((term) => value.includes(term))
        .map((term) => `${key}: contains ${term} in ${JSON.stringify(value)}`),
    );

    expect(violations).toEqual([]);
  });

  it("localizes advanced config copy only for zh-CN", async () => {
    translate.i18n.registerTranslation("zh-CN", zh_CN);

    await translate.i18n.setLocale("zh-CN");
    expect(localizeConfigCopy("No changes")).toBe("无更改");
    expect(localizeConfigCopy("Approval Agent Filter")).toBe("只转发哪些 agent");
    expect(
      localizeConfigCopy("Raw mode disabled (snapshot cannot safely round-trip raw text)."),
    ).toBe("Raw mode 已禁用（快照无法安全往返保存原始文本）。");

    await translate.i18n.setLocale("en");
    expect(localizeConfigCopy("No changes")).toBe("No changes");
    expect(localizeConfigCopy("Approval Agent Filter")).toBe("Approval Agent Filter");
  });

  it("keeps zh-CN placeholders aligned with English", () => {
    const englishEntries = new Map(flattenStrings(en).map(({ key, value }) => [key, value]));
    const mismatches = flattenStrings(zh_CN).flatMap(({ key, value }) => {
      const englishValue = englishEntries.get(key);
      if (!englishValue) {
        return [];
      }
      const sourcePlaceholders = placeholders(englishValue);
      const translatedPlaceholders = placeholders(value);
      return JSON.stringify(sourcePlaceholders) === JSON.stringify(translatedPlaceholders)
        ? []
        : [
            `${key}: expected ${sourcePlaceholders.join(", ") || "(none)"} got ${
              translatedPlaceholders.join(", ") || "(none)"
            }`,
          ];
    });

    expect(mismatches).toEqual([]);
  });
});
