export type ByteReader = (
  offset: number,
  length: number,
) => Promise<Uint8Array>;

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface EmbeddedJpeg {
  offset: number;
  length: number;
  width: number;
  height: number;
  orientation: ExifOrientation | null;
}

export interface TiffPreview {
  jpeg: EmbeddedJpeg;
  orientation: ExifOrientation;
}

export interface TiffPreviewLimits {
  maxIfds: number;
  maxEntries: number;
  maxSubIfds: number;
  maxDepth: number;
  maxCandidates: number;
  maxJpegSegments: number;
  maxReadBytes: number;
  pageSize: number;
}

export type CanvasMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export const DEFAULT_TIFF_LIMITS: TiffPreviewLimits = {
  maxIfds: 64,
  maxEntries: 1_024,
  maxSubIfds: 16,
  maxDepth: 4,
  maxCandidates: 16,
  maxJpegSegments: 64,
  maxReadBytes: 2 * 1_024 * 1_024,
  pageSize: 16 * 1_024,
};

const TAG = {
  width: 0x0100,
  height: 0x0101,
  compression: 0x0103,
  photometric: 0x0106,
  stripOffsets: 0x0111,
  orientation: 0x0112,
  stripByteCounts: 0x0117,
  tileOffsets: 0x0144,
  subIfds: 0x014a,
  jpegOffset: 0x0201,
  jpegLength: 0x0202,
} as const;

const JPEG_COMPRESSIONS: ReadonlySet<number> = new Set([6, 7]);
const RAW_PHOTOMETRICS: ReadonlySet<number> = new Set([32803, 34892]);
const DECODABLE_FRAMES: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);
const NON_FRAME_MARKERS: ReadonlySet<number> = new Set([0xc4, 0xc8, 0xcc]);
const EXIF_SIGNATURE = [0x45, 0x78, 0x69, 0x66, 0, 0] as const;

class BudgetSpent extends Error {}

interface Entry {
  tag: number;
  type: number;
  count: number;
  field: number;
}

interface Candidate {
  offset: number;
  length: number;
}

interface Ifd {
  entries: ReadonlyMap<number, Entry>;
  next: number;
}

interface Source {
  readonly size: number;
  bytes(offset: number, length: number): Promise<Uint8Array | null>;
}

function typeSize(type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 6:
    case 7:
      return 1;
    case 3:
    case 8:
      return 2;
    case 4:
    case 9:
    case 11:
    case 13:
      return 4;
    case 5:
    case 10:
    case 12:
      return 8;
    default:
      return 0;
  }
}

function pagedSource(
  read: ByteReader,
  size: number,
  limits: TiffPreviewLimits,
): Source {
  const pages = new Map<number, Uint8Array>();
  let spent = 0;

  async function page(index: number): Promise<Uint8Array> {
    const cached = pages.get(index);
    if (cached) {
      return cached;
    }
    const start = index * limits.pageSize;
    const length = Math.min(limits.pageSize, size - start);
    if (spent + length > limits.maxReadBytes) {
      throw new BudgetSpent();
    }
    spent += length;
    const bytes = await read(start, length);
    const kept = bytes.length > length ? bytes.subarray(0, length) : bytes;
    pages.set(index, kept);
    return kept;
  }

  return {
    size,
    async bytes(offset, length) {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length <= 0 ||
        offset + length > size
      ) {
        return null;
      }
      const result = new Uint8Array(length);
      let at = offset;
      while (at < offset + length) {
        const index = Math.floor(at / limits.pageSize);
        const data = await page(index);
        const within = at - index * limits.pageSize;
        if (within >= data.length) {
          return null;
        }
        const take = Math.min(data.length - within, offset + length - at);
        result.set(data.subarray(within, within + take), at - offset);
        at += take;
      }
      return result;
    },
  };
}

class Endian {
  constructor(readonly little: boolean) {}

  u16(bytes: Uint8Array, at: number): number {
    const first = bytes[at] ?? 0;
    const second = bytes[at + 1] ?? 0;
    return this.little ? first | (second << 8) : (first << 8) | second;
  }

  u32(bytes: Uint8Array, at: number): number {
    const b0 = bytes[at] ?? 0;
    const b1 = bytes[at + 1] ?? 0;
    const b2 = bytes[at + 2] ?? 0;
    const b3 = bytes[at + 3] ?? 0;
    const value = this.little
      ? b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
      : (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
    return value >>> 0;
  }

  unsigned(bytes: Uint8Array, at: number, size: number): number {
    if (size === 1) {
      return bytes[at] ?? 0;
    }
    return size === 2 ? this.u16(bytes, at) : this.u32(bytes, at);
  }
}

function endianOf(bytes: Uint8Array): Endian | null {
  if (bytes[0] === 0x49 && bytes[1] === 0x49) {
    return new Endian(true);
  }
  if (bytes[0] === 0x4d && bytes[1] === 0x4d) {
    return new Endian(false);
  }
  return null;
}

function validOrientation(value: number | null): ExifOrientation | null {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 8
    ? (value as ExifOrientation)
    : null;
}

function parseEntries(
  bytes: Uint8Array,
  endian: Endian,
  count: number,
): Map<number, Entry> {
  const entries = new Map<number, Entry>();
  for (let index = 0; index < count; index += 1) {
    const at = 2 + index * 12;
    const tag = endian.u16(bytes, at);
    if (!entries.has(tag)) {
      entries.set(tag, {
        tag,
        type: endian.u16(bytes, at + 2),
        count: endian.u32(bytes, at + 4),
        field: at + 8,
      });
    }
  }
  return entries;
}

class TiffWalker {
  private readonly visited = new Set<number>();
  private parsed = 0;

