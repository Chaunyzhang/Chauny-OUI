import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openclaw/control-ui-config.json";
const DEFAULT_GATEWAY_PORT = 18789;

type OpenClawConfig = {
  gateway?: {
    port?: unknown;
    auth?: {
      mode?: unknown;
      token?: unknown;
    };
  };
};

type DevGatewayCandidate = {
  gatewayUrl: string;
  token?: string | null;
  configPath?: string;
};

type BootstrapConfig = Record<string, unknown>;

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveHomeDir(): string | null {
  return (
    normalizeOptionalString(process.env.USERPROFILE) ?? normalizeOptionalString(process.env.HOME)
  );
}

function pushPath(paths: string[], filePath: string | null | undefined) {
  const normalized = normalizeOptionalString(filePath);
  if (!normalized) {
    return;
  }
  paths.push(path.resolve(normalized));
}

function pushOpenClawConfigPathsFromHome(paths: string[], homeDir: string) {
  pushPath(paths, path.join(homeDir, ".openclaw", "openclaw.json"));
  try {
    const scanned = fs
      .readdirSync(homeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".openclaw"))
      .map((entry) => path.join(homeDir, entry.name, "openclaw.json"))
      .filter((filePath) => fs.existsSync(filePath))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    paths.push(...scanned);
  } catch {
    // Ignore unreadable home directories in dev.
  }
}

function listWslDistroNames(): string[] {
  const names = new Set(["Ubuntu", "Ubuntu-24.04", "Ubuntu-22.04", "Debian"]);
  try {
    const output = execFileSync("wsl.exe", ["-l", "-q"], {
      encoding: "utf16le",
      timeout: 2000,
      windowsHide: true,
    });
    for (const line of output.split(/\r?\n/)) {
      const name = line.trim().replace(/\0/g, "");
      if (name) {
        names.add(name);
      }
    }
  } catch {
    // WSL is optional; common distro names above cover the usual local setup.
  }
  return [...names];
}

function pushWslConfigPaths(paths: string[]) {
  const distroNames = listWslDistroNames();
  for (const root of ["\\\\wsl.localhost", "\\\\wsl$"]) {
    for (const distroName of distroNames) {
      const distroRoot = path.join(root, distroName);
      pushOpenClawConfigPathsFromHome(paths, path.join(distroRoot, "root"));
      const homeRoot = path.join(distroRoot, "home");
      let users: fs.Dirent[];
      try {
        users = fs.readdirSync(homeRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const user of users) {
        if (user.isDirectory()) {
          pushOpenClawConfigPathsFromHome(paths, path.join(homeRoot, user.name));
        }
      }
    }
  }
}

function resolveConfigPaths(): string[] {
  const paths: string[] = [];
  pushPath(paths, process.env.OPENCLAW_CONFIG_PATH ?? process.env.OPENCLAW_CONFIG);
  const openClawHome = normalizeOptionalString(process.env.OPENCLAW_HOME);
  if (openClawHome) {
    pushPath(paths, path.join(openClawHome, "openclaw.json"));
  }
  const home = resolveHomeDir();
  if (home) {
    pushOpenClawConfigPathsFromHome(paths, home);
  }
  pushWslConfigPaths(paths);

  return [...new Set(paths.filter((filePath) => fs.existsSync(filePath)))];
}

function readOpenClawConfig(filePath: string): OpenClawConfig | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as OpenClawConfig;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveGatewayPort(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(raw) || raw <= 0 || raw > 65535) {
    return null;
  }
  return raw;
}

function gatewayUrlFromPort(port: number): string {
  return `ws://127.0.0.1:${port}`;
}

function resolveConfiguredGatewayCandidate(
  filePath: string,
  envToken: string | null,
): DevGatewayCandidate | null {
  const config = readOpenClawConfig(filePath);
  if (!config) {
    return null;
  }
  const port = resolveGatewayPort(config.gateway?.port) ?? DEFAULT_GATEWAY_PORT;
  const token = envToken ?? normalizeOptionalString(config.gateway?.auth?.token);
  return {
    gatewayUrl: gatewayUrlFromPort(port),
    token,
    configPath: filePath,
  };
}

