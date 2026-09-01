import { SerialPort } from "serialport";

const MAX_BUFFER_BYTES = 64 * 1024;
const DEFAULT_BAUD = 115200;

type OpenSession = {
  portPath: string;
  baudRate: number;
  port: SerialPort;
  buffer: Buffer[];
  totalBytes: number;
};

let session: OpenSession | null = null;

function trimBuffer(sess: OpenSession): void {
  while (sess.totalBytes > MAX_BUFFER_BYTES && sess.buffer.length > 0) {
    const dropped = sess.buffer.shift();
    if (dropped) sess.totalBytes -= dropped.length;
  }
}

export function getSerialStatus(): {
  open: boolean;
  path?: string;
  baudRate?: number;
  bufferedBytes?: number;
} {
  if (!session) return { open: false };
  return {
    open: true,
    path: session.portPath,
    baudRate: session.baudRate,
    bufferedBytes: session.totalBytes,
  };
}

export async function serialOpen(
  path: string,
  baudRate = DEFAULT_BAUD,
): Promise<{ path: string; baudRate: number }> {
  if (session) {
    if (session.portPath === path && session.baudRate === baudRate && session.port.isOpen) {
      return { path: session.portPath, baudRate: session.baudRate };
    }
    await serialClose();
  }

  const port = new SerialPort({
    path,
    baudRate,
    autoOpen: false,
  });

  await new Promise<void>((resolve, reject) => {
    port.open((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const sess: OpenSession = {
    portPath: path,
    baudRate,
    port,
    buffer: [],
    totalBytes: 0,
  };

  port.on("data", (chunk: Buffer) => {
    sess.buffer.push(Buffer.from(chunk));
    sess.totalBytes += chunk.length;
    trimBuffer(sess);
  });

  port.on("close", () => {
    if (session?.port === port) {
      session = null;
    }
  });

  session = sess;
  return { path, baudRate };
}

export async function serialClose(): Promise<void> {
  if (!session) return;
  const { port } = session;
  session = null;
  if (!port.isOpen) return;
  await new Promise<void>((resolve, reject) => {
    port.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function serialRead(options?: {
  maxBytes?: number;
  encoding?: "utf8" | "hex" | "base64";
}): { bytes: number; encoding: string; data: string; remainingBuffered: number } {
  if (!session) {
    throw new Error("No serial port open. Call serial_open first.");
  }

  const maxBytes = options?.maxBytes ?? 4096;
  const encoding = options?.encoding ?? "utf8";
  const chunks: Buffer[] = [];
  let taken = 0;

  while (session.buffer.length > 0 && taken < maxBytes) {
    const next = session.buffer[0]!;
    const room = maxBytes - taken;
    if (next.length <= room) {
      session.buffer.shift();
      session.totalBytes -= next.length;
      chunks.push(next);
      taken += next.length;
    } else {
      chunks.push(next.subarray(0, room));
      session.buffer[0] = next.subarray(room);
      session.totalBytes -= room;
      taken += room;
    }
  }

  const payload = Buffer.concat(chunks, taken);
  let data: string;
  switch (encoding) {
    case "hex":
      data = payload.toString("hex");
      break;
    case "base64":
      data = payload.toString("base64");
      break;
    case "utf8":
      data = payload.toString("utf8");
      break;
    default: {
      const _exhaustive: never = encoding;
      throw new Error(`Unsupported encoding: ${_exhaustive}`);
    }
  }

  return {
    bytes: taken,
    encoding,
    data,
    remainingBuffered: session.totalBytes,
  };
}

export async function serialWrite(
  data: string,
  encoding: "utf8" | "hex" | "base64" = "utf8",
): Promise<{ bytesWritten: number }> {
  if (!session || !session.port.isOpen) {
    throw new Error("No serial port open. Call serial_open first.");
  }

  let buf: Buffer;
  switch (encoding) {
    case "hex": {
      const cleaned = data.replace(/\s+/g, "");
      if (cleaned.length % 2 !== 0) {
        throw new Error("hex payload must have an even number of digits");
      }
      buf = Buffer.from(cleaned, "hex");
      break;
    }
    case "base64":
      buf = Buffer.from(data, "base64");
      break;
    case "utf8":
      buf = Buffer.from(data, "utf8");
      break;
    default: {
      const _exhaustive: never = encoding;
      throw new Error(`Unsupported encoding: ${_exhaustive}`);
    }
  }

  await new Promise<void>((resolve, reject) => {
    session!.port.write(buf, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    session!.port.drain((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  return { bytesWritten: buf.length };
}

export { DEFAULT_BAUD };