  constructor(
    private readonly source: Source,
    private readonly endian: Endian,
    private readonly limits: TiffPreviewLimits,
  ) {}

  async ifd(offset: number): Promise<Ifd | null> {
    if (
      offset < 8 ||
      offset >= this.source.size ||
      this.visited.has(offset) ||
      this.parsed >= this.limits.maxIfds
    ) {
      return null;
    }
    this.visited.add(offset);
    this.parsed += 1;
    const head = await this.source.bytes(offset, 2);
    if (!head) {
      return null;
    }
    const count = this.endian.u16(head, 0);
    if (count > this.limits.maxEntries) {
      return null;
    }
    const bytes = await this.source.bytes(offset, 2 + count * 12 + 4);
    if (!bytes) {
      return null;
    }
    const entries = parseEntries(bytes, this.endian, count);
    const resolved = new Map<number, Entry>();
    for (const entry of entries.values()) {
      resolved.set(entry.tag, { ...entry, field: offset + entry.field });
    }
    return {
      entries: resolved,
      next: this.endian.u32(bytes, 2 + count * 12),
    };
  }

  async values(
    entry: Entry | undefined,
    max: number,
  ): Promise<number[] | null> {
    if (!entry) {
      return null;
    }
    const size = typeSize(entry.type);
    if (size === 0 || size > 4 || entry.count === 0 || entry.count > max) {
      return null;
    }
    const total = size * entry.count;
    const field = await this.source.bytes(entry.field, 4);
    if (!field) {
      return null;
    }
    const data =
      total <= 4
        ? field
        : await this.source.bytes(this.endian.u32(field, 0), total);
    if (!data) {
      return null;
    }
    return Array.from({ length: entry.count }, (_, index) =>
      this.endian.unsigned(data, index * size, size),
    );
  }

  async single(entry: Entry | undefined): Promise<number | null> {
    const values = await this.values(entry, 1);
    return values?.[0] ?? null;
  }
}

async function candidatesOf(
  walker: TiffWalker,
  ifd: Ifd,
): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const jpegOffset = await walker.single(ifd.entries.get(TAG.jpegOffset));
  const jpegLength = await walker.single(ifd.entries.get(TAG.jpegLength));
  if (jpegOffset !== null && jpegLength !== null) {
    found.push({ offset: jpegOffset, length: jpegLength });
  }
  const compression = await walker.single(ifd.entries.get(TAG.compression));
  const photometric = await walker.single(ifd.entries.get(TAG.photometric));
  if (
    compression !== null &&
    JPEG_COMPRESSIONS.has(compression) &&
    (photometric === null || !RAW_PHOTOMETRICS.has(photometric)) &&
    !ifd.entries.has(TAG.tileOffsets)
  ) {
    const offset = await walker.single(ifd.entries.get(TAG.stripOffsets));
    const length = await walker.single(ifd.entries.get(TAG.stripByteCounts));
    if (offset !== null && length !== null) {
      found.push({ offset, length });
    }
  }
  return found;
}

function exifOrientation(payload: Uint8Array): ExifOrientation | null {
  if (!EXIF_SIGNATURE.every((value, index) => payload[index] === value)) {
    return null;
  }
  const tiff = payload.subarray(EXIF_SIGNATURE.length);
  const endian = endianOf(tiff);
  if (!endian || endian.u16(tiff, 2) !== 42) {
    return null;
  }
  const first = endian.u32(tiff, 4);
  if (first < 8 || first + 2 > tiff.length) {
    return null;
  }
  const count = endian.u16(tiff, first);
  if (first + 2 + count * 12 > tiff.length) {
    return null;
  }
  for (let index = 0; index < count; index += 1) {
    const at = first + 2 + index * 12;
    if (endian.u16(tiff, at) !== TAG.orientation) {
      continue;
    }
    const size = typeSize(endian.u16(tiff, at + 2));
    if (size !== 2 && size !== 4) {
      return null;
    }
    return validOrientation(endian.unsigned(tiff, at + 8, size));
  }
  return null;
}

