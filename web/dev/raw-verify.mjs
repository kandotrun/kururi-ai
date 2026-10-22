import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.length > 0 ? rest.join("=") : "1"];
  }),
);
const url = options.url ?? "http://127.0.0.1:5196/dev/raw-harness.html";
const out = options.out ?? ".";
const folder = options.folder ?? null;
const query = new URLSearchParams();
if (options.infer) {
  query.set("infer", "1");
}
if (options.limit) {
  query.set("limit", options.limit);
}
if (options.heavy) {
  query.set("heavy", options.heavy);
}
if (options.workers) {
  query.set("workers", options.workers);
}
if (options.stream) {
  query.set("stream", "1");
}
if (options.capacity) {
  query.set("capacity", options.capacity);
}

mkdirSync(out, { recursive: true });

function hashOf(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

function orientedAspect(width, height, orientation) {
  return orientation >= 5 ? height / width : width / height;
}

function exifExpectations(root) {
  const json = execFileSync(
    "exiftool",
    [
      "-q",
      "-q",
      "-j",
      "-n",
      "-G1",
      "-r",
      "-fast2",
      "-ext",
      "DNG",
      "-ext",
      "NEF",
      "-ext",
      "JPG",
      "-ext",
      "JPEG",
      "-ext",
      "PNG",
      "-IFD0:Orientation",
      "-IFD0:ImageWidth",
      "-IFD0:ImageHeight",
      "-SubIFD1:ImageWidth",
      "-SubIFD1:ImageHeight",
      "-File:ImageWidth",
      "-File:ImageHeight",
      "-PNG:ImageWidth",
      "-PNG:ImageHeight",
      root,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parent = path.dirname(path.resolve(root));
  const expected = new Map();
  for (const row of JSON.parse(json)) {
    const relative = path.relative(parent, row.SourceFile);
    const ext = path.extname(row.SourceFile).slice(1).toLowerCase();
    const orientation = row["IFD0:Orientation"] ?? 1;
    let width = null;
    let height = null;
    if (ext === "dng") {
      width = row["IFD0:ImageWidth"];
      height = row["IFD0:ImageHeight"];
    } else if (ext === "nef") {
      width = row["SubIFD1:ImageWidth"];
      height = row["SubIFD1:ImageHeight"];
    } else if (ext === "png") {
      width = row["PNG:ImageWidth"] ?? row["File:ImageWidth"];
      height = row["PNG:ImageHeight"] ?? row["File:ImageHeight"];
    } else {
      width = row["File:ImageWidth"];
      height = row["File:ImageHeight"];
    }
    expected.set(hashOf(relative).slice(0, 16), {
      orientation,
      aspect:
        width && height ? orientedAspect(width, height, orientation) : null,
    });
  }
  return expected;
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function round(value, digits = 1) {
  return value === null || value === undefined
    ? null
    : Number(value.toFixed(digits));
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=metal",
  ],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${url}?${query}`);
await page.waitForFunction(() => window.__raw !== undefined);

const selftest = await page.evaluate(() => window.__raw.selftest());
if (selftest.some((check) => !check.ok)) {
  process.exitCode = 1;
}
console.log(
  JSON.stringify(
    {
      selftest: selftest.map(({ name, ok, detail }) => ({ name, ok, detail })),
    },
    null,
    1,
  ),
);

if (folder && options.stream) {
  await page.setInputFiles("#pick", folder);
  await page.waitForFunction(() => window.__raw.done, null, {
    timeout: 60 * 60 * 1000,
    polling: 1000,
  });
  const report = await page.evaluate(() => ({
    stream: window.__stream,
    error: window.__raw.error,
  }));
  console.log(JSON.stringify(report, null, 1));
} else if (folder) {
  const expected = exifExpectations(folder);
  const started = Date.now();
  await page.setInputFiles("#pick", folder);
  await page.waitForFunction(() => window.__raw.done, null, {
    timeout: 60 * 60 * 1000,
    polling: 1000,
  });
  const report = await page.evaluate(() => ({
    folder: window.__raw.folder,
    error: window.__raw.error,
  }));
  if (report.error) {
    console.log(JSON.stringify({ error: report.error }));
  }
  const { records, ...summary } = report.folder;
  const byType = {};
  for (const record of records) {
    const entry = (byType[record.ext] ??= {
      accepted: 0,
      decoded: 0,
      failed: {},
      loadMs: [],
      bytesRead: [],
      reads: [],
      orientationAgrees: 0,
      orientationChecked: 0,
      aspectAgrees: 0,
      aspectChecked: 0,
      blobTypes: {},
      blobLongSideOk: 0,
      predictions: {},
    });
    entry.accepted += 1;
    if (record.ok) {
      entry.decoded += 1;
      entry.loadMs.push(record.loadMs);
      entry.blobTypes[record.blobType || "(none)"] =
        (entry.blobTypes[record.blobType || "(none)"] ?? 0) + 1;
    } else {
      entry.failed[record.error] = (entry.failed[record.error] ?? 0) + 1;
    }
    if (record.bytesRead !== null) {
      entry.bytesRead.push(record.bytesRead);
      entry.reads.push(record.reads);
    }
    const truth = expected.get(record.key);
    if (truth && record.kind === "raw" && record.tiffOrientation !== null) {
      entry.orientationChecked += 1;
      if (truth.orientation === record.tiffOrientation) {
        entry.orientationAgrees += 1;
      }
    }
    if (truth && truth.aspect && record.aspect) {
      entry.aspectChecked += 1;
      if (Math.abs(record.aspect - truth.aspect) / truth.aspect < 0.02) {
        entry.aspectAgrees += 1;
      }
    }
    if (record.correction !== null) {
      const group =
        record.kind === "raw"
          ? `orientation ${record.tiffOrientation}`
          : `exif ${truth?.orientation ?? "?"}`;
      const histogram = (entry.predictions[group] ??= {
        0: 0,
        90: 0,
        180: 0,
        270: 0,
      });
      histogram[String(record.correction * 90)] += 1;
    }
  }
  const types = Object.fromEntries(
    Object.entries(byType).map(([ext, entry]) => [
      ext,
      {
        accepted: entry.accepted,
        decoded: entry.decoded,
        failed: entry.failed,
        medianLoadMs: round(median(entry.loadMs)),
        meanBytesRead: entry.bytesRead.length
          ? Math.round(
              entry.bytesRead.reduce((a, b) => a + b, 0) /
                entry.bytesRead.length,
            )
          : null,
        maxBytesRead: entry.bytesRead.length
          ? Math.max(...entry.bytesRead)
          : null,
        meanReads: entry.reads.length
          ? round(entry.reads.reduce((a, b) => a + b, 0) / entry.reads.length)
          : null,
        tiffOrientationMatchesExiftool: entry.orientationChecked
          ? `${entry.orientationAgrees}/${entry.orientationChecked}`
          : null,
        orientedAspectMatchesExiftool: entry.aspectChecked
          ? `${entry.aspectAgrees}/${entry.aspectChecked}`
          : null,
        blobTypes: entry.blobTypes,
        predictions: entry.predictions,
      },
    ]),
  );
  const decoded = records.filter((record) => record.ok).length;
  const inferred = records.filter((record) => record.correction !== null);
  console.log(
    JSON.stringify(
      {
        found: summary.found,
        accepted: summary.accepted,
        skipped: summary.skipped,
        heicDecodable: summary.heic,
        byExtension: summary.byExtension,
        types,
        decoded,
        loadSeconds: round(summary.loadSeconds),
        photosPerSecondLoading: round(decoded / summary.loadSeconds, 2),
        totalSeconds: round(summary.totalSeconds),
        workers: summary.workers,
        inferred: inferred.length,
        photosPerSecondEndToEnd: inferred.length
          ? round(inferred.length / summary.totalSeconds, 2)
          : null,
        medianInferenceMs: round(
          median(inferred.map((record) => record.inferenceMs)),
        ),
        wallSeconds: round((Date.now() - started) / 1000),
        sheetGroups: summary.sheetGroups,
        pageErrors: errors.length,
      },
      null,
      1,
    ),
  );
  if (options.private) {
    writeFileSync(options.private, JSON.stringify(records));
  }
  if (options.sheet) {
    await page
      .locator("#sheet")
      .screenshot({ path: path.join(out, options.sheet) });
  }
}

if (options.shot) {
  await page.screenshot({ path: path.join(out, options.shot), fullPage: true });
}
console.log(JSON.stringify({ pageErrors: errors }));
await browser.close();
