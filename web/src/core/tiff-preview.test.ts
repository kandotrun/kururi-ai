import { describe, expect, it } from "vitest";
import {
  buildJpeg,
  buildTiff,
  loggedReader,
  nefLikeRaw,
  proRawLikeDng,
  sparseFile,
  TIFF_TYPE,
  type FixtureEndian,
  type FixtureEntry,
  type FixtureFile,
} from "./tiff-preview.fixtures";
import {
  findTiffPreview,
  orientationMatrix,
  orientationToApply,
  orientedSize,
  type ExifOrientation,
  type TiffPreview,
} from "./tiff-preview";

async function previewOf(file: FixtureFile): Promise<TiffPreview | null> {
  const { read } = loggedReader(file);
  return findTiffPreview(read, file.size);
}

function singleIfd(
  endian: FixtureEndian,
  entries: readonly FixtureEntry[],
  chunks: Array<{ at: number; bytes: Uint8Array }>,
  size = 200_000,
): FixtureFile {
  const head = buildTiff({
    endian,
    first: 8,
    size: 1_024,
    ifds: [{ at: 8, entries }],
  });
  return sparseFile(size, head, chunks);
}

function stripJpeg(
  at: number,
  jpeg: Uint8Array,
  extra: readonly FixtureEntry[] = [],
  compression = 7,
): FixtureEntry[] {
  return [
    { tag: 0x0103, type: TIFF_TYPE.short, values: [compression] },
    { tag: 0x0111, type: TIFF_TYPE.long, values: [at] },
    { tag: 0x0117, type: TIFF_TYPE.long, values: [jpeg.length] },
    ...extra,
  ];
}

function interchange(at: number, jpeg: Uint8Array): FixtureEntry[] {
  return [
    { tag: 0x0201, type: TIFF_TYPE.long, values: [at] },
    { tag: 0x0202, type: TIFF_TYPE.long, values: [jpeg.length] },
  ];
}

