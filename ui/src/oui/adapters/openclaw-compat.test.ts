import { describe, expect, it } from "vitest";
import type { GatewayHelloOk } from "../../ui/gateway.ts";
import {
  buildOpenClawCompatSnapshot,
  describeOpenClawCompatGap,
  shouldAutoProbeOpenClawCapability,
} from "./openclaw-compat.ts";

function createHello(methods?: string[], events?: string[]): GatewayHelloOk {
  return {
    type: "hello-ok",
    protocol: 4,
    server: { version: "2026.5.8", connId: "conn_1" },
    auth: { role: "operator", scopes: ["operator.read"] },
    features: { methods, events },
  };
}

describe("OpenClaw compatibility snapshot", () => {
  it("records available methods and keeps expensive inventory manual-only", () => {
    const snapshot = buildOpenClawCompatSnapshot(
      createHello(
        [
          "chat.send",
          "chat.abort",
          "models.list",
          "agents.list",
          "sessions.usage",
          "usage.cost",
          "node.list",
          "device.pair.list",
        ],
        ["chat"],
      ),
    );

    expect(snapshot.adapterCapabilities.execute).toBe("available");
    expect(snapshot.adapterCapabilities.cancel).toBe("available");
    expect(snapshot.adapterCapabilities.streamEvents).toBe("available");
    expect(snapshot.capabilities.manualUsageQuery.state).toBe("manual");
    expect(snapshot.capabilities.nodeList.manualOnly).toBe(true);
    expect(snapshot.capabilities.devicePairList.manualOnly).toBe(true);
    expect(shouldAutoProbeOpenClawCapability("manualUsageQuery")).toBe(false);
    expect(shouldAutoProbeOpenClawCapability("nodeList")).toBe(false);
    expect(shouldAutoProbeOpenClawCapability("chatSend")).toBe(true);
  });

  it("uses unknown instead of optimistic probing when older Gateway omits feature lists", () => {
    const snapshot = buildOpenClawCompatSnapshot(createHello(undefined, undefined));

    expect(snapshot.methodsKnown).toBe(false);
    expect(snapshot.capabilities.chatSend.state).toBe("unknown");
    expect(describeOpenClawCompatGap(snapshot, "chatSend")).toContain("did not advertise");
  });

  it("marks usage missing unless both sessions and cost endpoints are available", () => {
    const snapshot = buildOpenClawCompatSnapshot(createHello(["sessions.usage"], []));

    expect(snapshot.capabilities.manualUsageQuery.state).toBe("missing");
    expect(describeOpenClawCompatGap(snapshot, "manualUsageQuery")).toContain("missing");
  });
});
