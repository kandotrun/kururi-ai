export type FixtureEndian = "II" | "MM";

export const TIFF_TYPE = {
  byte: 1,
  ascii: 2,
  short: 3,
  long: 4,
  rational: 5,
  undefined: 7,
  ifd: 13,
} as const;

export interface FixtureEntry {
  tag: number;
  type: number;
  values: readonly number[];
  at?: number;
  count?: number;
}

export interface FixtureIfd {
  at: number;
  entries: readonly FixtureEntry[];
  next?: number;
  count?: number;
}

export interface FixtureChunk {
  at: number;
  bytes: Uint8Array;
}

export interface TiffFixture {
  endian: FixtureEndian;
  magic?: number;
  first: number;
  ifds: readonly FixtureIfd[];
  chunks?: readonly FixtureChunk[];
  size: number;
}

export interface FixtureFile {
  readonly size: number;
  bytesAt(offset: number, length: number): Uint8Array<ArrayBuffer>;
}

export interface JpegFixture {
  width: number;
  height: number;
  sof?: number;
  exifOrientation?: number;
  exifEndian?: FixtureEndian;
  jfif?: boolean;
  appPadding?: readonly number[];
  xmp?: boolean;
  scanBytes?: number;
}

function typeSize(type: number): number {
  switch (type) {
    case TIFF_TYPE.short:
      return 2;
    case TIFF_TYPE.long:
    case TIFF_TYPE.ifd:
      return 4;
    case TIFF_TYPE.rational:
      return 8;
    default:
      return 1;
  }
}

class Writer {
  readonly view: DataView;
  readonly little: boolean;

  constructor(
    readonly bytes: Uint8Array,
    endian: FixtureEndian,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.little = endian === "II";
  }

  u8(offset: number, value: number): void {
    this.view.setUint8(offset, value & 0xff);
  }

  u16(offset: number, value: number): void {
    this.view.setUint16(offset, value & 0xffff, this.little);
  }

  u32(offset: number, value: number): void {
    this.view.setUint32(offset, value >>> 0, this.little);
  }

  value(offset: number, type: number, value: number): void {
    const size = typeSize(type);
    if (size === 2) {
      this.u16(offset, value);
    } else if (size === 4) {
      this.u32(offset, value);
    } else if (size === 8) {
      this.u32(offset, value);
      this.u32(offset + 4, 1);
    } else {
      this.u8(offset, value);
    }
  }
}

function writeIfd(writer: Writer, ifd: FixtureIfd): void {
  writer.u16(ifd.at, ifd.count ?? ifd.entries.length);
  ifd.entries.forEach((entry, index) => {
    const base = ifd.at + 2 + index * 12;
    const size = typeSize(entry.type);
    writer.u16(base, entry.tag);
    writer.u16(base + 2, entry.type);
    writer.u32(base + 4, entry.count ?? entry.values.length);
    const inline = entry.values.length * size <= 4 && entry.at === undefined;
    const target = inline ? base + 8 : (entry.at ?? 0);
    if (!inline) {
      writer.u32(base + 8, target);
    }
    entry.values.forEach((value, valueIndex) => {
      writer.value(target + valueIndex * size, entry.type, value);
    });
  });
  writer.u32(ifd.at + 2 + ifd.entries.length * 12, ifd.next ?? 0);
}

export function buildTiff(fixture: TiffFixture): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(fixture.size);
  const writer = new Writer(bytes, fixture.endian);
  bytes[0] = fixture.endian.charCodeAt(0);
  bytes[1] = fixture.endian.charCodeAt(1);
  writer.u16(2, fixture.magic ?? 42);
  writer.u32(4, fixture.first);
  for (const ifd of fixture.ifds) {
    writeIfd(writer, ifd);
  }
  for (const chunk of fixture.chunks ?? []) {
    bytes.set(chunk.bytes, chunk.at);
  }
  return bytes;
}

export function sparseFile(
  size: number,
  head: Uint8Array,
  chunks: readonly FixtureChunk[] = [],
): FixtureFile {
  return {
    size,
    bytesAt(offset, length) {
      const end = Math.min(size, offset + length);
      const result = new Uint8Array(Math.max(0, end - offset));
      const copyFrom = (source: Uint8Array, at: number) => {
        const start = Math.max(offset, at);
        const stop = Math.min(end, at + source.length);
        if (stop > start) {
          result.set(source.subarray(start - at, stop - at), start - offset);
        }
      };
      copyFrom(head, 0);
      for (const chunk of chunks) {
        copyFrom(chunk.bytes, chunk.at);
      }
      return result;
    },
  };
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(4 + payload.length);
  result[0] = 0xff;
  result[1] = marker;
  result[2] = ((payload.length + 2) >> 8) & 0xff;
  result[3] = (payload.length + 2) & 0xff;
  result.set(payload, 4);
  return result;
}