describe("findTiffPreview", () => {
  it("finds the full-size preview strip of a big-endian ProRAW-style DNG", async () => {
    const dng = proRawLikeDng({ orientation: 6 });
    const preview = await previewOf(dng.file);
    expect(preview).toEqual({
      jpeg: {
        offset: dng.previewAt,
        length: dng.previewLength,
        width: 4032,
        height: 3024,
        orientation: null,
      },
      orientation: 6,
    });
  });

  it("reads the same DNG layout in little-endian byte order", async () => {
    const dng = proRawLikeDng({ endian: "II", orientation: 8 });
    const preview = await previewOf(dng.file);
    expect(preview?.jpeg.offset).toBe(dng.previewAt);
    expect(preview?.jpeg.width).toBe(4032);
    expect(preview?.orientation).toBe(8);
  });

  it("picks the full-size JpgFromRaw of a NEF over its thumbnail and other image", async () => {
    const nef = nefLikeRaw({ orientation: 1 });
    const preview = await previewOf(nef.file);
    expect(preview).toEqual({
      jpeg: {
        offset: nef.previewAt,
        length: nef.previewLength,
        width: 6048,
        height: 4032,
        orientation: null,
      },
      orientation: 1,
    });
  });

  it("reports the IFD0 orientation of a NEF shot in portrait", async () => {
    const nef = nefLikeRaw({ orientation: 8, endian: "MM" });
    expect((await previewOf(nef.file))?.orientation).toBe(8);
  });

  it("finds a CR2-style JPEG strip in IFD0 and ignores the lossless raw strip", async () => {
    const full = buildJpeg({ width: 5472, height: 3648 });
    const thumb = buildJpeg({ width: 160, height: 120 });
    const lossless = buildJpeg({ width: 8000, height: 6000, sof: 0xc3 });
    const head = buildTiff({
      endian: "II",
      first: 16,
      size: 2_048,
      ifds: [
        {
          at: 16,
          next: 400,
          entries: [
            { tag: 0x0100, type: TIFF_TYPE.short, values: [5472] },
            { tag: 0x0101, type: TIFF_TYPE.short, values: [3648] },
            ...stripJpeg(10_000, full, [], 6),
            { tag: 0x0112, type: TIFF_TYPE.short, values: [3] },
          ],
        },
        { at: 400, next: 800, entries: interchange(200_000, thumb) },
        { at: 800, next: 1_200, entries: [] },
        { at: 1_200, entries: stripJpeg(300_000, lossless, [], 6) },
      ],
    });
    const file = sparseFile(1_000_000, head, [
      { at: 10_000, bytes: full },
      { at: 200_000, bytes: thumb },
      { at: 300_000, bytes: lossless },
    ]);
    const preview = await previewOf(file);
    expect(preview?.jpeg).toMatchObject({
      offset: 10_000,
      width: 5472,
      height: 3648,
    });
    expect(preview?.orientation).toBe(3);
  });

  it("reads the embedded JPEG's own EXIF orientation", async () => {
    for (const exifEndian of ["II", "MM"] as const) {
      const jpeg = buildJpeg({
        width: 1616,
        height: 1080,
        exifOrientation: 6,
        exifEndian,
        xmp: true,
      });
      const file = singleIfd(
        "II",
        [
          ...interchange(4_000, jpeg),
          { tag: 0x0112, type: TIFF_TYPE.short, values: [6] },
        ],
        [{ at: 4_000, bytes: jpeg }],
      );
      const preview = await previewOf(file);
      expect(preview?.jpeg.orientation).toBe(6);
      expect(preview?.orientation).toBe(6);
    }
  });

  it("accepts progressive and extended JPEGs but not lossless or arithmetic ones", async () => {
    const cases: Array<[number, boolean]> = [
      [0xc0, true],
      [0xc1, true],
      [0xc2, true],
      [0xc3, false],
      [0xc5, false],
      [0xc9, false],
      [0xca, false],
      [0xcb, false],
      [0xcf, false],
    ];
    for (const [sof, accepted] of cases) {
      const jpeg = buildJpeg({ width: 640, height: 480, sof });
      const file = singleIfd("MM", interchange(2_000, jpeg), [
        { at: 2_000, bytes: jpeg },
      ]);
      expect((await previewOf(file)) !== null).toBe(accepted);
    }
  });

  it("finds the frame header after large application segments", async () => {
    const jpeg = buildJpeg({
      width: 3000,
      height: 2000,
      appPadding: [60_000, 60_000, 30_000],
      exifOrientation: 1,
    });
    const file = singleIfd("MM", interchange(2_000, jpeg), [
      { at: 2_000, bytes: jpeg },
    ]);
    const { read, log } = loggedReader(file);
    const preview = await findTiffPreview(read, file.size);
    expect(preview?.jpeg).toMatchObject({
      width: 3000,
      height: 2000,
      orientation: 1,
    });
    expect(log.totalBytes()).toBeLessThan(120_000);
  });

  it("prefers the larger byte length when two previews have the same size", async () => {
    const small = buildJpeg({ width: 800, height: 600, scanBytes: 10 });
    const large = buildJpeg({ width: 800, height: 600, scanBytes: 900 });
    const head = buildTiff({
      endian: "II",
      first: 8,
      size: 1_024,
      ifds: [
        { at: 8, next: 300, entries: interchange(5_000, small) },
        { at: 300, entries: interchange(9_000, large) },
      ],
    });
    const file = sparseFile(50_000, head, [
      { at: 5_000, bytes: small },
      { at: 9_000, bytes: large },
    ]);
    expect((await previewOf(file))?.jpeg.offset).toBe(9_000);
  });

  it("treats a missing or invalid orientation as upright", async () => {
    const jpeg = buildJpeg({ width: 100, height: 50 });
    for (const values of [[], [0], [9], [65535]] as const) {
      const orientation: FixtureEntry[] =
        values.length === 0
          ? []
          : [{ tag: 0x0112, type: TIFF_TYPE.short, values }];
      const file = singleIfd(
        "MM",
        [...interchange(2_000, jpeg), ...orientation],
        [{ at: 2_000, bytes: jpeg }],
      );
      expect((await previewOf(file))?.orientation).toBe(1);
    }
  });

  it("accepts an orientation stored as a long", async () => {
    const jpeg = buildJpeg({ width: 100, height: 50 });
    const file = singleIfd(
      "II",
      [
        ...interchange(2_000, jpeg),
        { tag: 0x0112, type: TIFF_TYPE.long, values: [3] },
      ],
      [{ at: 2_000, bytes: jpeg }],
    );
    expect((await previewOf(file))?.orientation).toBe(3);
  });

  it("ignores multi-strip, tiled, raw and uncompressed image data", async () => {
    const jpeg = buildJpeg({ width: 4000, height: 3000 });
    const variants: FixtureEntry[][] = [
      [
        { tag: 0x0103, type: TIFF_TYPE.short, values: [7] },
        { tag: 0x0111, type: TIFF_TYPE.long, values: [2_000, 2_100], at: 600 },
        {
          tag: 0x0117,
          type: TIFF_TYPE.long,
          values: [100, jpeg.length - 100],
          at: 620,
        },
      ],
      stripJpeg(2_000, jpeg, [
        { tag: 0x0144, type: TIFF_TYPE.long, values: [2_000] },
      ]),
      stripJpeg(2_000, jpeg, [
        { tag: 0x0106, type: TIFF_TYPE.short, values: [32803] },
      ]),
      stripJpeg(2_000, jpeg, [
        { tag: 0x0106, type: TIFF_TYPE.short, values: [34892] },
      ]),
      stripJpeg(2_000, jpeg, [], 1),
      stripJpeg(2_000, jpeg, [], 34713),
    ];
    for (const entries of variants) {
      const file = singleIfd("MM", entries, [{ at: 2_000, bytes: jpeg }]);
      expect(await previewOf(file)).toBeNull();
    }
  });

  it("returns null for files that are not TIFF containers", async () => {
    const jpeg = buildJpeg({ width: 10, height: 10 });
    const bigTiff = buildTiff({
      endian: "II",
      magic: 43,
      first: 16,
      size: 64,
      ifds: [],
    });
    const orf = buildTiff({
      endian: "II",
      magic: 0x4f52,
      first: 8,
      size: 64,
      ifds: [],
    });
    for (const bytes of [
      jpeg,
      bigTiff,
      orf,
      new Uint8Array(0),
      new Uint8Array([0x49, 0x49, 42]),
      new TextEncoder().encode("not an image at all"),
    ]) {
      const file = sparseFile(bytes.length, bytes);
      expect(await previewOf(file)).toBeNull();
    }
  });

  it("returns null when a TIFF has no usable JPEG", async () => {
    const file = singleIfd(
      "II",
      [
        { tag: 0x0100, type: TIFF_TYPE.short, values: [100] },
        { tag: 0x0112, type: TIFF_TYPE.short, values: [6] },
      ],
      [],
    );
    expect(await previewOf(file)).toBeNull();
  });

  it("rejects previews that point outside the file or are not JPEG data", async () => {
    const jpeg = buildJpeg({ width: 640, height: 480 });
    const cases: Array<{ entries: FixtureEntry[]; size?: number }> = [
      { entries: interchange(150_000, jpeg), size: 150_100 },
      { entries: interchange(500_000, jpeg) },
      { entries: interchange(0, jpeg) },
      {
        entries: [
          { tag: 0x0201, type: TIFF_TYPE.long, values: [2_000] },
          { tag: 0x0202, type: TIFF_TYPE.long, values: [0] },
        ],
      },
      { entries: interchange(3_000, jpeg) },
      {
        entries: [
          { tag: 0x0201, type: TIFF_TYPE.long, values: [2_000] },
          { tag: 0x0202, type: TIFF_TYPE.long, values: [40] },
        ],
      },
    ];
    for (const { entries, size } of cases) {
      const file = singleIfd(
        "MM",
        entries,
        [
          { at: 2_000, bytes: jpeg },
          { at: 3_000, bytes: new Uint8Array(jpeg.length).fill(0x42) },
        ],
        size,
      );
      expect(await previewOf(file)).toBeNull();
    }
  });

  it("rejects a JPEG whose frame header has no size", async () => {
    const jpeg = buildJpeg({ width: 0, height: 480 });
    const file = singleIfd("MM", interchange(2_000, jpeg), [
      { at: 2_000, bytes: jpeg },
    ]);
    expect(await previewOf(file)).toBeNull();
  });

  it("survives IFD loops and self-referencing SubIFDs with bounded reads", async () => {
    const jpeg = buildJpeg({ width: 640, height: 480 });
    const head = buildTiff({
      endian: "II",
      first: 8,
      size: 1_024,
      ifds: [
        {
          at: 8,
          next: 200,
          entries: [
            ...interchange(2_000, jpeg),
            { tag: 0x014a, type: TIFF_TYPE.long, values: [8] },
          ],
        },
        {
          at: 200,
          next: 8,
          entries: [
            { tag: 0x014a, type: TIFF_TYPE.long, values: [200, 8], at: 600 },
          ],
        },
      ],
    });
    const file = sparseFile(100_000, head, [{ at: 2_000, bytes: jpeg }]);
    const { read, log } = loggedReader(file);
    const preview = await findTiffPreview(read, file.size);
    expect(preview?.jpeg.offset).toBe(2_000);
    expect(log.calls.length).toBeLessThan(40);
  });

  it("stops following a long chain of IFDs", async () => {
    const jpeg = buildJpeg({ width: 640, height: 480 });
    const ifds = Array.from({ length: 120 }, (_, index) => ({
      at: 8 + index * 40,
      next: 8 + (index + 1) * 40,
      entries: index === 100 ? interchange(6_000, jpeg) : [],
    }));
    const head = buildTiff({ endian: "MM", first: 8, size: 6_000, ifds });
    const file = sparseFile(8_192, head, [{ at: 6_000, bytes: jpeg }]);
    const { read, log } = loggedReader(file);
    expect(await findTiffPreview(read, file.size)).toBeNull();
    expect(log.totalBytes()).toBeLessThan(64 * 1_024);
  });

  it("ignores IFDs that claim more entries than the file can hold", async () => {
    const jpeg = buildJpeg({ width: 640, height: 480 });
    const head = buildTiff({
      endian: "MM",
      first: 8,
      size: 1_024,
      ifds: [
        { at: 8, next: 300, count: 65_535, entries: [] },
        { at: 300, entries: interchange(2_000, jpeg) },
      ],
    });
    const file = sparseFile(20_000, head, [{ at: 2_000, bytes: jpeg }]);
    const { read, log } = loggedReader(file);
    expect(await findTiffPreview(read, file.size)).toBeNull();
    expect(log.totalBytes()).toBeLessThan(64 * 1_024);
  });

  it("ignores IFDs with more entries than any camera writes", async () => {
    const jpeg = buildJpeg({ width: 640, height: 480 });
    const head = buildTiff({
      endian: "II",
      first: 8,
      size: 40_000,
      ifds: [{ at: 8, count: 2_000, entries: interchange(30_000, jpeg) }],
    });
    const file = sparseFile(60_000, head, [{ at: 30_000, bytes: jpeg }]);
    expect(await previewOf(file)).toBeNull();
  });

  it("rejects a preview that runs past the end of the file", async () => {
    const jpeg = buildJpeg({ width: 640, height: 480, scanBytes: 400 });
    const file = singleIfd(
      "MM",
      interchange(2_000, jpeg),
      [{ at: 2_000, bytes: jpeg }],
      2_000 + jpeg.length - 10,
    );
    expect(await previewOf(file)).toBeNull();
  });

  it("skips IFD offsets outside the file", async () => {
    const jpeg = buildJpeg({ width: 640, height: 480 });
    const head = buildTiff({
      endian: "II",
      first: 8,
      size: 1_024,
      ifds: [
        {
          at: 8,
          next: 9_999_999,
          entries: [
            ...interchange(2_000, jpeg),
            {
              tag: 0x014a,
              type: TIFF_TYPE.long,
              values: [7_777_777, 3],
              at: 500,
            },
          ],
        },
      ],
    });
    const file = sparseFile(30_000, head, [{ at: 2_000, bytes: jpeg }]);
    expect((await previewOf(file))?.jpeg.offset).toBe(2_000);
  });

  it("never reads the raw image data of a large DNG", async () => {
    const dng = proRawLikeDng({ size: 75_000_000, rawAt: 6_000_000 });
    const { read, log } = loggedReader(dng.file);
    const preview = await findTiffPreview(read, dng.file.size);
    expect(preview?.jpeg.offset).toBe(dng.previewAt);
    expect(log.maxEnd()).toBeLessThan(dng.previewAt + 64 * 1_024);
    expect(log.totalBytes()).toBeLessThan(256 * 1_024);
    expect(log.largest()).toBeLessThanOrEqual(64 * 1_024);
  });

  it("never reads the raw data of a NEF and stays within a small budget", async () => {
    const nef = nefLikeRaw({ size: 60_000_000 });
    const { read, log } = loggedReader(nef.file);
    await findTiffPreview(read, nef.file.size);
    for (const call of log.calls) {
      expect(
        call.offset + call.length <= nef.rawAt ||
          call.offset >= nef.rawAt + 30_000_000,
      ).toBe(true);
    }
    expect(log.totalBytes()).toBeLessThan(256 * 1_024);
  });

  it("stops reading once the read budget is spent", async () => {
    const jpeg = buildJpeg({
      width: 640,
      height: 480,
      appPadding: [60_000, 60_000],
    });
    const file = singleIfd("II", interchange(2_000, jpeg), [
      { at: 2_000, bytes: jpeg },
    ]);
    const { read, log } = loggedReader(file);
    const preview = await findTiffPreview(read, file.size, {
      maxReadBytes: 32 * 1_024,
    });
    expect(preview).toBeNull();
    expect(log.totalBytes()).toBeLessThanOrEqual(32 * 1_024);
  });

  it("copes with readers that return fewer bytes than asked", async () => {
    const dng = proRawLikeDng();
    const preview = await findTiffPreview(
      async (offset, length) => dng.file.bytesAt(offset, Math.min(length, 7)),
      dng.file.size,
    );
    expect(preview === null || preview.jpeg.offset === dng.previewAt).toBe(
      true,
    );
  });

  it("passes read errors on to the caller", async () => {
    const failure = new Error("disk gone");
    await expect(
      findTiffPreview(async () => {
        throw failure;
      }, 1_000),
    ).rejects.toBe(failure);
  });
});

