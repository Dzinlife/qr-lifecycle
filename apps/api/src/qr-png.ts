import QRCode from "qrcode";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const DARK = [23, 32, 28] as const;
const LIGHT = [255, 255, 255] as const;

function uint32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value >>> 0);
  return result;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  return concat([uint32(data.byteLength), typeBytes, data, uint32(crc32(concat([typeBytes, data])))]);
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const compressed = new Blob([new Uint8Array(bytes).buffer])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/** Renders a QR matrix as an RGB PNG without Canvas or native image libraries. */
export async function renderQrPng(value: string): Promise<Uint8Array<ArrayBuffer>> {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const margin = 3;
  const scale = 16;
  const size = (qr.modules.size + margin * 2) * scale;
  const stride = 1 + size * 3;
  const scanlines = new Uint8Array(stride * size);

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * stride;
    scanlines[rowOffset] = 0;
    const moduleY = Math.floor(y / scale) - margin;
    for (let x = 0; x < size; x += 1) {
      const moduleX = Math.floor(x / scale) - margin;
      const dark = moduleX >= 0
        && moduleY >= 0
        && moduleX < qr.modules.size
        && moduleY < qr.modules.size
        && qr.modules.get(moduleY, moduleX) === 1;
      const color = dark ? DARK : LIGHT;
      const pixelOffset = rowOffset + 1 + x * 3;
      scanlines[pixelOffset] = color[0];
      scanlines[pixelOffset + 1] = color[1];
      scanlines[pixelOffset + 2] = color[2];
    }
  }

  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, size);
  header.setUint32(4, size);
  ihdr.set([8, 2, 0, 0, 0], 8);

  return concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", await deflate(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}