function exifPayload(orientation: number, endian: FixtureEndian): Uint8Array {
  const tiff = buildTiff({
    endian,
    first: 8,
    size: 8 + 2 + 2 * 12 + 4,
    ifds: [
      {
        at: 8,
        entries: [
          { tag: 0x010f, type: TIFF_TYPE.ascii, values: [0x41, 0x42, 0x43, 0] },
          { tag: 0x0112, type: TIFF_TYPE.short, values: [orientation] },
        ],
      },
    ],
  });
  const result = new Uint8Array(6 + tiff.length);
  result.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  result.set(tiff, 6);
  return result;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

export function buildJpeg(fixture: JpegFixture): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  if (fixture.jfif ?? true) {
    parts.push(
      segment(
        0xe0,
        new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
      ),
    );
  }
  if (fixture.xmp) {
    const xmp = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0<x/>");
    parts.push(segment(0xe1, xmp));
  }
  if (fixture.exifOrientation !== undefined) {
    parts.push(
      segment(
        0xe1,
        exifPayload(fixture.exifOrientation, fixture.exifEndian ?? "MM"),
      ),
    );
  }
  for (const padding of fixture.appPadding ?? []) {
    parts.push(segment(0xe2, new Uint8Array(padding)));
  }
  parts.push(segment(0xdb, new Uint8Array(65)));
  parts.push(
    segment(
      fixture.sof ?? 0xc0,
      new Uint8Array([
        8,
        (fixture.height >> 8) & 0xff,
        fixture.height & 0xff,
        (fixture.width >> 8) & 0xff,
        fixture.width & 0xff,
        3,
        1,
        0x22,
        0,
        2,
        0x11,
        1,
        3,
        0x11,
        1,
      ]),
    ),
  );
  parts.push(segment(0xc4, new Uint8Array(29)));
  parts.push(
    segment(0xda, new Uint8Array([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0])),
  );
  parts.push(new Uint8Array(fixture.scanBytes ?? 32).fill(0x55));
  parts.push(new Uint8Array([0xff, 0xd9]));
  return concat(parts);
}

export interface ReadLog {
  calls: Array<{ offset: number; length: number }>;
  totalBytes(): number;
  maxEnd(): number;
  largest(): number;
}

export function loggedReader(file: FixtureFile): {
  read: (offset: number, length: number) => Promise<Uint8Array>;
  log: ReadLog;
} {
  const calls: Array<{ offset: number; length: number }> = [];
  return {
    read: async (offset, length) => {
      calls.push({ offset, length });
      return file.bytesAt(offset, length);
    },
    log: {
      calls,
      totalBytes: () => calls.reduce((sum, call) => sum + call.length, 0),
      maxEnd: () =>
        calls.reduce(
          (max, call) => Math.max(max, call.offset + call.length),
          0,
        ),
      largest: () => calls.reduce((max, call) => Math.max(max, call.length), 0),
    },
  };
}

export interface DngFixtureOptions {
  endian?: FixtureEndian;
  orientation?: number;
  preview?: JpegFixture;
  previewAt?: number;
  rawAt?: number;
  size?: number;
}

export interface BuiltRawFixture {
  file: FixtureFile;
  previewAt: number;
  previewLength: number;
  rawAt: number;
}