describe("orientationToApply", () => {
  const jpeg = { offset: 0, length: 10, width: 4, height: 3 };

  it("applies the TIFF orientation when the JPEG has none of its own", () => {
    expect(
      orientationToApply({
        jpeg: { ...jpeg, orientation: null },
        orientation: 6,
      }),
    ).toBe(6);
    expect(
      orientationToApply({ jpeg: { ...jpeg, orientation: 1 }, orientation: 8 }),
    ).toBe(8);
  });

  it("leaves rotation to the decoder when the JPEG carries its own orientation", () => {
    expect(
      orientationToApply({ jpeg: { ...jpeg, orientation: 6 }, orientation: 6 }),
    ).toBe(1);
    expect(
      orientationToApply({ jpeg: { ...jpeg, orientation: 3 }, orientation: 1 }),
    ).toBe(1);
  });
});

describe("orientedSize", () => {
  it("swaps width and height for the transposing orientations", () => {
    const sizes = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((orientation) =>
      orientedSize(4032, 3024, orientation),
    );
    expect(sizes).toEqual([
      { width: 4032, height: 3024 },
      { width: 4032, height: 3024 },
      { width: 4032, height: 3024 },
      { width: 4032, height: 3024 },
      { width: 3024, height: 4032 },
      { width: 3024, height: 4032 },
      { width: 3024, height: 4032 },
      { width: 3024, height: 4032 },
    ]);
  });
});