function resolveGatewayCandidates(): DevGatewayCandidate[] {
  const envToken = normalizeOptionalString(
    process.env.OPENCLAW_CONTROL_UI_GATEWAY_TOKEN ?? process.env.OPENCLAW_GATEWAY_TOKEN,
  );
  const envGatewayUrl = normalizeOptionalString(
    process.env.OPENCLAW_CONTROL_UI_GATEWAY_URL ?? process.env.OPENCLAW_GATEWAY_URL,
  );
  const envPort = resolveGatewayPort(
    process.env.OPENCLAW_CONTROL_UI_GATEWAY_PORT ?? process.env.OPENCLAW_GATEWAY_PORT,
  );
  const candidates: DevGatewayCandidate[] = [];
  if (envGatewayUrl) {
    candidates.push({ gatewayUrl: envGatewayUrl, token: envToken });
  }
  for (const filePath of resolveConfigPaths()) {
    const candidate = resolveConfiguredGatewayCandidate(filePath, envToken);
    if (candidate) {
      candidates.push(candidate);
    }
  }
  candidates.push({
    gatewayUrl: gatewayUrlFromPort(envPort ?? DEFAULT_GATEWAY_PORT),
    token: envToken,
  });

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.gatewayUrl}\0${candidate.token ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeHostHeader(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    return trimmed.slice(1, trimmed.indexOf("]"));
  }
  return trimmed.split(":")[0] ?? "";
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, "").replace(/\]$/, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

function mayReturnLocalDevAuth(req: IncomingMessage): boolean {
  if (process.env.OPENCLAW_CONTROL_UI_DEV_AUTH === "1") {
    return true;
  }
  return isLoopbackHost(normalizeHostHeader(req.headers.host ?? ""));
}

function gatewayBootstrapUrl(gatewayUrl: string): string | null {
  try {
    const url = new URL(gatewayUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = CONTROL_UI_BOOTSTRAP_CONFIG_PATH;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchGatewayBootstrapConfig(
  candidate: DevGatewayCandidate,
  includeAuth: boolean,
): Promise<BootstrapConfig | null> {
  const url = gatewayBootstrapUrl(candidate.gatewayUrl);
  if (!url) {
    return null;
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (includeAuth && candidate.token) {
    headers.Authorization = `Bearer ${candidate.token}`;
  }
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return null;
    }
    const parsed = (await res.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as BootstrapConfig)
      : null;
  } catch {
    return null;
  }
}

async function buildControlUiDevConfig(req: IncomingMessage): Promise<BootstrapConfig> {
  const includeAuth = mayReturnLocalDevAuth(req);
  const candidates = resolveGatewayCandidates();
  for (const candidate of candidates) {
    const upstream = await fetchGatewayBootstrapConfig(candidate, includeAuth);
    if (!upstream) {
      continue;
    }
    return {
      basePath: "/",
      assistantName: "",
      assistantAvatar: "",
      ...upstream,
      gatewayUrl: candidate.gatewayUrl,
      ...(includeAuth && candidate.token ? { token: candidate.token } : {}),
    };
  }

  const fallback = candidates[0];
  return {
    basePath: "/",
    assistantName: "",
    assistantAvatar: "",
    ...(fallback ? { gatewayUrl: fallback.gatewayUrl } : {}),
    ...(includeAuth && fallback?.token ? { token: fallback.token } : {}),
  };
}

export default defineConfig(() => {
  const envBase = process.env.OPENCLAW_CONTROL_UI_BASE_PATH?.trim();
  const base = envBase ? normalizeBase(envBase) : "./";
  return {
    base,
    publicDir: path.resolve(here, "public"),
    optimizeDeps: {
      include: ["lit/directives/repeat.js"],
    },
    build: {
      outDir: path.resolve(here, "../dist/control-ui"),
      emptyOutDir: true,
      sourcemap: true,
      // Keep CI/onboard logs clean; current control UI chunking is intentionally above 500 kB.
      chunkSizeWarningLimit: 1024,
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
    plugins: [
      {
        name: "control-ui-dev-stubs",
        configureServer(server) {
          server.middlewares.use("/__openclaw/control-ui-config.json", (req, res) => {
            res.setHeader("Content-Type", "application/json");
            void buildControlUiDevConfig(req).then(
              (config) => {
                res.end(JSON.stringify(config));
              },
              () => {
                res.end(
                  JSON.stringify({
                    basePath: "/",
                    assistantName: "",
                    assistantAvatar: "",
                  }),
                );
              },
            );
          });
        },
      },
    ],
  };
});
