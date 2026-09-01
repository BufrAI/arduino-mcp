import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  formatCliResult,
  KNOWN_FQBNS,
  resolveArduinoCli,
  runArduinoCli,
} from "./arduino-cli.js";
import {
  DEFAULT_BAUD,
  getSerialStatus,
  serialClose,
  serialOpen,
  serialRead,
  serialWrite,
} from "./serial.js";
import { bufferToHex, crc8SelfTest, packTwist } from "./rattus.js";

function text(result: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: result }],
    isError,
  };
}

function cliText(result: Awaited<ReturnType<typeof runArduinoCli>>) {
  return text(formatCliResult(result), !result.ok);
}

const encodingSchema = z.enum(["utf8", "hex", "base64"]).default("utf8");

export function registerTools(server: McpServer): void {
  server.tool(
    "arduino_cli_version",
    "Confirm arduino-cli is available and report its version. Call this first to verify the toolchain before compile/upload.",
    {},
    async () => {
      try {
        const cliPath = resolveArduinoCli();
        const result = await runArduinoCli(["version"]);
        return text(
          [`resolvedCli: ${cliPath}`, formatCliResult(result), `knownFqbnHints: ${JSON.stringify(KNOWN_FQBNS)}`].join(
            "\n",
          ),
          !result.ok,
        );
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.tool(
    "list_ports",
    "List serial ports detected by arduino-cli (USB adapters, Uno, Portenta, etc.).",
    {},
    async () => {
      const result = await runArduinoCli(["board", "list"]);
      return cliText(result);
    },
  );

  server.tool(
    "board_list",
    "List connected boards with detected FQBN when possible. Alias-friendly companion to list_ports.",
    {
      discoveryTimeout: z
        .number()
        .int()
        .min(0)
        .max(60)
        .optional()
        .describe("Optional discovery timeout in seconds."),
    },
    async ({ discoveryTimeout }) => {
      const args = ["board", "list"];
      if (discoveryTimeout !== undefined) {
        args.push("--discovery-timeout", `${discoveryTimeout}s`);
      }
      const result = await runArduinoCli(args);
      return cliText(result);
    },
  );

  server.tool(
    "core_list",
    "List installed Arduino cores (platform packages), e.g. arduino:avr or arduino:mbed_portenta.",
    {},
    async () => {
      const result = await runArduinoCli(["core", "list"]);
      return cliText(result);
    },
  );

  server.tool(
    "core_install",
    "Install an Arduino core/platform by id. Examples: arduino:avr (Uno), arduino:mbed_portenta (Portenta H7).",
    {
      platformId: z
        .string()
        .min(1)
        .describe("Platform id such as arduino:avr or arduino:mbed_portenta"),
    },
    async ({ platformId }) => {
      // Update indexes first so fresh installs resolve packages.
      const update = await runArduinoCli(["core", "update-index"], { timeoutMs: 180_000 });
      if (!update.ok) {
        return text(`core update-index failed:\n${formatCliResult(update)}`, true);
      }
      const result = await runArduinoCli(["core", "install", platformId], {
        timeoutMs: 600_000,
      });
      return cliText(result);
    },
  );

  server.tool(
    "lib_search",
    "Search the Arduino Library Manager by query string.",
    {
      query: z.string().min(1).describe("Search terms, e.g. Servo or ArduinoJson"),
    },
    async ({ query }) => {
      const result = await runArduinoCli(["lib", "search", query]);
      return cliText(result);
    },
  );

  server.tool(
    "lib_install",
    "Install one or more Arduino libraries by name from Library Manager.",
    {
      libraries: z
        .array(z.string().min(1))
        .min(1)
        .describe("Library names as known to Library Manager"),
    },
    async ({ libraries }) => {
      const result = await runArduinoCli(["lib", "install", ...libraries], {
        timeoutMs: 300_000,
      });
      return cliText(result);
    },
  );

  server.tool(
    "compile",
    "Compile a sketch for a board FQBN without uploading. Use arduino:avr:uno for Uno or arduino:mbed_portenta:envie_m7 for Portenta H7.",
    {
      sketchPath: z
        .string()
        .min(1)
        .describe("Path to sketch folder or .ino file"),
      fqbn: z
        .string()
        .min(1)
        .describe("Fully Qualified Board Name, e.g. arduino:avr:uno"),
      buildPath: z
        .string()
        .optional()
        .describe("Optional build output directory"),
      libraries: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Path(s) to extra library folders (arduino-cli --libraries). For Ratchet use firmware/libraries.",
        ),
      clean: z
        .boolean()
        .optional()
        .describe("Clean build (recommended after Portenta link failures)"),
      verbose: z.boolean().optional().describe("Enable verbose compile output"),
    },
    async ({ sketchPath, fqbn, buildPath, libraries, clean, verbose }) => {
      const args = ["compile", "--fqbn", fqbn];
      if (buildPath) args.push("--build-path", buildPath);
      if (clean) args.push("--clean");
      if (verbose) args.push("--verbose");
      const libPaths = typeof libraries === "string" ? [libraries] : libraries;
      if (libPaths) {
        for (const lib of libPaths) {
          args.push("--libraries", lib);
        }
      }
      args.push(sketchPath);
      const result = await runArduinoCli(args, { timeoutMs: 600_000 });
      return cliText(result);
    },
  );

  server.tool(
    "upload",
    "Upload a sketch to a board on a serial port. Prefer compile first with libraries/buildPath, then pass the same buildPath as inputDir (upload does not accept --libraries).",
    {
      sketchPath: z.string().min(1).describe("Path to sketch folder or .ino file"),
      fqbn: z.string().min(1).describe("Fully Qualified Board Name"),
      port: z.string().min(1).describe("Serial port, e.g. COM3 or /dev/ttyACM0"),
      inputDir: z
        .string()
        .optional()
        .describe("Directory of prebuilt binaries from compile --build-path (skips recompile)"),
      verify: z.boolean().optional().describe("Verify flash after upload"),
      verbose: z.boolean().optional(),
    },
    async ({ sketchPath, fqbn, port, inputDir, verify, verbose }) => {
      const args = ["upload", "--fqbn", fqbn, "--port", port];
      if (inputDir) args.push("--input-dir", inputDir);
      if (verify) args.push("--verify");
      if (verbose) args.push("--verbose");
      args.push(sketchPath);
      const result = await runArduinoCli(args, { timeoutMs: 600_000 });
      return cliText(result);
    },
  );

  server.tool(
    "serial_open",
    "Open a serial port exclusively for read/write. Default baud is 115200 (Ratchet UART). Close any previous session first.",
    {
      path: z.string().min(1).describe("Serial port path, e.g. COM3"),
      baudRate: z
        .number()
        .int()
        .min(300)
        .max(2_000_000)
        .optional()
        .describe(`Baud rate (default ${DEFAULT_BAUD})`),
    },
    async ({ path, baudRate }) => {
      try {
        const opened = await serialOpen(path, baudRate ?? DEFAULT_BAUD);
        return text(JSON.stringify({ ...opened, status: getSerialStatus() }, null, 2));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.tool(
    "serial_read",
    "Read buffered bytes from the open serial port. Buffer is capped (~64KB) to protect agent context.",
    {
      maxBytes: z.number().int().min(1).max(65536).optional().describe("Max bytes to return"),
      encoding: encodingSchema.describe("How to encode returned bytes"),
    },
    async ({ maxBytes, encoding }) => {
      try {
        const result = serialRead({ maxBytes, encoding });
        return text(JSON.stringify(result, null, 2));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.tool(
    "serial_write",
    "Write data to the open serial port. Use hex/base64 for binary UART frames (e.g. Ratchet Phase 2.7).",
    {
      data: z.string().describe("Payload to send"),
      encoding: encodingSchema.describe("Encoding of data parameter"),
    },
    async ({ data, encoding }) => {
      try {
        const result = await serialWrite(data, encoding);
        return text(JSON.stringify(result, null, 2));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.tool(
    "serial_close",
    "Close the currently open serial port session.",
    {},
    async () => {
      try {
        await serialClose();
        return text(JSON.stringify({ closed: true, status: getSerialStatus() }, null, 2));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.tool(
    "serial_status",
    "Report whether a serial session is open and how many bytes are buffered.",
    {},
    async () => text(JSON.stringify(getSerialStatus(), null, 2)),
  );

  server.tool(
    "rattus_crc_self_test",
    "Verify host-side CRC-8/MAXIM matches firmware RattusUart (expect check vector 0xA1).",
    {},
    async () =>
      text(
        JSON.stringify(
          { ok: crc8SelfTest(), expect: "crc8Maxim('123456789') === 0xA1" },
          null,
          2,
        ),
        !crc8SelfTest(),
      ),
  );

  server.tool(
    "rattus_send_twist",
    "Phase 2.7 PC-masquerade: pack a CMD_TWIST frame (CRC-8/MAXIM) and write it to the open serial port (Uno USB). Requires serial_open first.",
    {
      vMmS: z.number().int().min(-2000).max(2000).describe("Linear velocity mm/s"),
      omegaMradS: z
        .number()
        .int()
        .min(-4000)
        .max(4000)
        .describe("Angular velocity mrad/s"),
      seq: z.number().int().min(0).max(255).optional().describe("Sequence byte (default auto-increment)"),
    },
    async ({ vMmS, omegaMradS, seq }) => {
      try {
        const useSeq = seq !== undefined ? seq : nextMasqueradeSeq();
        const frame = packTwist(useSeq, vMmS, omegaMradS);
        const written = await serialWrite(bufferToHex(frame), "hex");
        return text(
          JSON.stringify(
            {
              seq: useSeq,
              vMmS,
              omegaMradS,
              frameHex: bufferToHex(frame),
              ...written,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.tool(
    "rattus_heartbeat",
    "Send CMD_TWIST heartbeats at ~20 Hz for durationMs (Phase 2.7 soak / link-up). Uses open serial port.",
    {
      durationMs: z
        .number()
        .int()
        .min(100)
        .max(60_000)
        .default(3000)
        .describe("How long to stream heartbeats"),
      vMmS: z.number().int().default(0),
      omegaMradS: z.number().int().default(0),
      periodMs: z.number().int().min(20).max(500).default(50).describe("Frame period (50ms = 20 Hz)"),
    },
    async ({ durationMs, vMmS, omegaMradS, periodMs }) => {
      try {
        const started = Date.now();
        let sent = 0;
        while (Date.now() - started < durationMs) {
          const frame = packTwist(nextMasqueradeSeq(), vMmS, omegaMradS);
          await serialWrite(bufferToHex(frame), "hex");
          sent += 1;
          await sleep(periodMs);
        }
        return text(JSON.stringify({ sent, durationMs, periodMs, vMmS, omegaMradS }, null, 2));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  );
}

let masqueradeSeq = 0;
function nextMasqueradeSeq(): number {
  const s = masqueradeSeq & 0xff;
  masqueradeSeq = (masqueradeSeq + 1) & 0xff;
  return s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
