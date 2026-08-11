import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 80_000;

export type CliResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
  cliPath: string;
};

function whichOnPath(bin: string): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(cmd, [bin], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) return null;
  const first = (result.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  return first && existsSync(first) ? first : null;
}

function absoluteCandidates(): string[] {
  const envPath = process.env.ARDUINO_CLI_PATH?.trim();
  const home = homedir();
  const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  const downloads = join(home, "Downloads");

  return [
    ...(envPath ? [envPath] : []),
    join(downloads, "arduino-cli_1.5.2-rc.1_Windows_64bit", "arduino-cli.exe"),
    join(downloads, "arduino-cli", "arduino-cli.exe"),
    join(
      localAppData,
      "Programs",
      "Arduino IDE",
      "resources",
      "app",
      "lib",
      "backend",
      "resources",
      "arduino-cli.exe",
    ),
    join(home, "bin", "arduino-cli.exe"),
    join(home, "bin", "arduino-cli"),
    "/usr/local/bin/arduino-cli",
    "/opt/homebrew/bin/arduino-cli",
  ];
}

let cachedCliPath: string | null = null;

/** Resolve arduino-cli binary. Prefers ARDUINO_CLI_PATH, then known installs, then PATH. */
export function resolveArduinoCli(): string {
  if (cachedCliPath && existsSync(cachedCliPath)) {
    return cachedCliPath;
  }

  for (const candidate of absoluteCandidates()) {
    if (existsSync(candidate)) {
      cachedCliPath = candidate;
      return candidate;
    }
  }

  const fromPath =
    whichOnPath(process.platform === "win32" ? "arduino-cli.exe" : "arduino-cli") ??
    whichOnPath("arduino-cli");
  if (fromPath) {
    cachedCliPath = fromPath;
    return fromPath;
  }

  throw new Error(
    "arduino-cli not found. Install Arduino CLI, add it to PATH, or set ARDUINO_CLI_PATH to the executable.",
  );
}

export function resetCliPathCache(): void {
  cachedCliPath = null;
}

function truncate(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

/**
 * Run arduino-cli with an explicit argv array (never shell-interpolated).
 */
export async function runArduinoCli(
  args: string[],
  options?: { timeoutMs?: number; cwd?: string },
): Promise<CliResult> {
  const cliPath = resolveArduinoCli();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawn(cliPath, args, {
      cwd: options?.cwd,
      env: process.env,
      windowsHide: true,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        exitCode: null,
        stdout: truncate(stdout),
        stderr: truncate(`${stderr}\n[timeout after ${timeoutMs}ms]`),
        command: cliPath,
        args,
        cliPath,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const hint =
        err.code === "ENOENT"
          ? " Binary not found — set ARDUINO_CLI_PATH or install arduino-cli on PATH."
          : "";
      resolve({
        ok: false,
        exitCode: null,
        stdout: truncate(stdout),
        stderr: truncate(`${err.message}.${hint}`),
        command: cliPath,
        args,
        cliPath,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        command: cliPath,
        args,
        cliPath,
      });
    });
  });
}

export function formatCliResult(result: CliResult): string {
  const lines = [
    `cli: ${result.cliPath}`,
    `argv: ${JSON.stringify([result.command, ...result.args])}`,
    `exitCode: ${result.exitCode ?? "null"}`,
    `ok: ${result.ok}`,
  ];
  if (result.stdout.trim()) {
    lines.push("--- stdout ---", result.stdout.trimEnd());
  }
  if (result.stderr.trim()) {
    lines.push("--- stderr ---", result.stderr.trimEnd());
  }
  return lines.join("\n");
}

/** Well-known FQBNs useful for Ratchet and common boards. */
export const KNOWN_FQBNS = {
  uno: "arduino:avr:uno",
  portenta_h7: "arduino:mbed_portenta:envie_m7",
} as const;