describe("orientationMatrix", () => {
  const stored = [
    ["a", "b", "c"],
    ["d", "e", "f"],
  ];

  function render(orientation: ExifOrientation): string[] {
    const width = 3;
    const height = 2;
    const [a, b, c, d, e, f] = orientationMatrix(orientation, width, height);
    const out = orientedSize(width, height, orientation);
    const grid = Array.from({ length: out.height }, () =>
      Array.from({ length: out.width }, () => "?"),
    );
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        const ox = Math.floor(a * cx + c * cy + e);
        const oy = Math.floor(b * cx + d * cy + f);
        grid[oy]![ox] = stored[y]![x]!;
      }
    }
    return grid.map((row) => row.join(""));
  }

  it("turns stored pixels into the displayed picture for every EXIF orientation", () => {
    expect(render(1)).toEqual(["abc", "def"]);
    expect(render(2)).toEqual(["cba", "fed"]);
    expect(render(3)).toEqual(["fed", "cba"]);
    expect(render(4)).toEqual(["def", "abc"]);
    expect(render(5)).toEqual(["ad", "be", "cf"]);
    expect(render(6)).toEqual(["da", "eb", "fc"]);
    expect(render(7)).toEqual(["fc", "eb", "da"]);
    expect(render(8)).toEqual(["cf", "be", "ad"]);
  });
});