export function proRawLikeDng(
  options: DngFixtureOptions = {},
): BuiltRawFixture {
  const previewAt = options.previewAt ?? 41_508;
  const rawAt = options.rawAt ?? 4_000_000;
  const size = options.size ?? 24_000_000;
  const preview = buildJpeg(options.preview ?? { width: 4032, height: 3024 });
  const tileTable = 2_048;
  const head = buildTiff({
    endian: options.endian ?? "MM",
    first: 8,
    size: 4_096,
    ifds: [
      {
        at: 8,
        entries: [
          { tag: 0x00fe, type: TIFF_TYPE.long, values: [1] },
          { tag: 0x0100, type: TIFF_TYPE.long, values: [4032] },
          { tag: 0x0101, type: TIFF_TYPE.long, values: [3024] },
          { tag: 0x0103, type: TIFF_TYPE.short, values: [7] },
          { tag: 0x0106, type: TIFF_TYPE.short, values: [6] },
          { tag: 0x0111, type: TIFF_TYPE.long, values: [previewAt] },
          {
            tag: 0x0112,
            type: TIFF_TYPE.short,
            values: [options.orientation ?? 6],
          },
          { tag: 0x0116, type: TIFF_TYPE.long, values: [3024] },
          { tag: 0x0117, type: TIFF_TYPE.long, values: [preview.length] },
          {
            tag: 0x014a,
            type: TIFF_TYPE.long,
            values: [1_024, 1_536],
            at: 900,
          },
          { tag: 0x8769, type: TIFF_TYPE.long, values: [3_000] },
        ],
      },
      {
        at: 1_024,
        entries: [
          { tag: 0x00fe, type: TIFF_TYPE.long, values: [0] },
          { tag: 0x0100, type: TIFF_TYPE.long, values: [4224] },
          { tag: 0x0101, type: TIFF_TYPE.long, values: [3024] },
          { tag: 0x0103, type: TIFF_TYPE.short, values: [7] },
          { tag: 0x0106, type: TIFF_TYPE.short, values: [32803] },
          {
            tag: 0x0144,
            type: TIFF_TYPE.long,
            values: [
              rawAt,
              rawAt + 1_000_000,
              rawAt + 2_000_000,
              rawAt + 3_000_000,
            ],
            at: tileTable,
          },
          {
            tag: 0x0145,
            type: TIFF_TYPE.long,
            values: [1_000_000, 1_000_000, 1_000_000, 1_000_000],
            at: tileTable + 64,
          },
        ],
      },
      {
        at: 1_536,
        entries: [
          { tag: 0x00fe, type: TIFF_TYPE.long, values: [4] },
          { tag: 0x0103, type: TIFF_TYPE.short, values: [7] },
          { tag: 0x0106, type: TIFF_TYPE.short, values: [34892] },
          { tag: 0x0111, type: TIFF_TYPE.long, values: [rawAt + 4_000_000] },
          { tag: 0x0117, type: TIFF_TYPE.long, values: [500_000] },
        ],
      },
    ],
  });
  return {
    file: sparseFile(size, head, [{ at: previewAt, bytes: preview }]),
    previewAt,
    previewLength: preview.length,
    rawAt,
  };
}

export function nefLikeRaw(options: DngFixtureOptions = {}): BuiltRawFixture {
  const thumbAt = 30_000;
  const previewAt = options.previewAt ?? 120_000;
  const otherAt = 2_000_000;
  const rawAt = options.rawAt ?? 3_000_000;
  const size = options.size ?? 40_000_000;
  const thumb = buildJpeg({ width: 160, height: 120 });
  const preview = buildJpeg(options.preview ?? { width: 6048, height: 4032 });
  const other = buildJpeg({ width: 1620, height: 1080 });
  const head = buildTiff({
    endian: options.endian ?? "II",
    first: 8,
    size: 8_192,
    ifds: [
      {
        at: 8,
        entries: [
          { tag: 0x00fe, type: TIFF_TYPE.long, values: [1] },
          { tag: 0x0103, type: TIFF_TYPE.short, values: [6] },
          {
            tag: 0x0112,
            type: TIFF_TYPE.short,
            values: [options.orientation ?? 1],
          },
          {
            tag: 0x014a,
            type: TIFF_TYPE.long,
            values: [2_000, 2_400, 2_800],
            at: 1_800,
          },
          { tag: 0x0201, type: TIFF_TYPE.long, values: [thumbAt] },
          { tag: 0x0202, type: TIFF_TYPE.long, values: [thumb.length] },
          { tag: 0x8769, type: TIFF_TYPE.long, values: [5_000] },
        ],
      },
      {
        at: 2_000,
        entries: [
          { tag: 0x00fe, type: TIFF_TYPE.long, values: [1] },
          { tag: 0x0103, type: TIFF_TYPE.short, values: [6] },
          { tag: 0x0201, type: TIFF_TYPE.long, values: [previewAt] },
          { tag: 0x0202, type: TIFF_TYPE.long, values: [preview.length] },
        ],
      },
      {
        at: 2_400,
        entries: [
          { tag: 0x00fe, type: TIFF_TYPE.long, values: [0] },
          { tag: 0x0100, type: TIFF_TYPE.long, values: [6064] },
          { tag: 0x0101, type: TIFF_TYPE.long, values: [4040] },
          { tag: 0x0103, type: TIFF_TYPE.short, values: [34713] },
          { tag: 0x0106, type: TIFF_TYPE.short, values: [32803] },
          { tag: 0x0111, type: TIFF_TYPE.long, values: [rawAt] },
          { tag: 0x0117, type: TIFF_TYPE.long, values: [30_000_000] },
        ],
      },
      {
        at: 2_800,
        entries: [
          { tag: 0x00fe, type: TIFF_TYPE.long, values: [1] },
          { tag: 0x0103, type: TIFF_TYPE.short, values: [6] },
          { tag: 0x0201, type: TIFF_TYPE.long, values: [otherAt] },
          { tag: 0x0202, type: TIFF_TYPE.long, values: [other.length] },
        ],
      },
    ],
  });
  return {
    file: sparseFile(size, head, [
      { at: thumbAt, bytes: thumb },
      { at: previewAt, bytes: preview },
      { at: otherAt, bytes: other },
    ]),
    previewAt,
    previewLength: preview.length,
    rawAt,
  };
}