async function inspectJpeg(
  source: Source,
  candidate: Candidate,
  limits: TiffPreviewLimits,
): Promise<EmbeddedJpeg | null> {
  const { offset, length } = candidate;
  if (offset < 8 || length < 4 || offset + length > source.size) {
    return null;
  }
  const end = offset + length;
  const start = await source.bytes(offset, 2);
  if (!start || start[0] !== 0xff || start[1] !== 0xd8) {
    return null;
  }
  let at = offset + 2;
  let orientation: ExifOrientation | null = null;
  let exifSeen = false;
  for (let segments = 0; segments < limits.maxJpegSegments; segments += 1) {
    if (at + 4 > end) {
      return null;
    }
    const header = await source.bytes(at, 4);
    if (!header || header[0] !== 0xff) {
      return null;
    }
    const marker = header[1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) {
      return null;
    }
    const segmentLength = ((header[2] ?? 0) << 8) | (header[3] ?? 0);
    if (segmentLength < 2 || at + 2 + segmentLength > end) {
      return null;
    }
    if (marker >= 0xc0 && marker <= 0xcf && !NON_FRAME_MARKERS.has(marker)) {
      if (!DECODABLE_FRAMES.has(marker) || segmentLength < 7) {
        return null;
      }
      const frame = await source.bytes(at + 4, 5);
      if (!frame) {
        return null;
      }
      const height = ((frame[1] ?? 0) << 8) | (frame[2] ?? 0);
      const width = ((frame[3] ?? 0) << 8) | (frame[4] ?? 0);
      if (width === 0 || height === 0) {
        return null;
      }
      return { offset, length, width, height, orientation };
    }
    if (marker === 0xe1 && !exifSeen && segmentLength >= 2 + 14) {
      const payload = await source.bytes(at + 4, segmentLength - 2);
      if (
        payload &&
        EXIF_SIGNATURE.every((value, index) => payload[index] === value)
      ) {
        exifSeen = true;
        orientation = exifOrientation(payload);
      }
    }
    at += 2 + segmentLength;
  }
  return null;
}

function better(left: EmbeddedJpeg, right: EmbeddedJpeg): boolean {
  const leftArea = left.width * left.height;
  const rightArea = right.width * right.height;
  return leftArea !== rightArea
    ? leftArea > rightArea
    : left.length > right.length;
}

async function walk(
  walker: TiffWalker,
  first: number,
  limits: TiffPreviewLimits,
  found: Candidate[],
): Promise<ExifOrientation> {
  let orientation: ExifOrientation = 1;
  const queue: Array<{ offset: number; depth: number; root: boolean }> = [
    { offset: first, depth: 0, root: true },
  ];
  let isFirst = true;
  while (queue.length > 0) {
    const { offset, depth, root } = queue.shift()!;
    const ifd = await walker.ifd(offset);
    if (!ifd) {
      continue;
    }
    if (isFirst) {
      isFirst = false;
      orientation =
        validOrientation(
          await walker.single(ifd.entries.get(TAG.orientation)),
        ) ?? 1;
    }
    for (const candidate of await candidatesOf(walker, ifd)) {
      if (
        found.length < limits.maxCandidates &&
        !found.some((other) => other.offset === candidate.offset)
      ) {
        found.push(candidate);
      }
    }
    if (depth < limits.maxDepth) {
      const children = await walker.values(
        ifd.entries.get(TAG.subIfds),
        limits.maxSubIfds,
      );
      for (const child of children ?? []) {
        queue.push({ offset: child, depth: depth + 1, root: false });
      }
    }
    if (root && ifd.next !== 0) {
      queue.push({ offset: ifd.next, depth, root: true });
    }
  }
  return orientation;
}

export async function findTiffPreview(
  read: ByteReader,
  size: number,
  overrides: Partial<TiffPreviewLimits> = {},
): Promise<TiffPreview | null> {
  const limits = { ...DEFAULT_TIFF_LIMITS, ...overrides };
  if (!Number.isSafeInteger(size) || size < 16) {
    return null;
  }
  const source = pagedSource(read, size, limits);
  const found: Candidate[] = [];
  let orientation: ExifOrientation = 1;
  let best: EmbeddedJpeg | null = null;
  try {
    const header = await source.bytes(0, 8);
    const endian = header ? endianOf(header) : null;
    if (!header || !endian || endian.u16(header, 2) !== 42) {
      return null;
    }
    const walker = new TiffWalker(source, endian, limits);
    orientation = await walk(walker, endian.u32(header, 4), limits, found);
    for (const candidate of found) {
      const jpeg = await inspectJpeg(source, candidate, limits);
      if (jpeg && (!best || better(jpeg, best))) {
        best = jpeg;
      }
    }
  } catch (error) {
    if (!(error instanceof BudgetSpent)) {
      throw error;
    }
  }
  return best ? { jpeg: best, orientation } : null;
}

export function orientationToApply(preview: TiffPreview): ExifOrientation {
  const own = preview.jpeg.orientation;
  return own !== null && own !== 1 ? 1 : preview.orientation;
}

export function orientedSize(
  width: number,
  height: number,
  orientation: ExifOrientation,
): { width: number; height: number } {
  return orientation >= 5
    ? { width: height, height: width }
    : { width, height };
}

export function orientationMatrix(
  orientation: ExifOrientation,
  width: number,
  height: number,
): CanvasMatrix {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, width, 0];
    case 3:
      return [-1, 0, 0, -1, width, height];
    case 4:
      return [1, 0, 0, -1, 0, height];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, height, 0];
    case 7:
      return [0, -1, -1, 0, height, width];
    case 8:
      return [0, -1, 1, 0, 0, width];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}
