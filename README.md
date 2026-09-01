# arduino-mcp

![License](https://img.shields.io/github/license/BufrAI/arduino-mcp) ![Release](https://img.shields.io/github/v/tag/BufrAI/arduino-mcp?label=release) ![Node](https://img.shields.io/badge/node-%3E%3D20-blue)

Local **stdio** MCP server that wraps [`arduino-cli`](https://arduino.github.io/arduino-cli/) so agents can detect boards, manage cores/libraries, compile/upload sketches, and talk serial — without shell gymnastics.

Built as a **standalone** package (reuse across projects). Designed with Ratchet (a companion robotics project) in mind — Uno + Portenta, 115200 UART — but not coupled to that firmware tree.

## Prerequisites

1. **Node.js 20+**
2. **Arduino CLI** on your machine:
   - Standalone `arduino-cli` on `PATH`, **or**
   - Arduino IDE 2.x (this server auto-detects the IDE-bundled `arduino-cli.exe` on Windows), **or**
   - Set `ARDUINO_CLI_PATH` to the executable

Optional boards for Ratchet:

| Board | Core to install | FQBN |
|-------|-----------------|------|
| Arduino Uno | `arduino:avr` | `arduino:avr:uno` |
| Portenta H7 | `arduino:mbed_portenta` | `arduino:mbed_portenta:envie_m7` |

> **Portenta note:** OpenMV firmware and the Arduino Mbed core overwrite each other. Switching is deliberate — use MCP `upload` only when you intend to be on the Arduino core.

## Install

```bash
cd arduino-mcp
npm install
npm run build
```

## Tools

| Tool | Purpose |
|------|---------|
| `arduino_cli_version` | Health check + resolved CLI path |
| `list_ports` / `board_list` | Detect connected boards / ports |
| `core_list` / `core_install` | List/install platforms |
| `lib_search` / `lib_install` | Library Manager |
| `compile` | Build a sketch for an FQBN |
| `upload` | Flash a board on a port |
| `serial_open` / `serial_read` / `serial_write` / `serial_close` / `serial_status` | Serial I/O (default baud **115200**) |

Serial buffers are capped (~64KB). Prefer `hex` encoding for binary UART frames.

## Cursor / Claude Desktop (stdio)

**Do not add this to Cursor until you have run a local smoke test and explicitly approve the MCP config** (local serial + upload access).

Example Cursor MCP entry (user-level or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "arduino": {
      "command": "node",
      "args": ["C:/Users/YOU/CursorProjects/arduino-mcp/dist/index.js"],
      "env": {
        "ARDUINO_CLI_PATH": "C:/Users/YOU/Downloads/arduino-cli_1.5.2-rc.1_Windows_64bit/arduino-cli.exe"
      }
    }
  }
}
```

Omit `ARDUINO_CLI_PATH` if the IDE-bundled CLI is enough or `arduino-cli` is on `PATH`.

Dev without build:

```json
{
  "command": "npx",
  "args": ["tsx", "C:/Users/YOU/CursorProjects/arduino-mcp/src/index.ts"]
}
```

## Smoke test

```bash
npm run smoke
```

With a board plugged in:

```powershell
$env:SMOKE_UPLOAD_PORT = "COM3"   # your port from board list
npm run smoke
```

The smoke script compiles `examples/Blink` for `arduino:avr:uno` (installs the AVR core if missing). Upload is optional.

## Example agent flow (Uno blink)

1. `arduino_cli_version`
2. `core_install` → `arduino:avr` (once)
3. `board_list` → note `COMx`
4. `compile` → sketch `examples/Blink`, fqbn `arduino:avr:uno`
5. `upload` → same sketch/fqbn + port
6. `serial_open` → port, baud `115200`
7. `serial_read` → expect `blink-high` / `blink-low` lines
8. `serial_close`

## Security notes

- All `arduino-cli` invocations use `spawn` with an argv array (no shell interpolation).
- This server can **flash firmware** and **open serial ports** on your machine — treat it as a privileged local tool.
- Prefer absolute sketch paths from trusted projects.

## License

Apache-2.0
