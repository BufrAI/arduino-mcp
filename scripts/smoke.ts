/**
 * Smoke test: resolve CLI → version → board list → compile Blink for Uno.
 * Does not upload unless SMOKE_UPLOAD_PORT is set (e.g. COM3).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatCliResult,
  resolveArduinoCli,
  runArduinoCli,
  KNOWN_FQBNS,
} from "../src/arduino-cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sketchPath = join(__dirname, "..", "examples", "Blink");

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`\n== ${name} ==\n`);
  await fn();
}

async function main(): Promise<void> {
  let failed = false;

  await step("resolve arduino-cli", async () => {
    const path = resolveArduinoCli();
    console.log(path);
  });

  await step("version", async () => {
    const result = await runArduinoCli(["version"]);
    console.log(formatCliResult(result));
    if (!result.ok) failed = true;
  });

  await step("board list", async () => {
    const result = await runArduinoCli(["board", "list"]);
    console.log(formatCliResult(result));
    // Empty board list still exits 0; treat any non-zero as fail.
    if (!result.ok) failed = true;
  });

  await step("core list", async () => {
    const result = await runArduinoCli(["core", "list"]);
    console.log(formatCliResult(result));
    if (!result.ok) failed = true;
  });

  // Ensure AVR core for Uno compile smoke.
  const cores = await runArduinoCli(["core", "list"]);
  if (cores.ok && !cores.stdout.includes("arduino:avr")) {
    await step("core update-index + install arduino:avr", async () => {
      const update = await runArduinoCli(["core", "update-index"], { timeoutMs: 180_000 });
      console.log(formatCliResult(update));
      if (!update.ok) {
        failed = true;
        return;
      }
      const install = await runArduinoCli(["core", "install", "arduino:avr"], {
        timeoutMs: 600_000,
      });
      console.log(formatCliResult(install));
      if (!install.ok) failed = true;
    });
  }

  await step(`compile Blink (${KNOWN_FQBNS.uno})`, async () => {
    const result = await runArduinoCli(
      ["compile", "--fqbn", KNOWN_FQBNS.uno, sketchPath],
      { timeoutMs: 300_000 },
    );
    console.log(formatCliResult(result));
    if (!result.ok) failed = true;
  });

  const uploadPort = process.env.SMOKE_UPLOAD_PORT?.trim();
  if (uploadPort) {
    await step(`upload Blink → ${uploadPort}`, async () => {
      const result = await runArduinoCli(
        ["upload", "--fqbn", KNOWN_FQBNS.uno, "--port", uploadPort, sketchPath],
        { timeoutMs: 300_000 },
      );
      console.log(formatCliResult(result));
      if (!result.ok) failed = true;
    });
  } else {
    console.log("\n(skip upload — set SMOKE_UPLOAD_PORT to flash a connected board)");
  }

  if (failed) {
    console.error("\nSMOKE FAILED");
    process.exit(1);
  }
  console.log("\nSMOKE OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
