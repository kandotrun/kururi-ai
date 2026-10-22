export interface EnsembleAsset {
  file: string;
  bytes: number;
  sha256: string;
}

export interface EnsembleModel {
  name: string;
  role: "general" | "fallback";
  inputSize: number;
  weight: number;
  graph: EnsembleAsset;
  externalData: EnsembleAsset | null;
}

export interface EnsembleManifest {
  release: string;
  general: readonly EnsembleModel[];
  fallback: EnsembleModel | null;
  fallbackMargin: number;
}

const PREPROCESS = "v2-whole224-bilinear-imagenet";
const CLASS_ORDER = [0, 90, 180, 270] as const;
const BATCH = 4;
const RELEASE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MARGIN_PATTERN = /margin is below (\d+(?:\.\d+)?)/;
const MAX_SIDE = 2048;

function fail(path: string, problem: string): never {
  throw new Error(`Invalid ensemble manifest: ${path} ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }
  return value;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function readInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(path, `must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function readAsset(value: unknown, path: string): EnsembleAsset {
  const record = readRecord(value, path);
  const file = readString(record.file, `${path}.file`);
  if (!FILE_PATTERN.test(file) || file.includes("..")) {
    fail(`${path}.file`, "must be a plain file name");
  }
  const sha256 = readString(record.sha256, `${path}.sha256`);
  if (!DIGEST_PATTERN.test(sha256)) {
    fail(`${path}.sha256`, "must be 64 lowercase hex digits");
  }
  return {
    file,
    bytes: readInteger(
      record.bytes,
      `${path}.bytes`,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    sha256,
  };
}

function readModel(
  value: unknown,
  path: string,
  role: EnsembleModel["role"],
): EnsembleModel {
  const record = readRecord(value, path);
  if (record.role !== role) {
    fail(`${path}.role`, `must be "${role}"`);
  }
  readInteger(record.batch_size, `${path}.batch_size`, BATCH, BATCH);
  readInteger(record.views, `${path}.views`, BATCH, BATCH);
  const weight = record.weight;
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
    fail(`${path}.weight`, "must be a positive finite number");
  }
  return {
    name: readString(record.name, `${path}.name`),
    role,
    inputSize: readInteger(
      record.input_size,
      `${path}.input_size`,
      1,
      MAX_SIDE,
    ),
    weight,
    graph: readAsset(record.graph, `${path}.graph`),
    externalData:
      record.external_data === null
        ? null
        : readAsset(record.external_data, `${path}.external_data`),
  };
}

function readMargin(value: unknown, path: string): number {
  const match = MARGIN_PATTERN.exec(readString(value, path));
  const margin = match ? Number(match[1]) : Number.NaN;
  if (!(margin > 0 && margin < 1)) {
    fail(path, "must state a margin between 0 and 1");
  }
  return margin;
}

function sameClassOrder(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === CLASS_ORDER.length &&
    CLASS_ORDER.every((degrees, index) => value[index] === degrees)
  );
}

export function modelAssets(model: EnsembleModel): EnsembleAsset[] {
  return model.externalData === null
    ? [model.graph]
    : [model.graph, model.externalData];
}

export function generalAssets(manifest: EnsembleManifest): EnsembleAsset[] {
  return manifest.general.flatMap(modelAssets);
}

export function decodeEnsembleManifest(json: unknown): EnsembleManifest {
  const root = readRecord(json, "root");
  readInteger(root.schema_version, "schema_version", 1, 1);
  const release = readString(root.release, "release");
  if (!RELEASE_PATTERN.test(release)) {
    fail("release", "must be a plain version name");
  }
  if (!sameClassOrder(root.class_order_correction_cw)) {
    fail("class_order_correction_cw", "must be [0, 90, 180, 270]");
  }
  if (root.preprocess !== PREPROCESS) {
    fail("preprocess", `must be "${PREPROCESS}"`);
  }
  if (!Array.isArray(root.general_models) || root.general_models.length === 0) {
    fail("general_models", "must be a non-empty array");
  }
  const general = root.general_models.map((item: unknown, index: number) =>
    readModel(item, `general_models[${index}]`, "general"),
  );
  const fallback =
    root.fallback === null
      ? null
      : readModel(root.fallback, "fallback", "fallback");
  const fallbackMargin =
    root.fallback === null
      ? 0
      : readMargin(
          readRecord(root.fallback, "fallback").fallback_rule,
          "fallback.fallback_rule",
        );
  const files = [...general, ...(fallback ? [fallback] : [])]
    .flatMap(modelAssets)
    .map((asset) => asset.file);
  if (new Set(files).size !== files.length) {
    fail("files", "must not repeat a file name");
  }
  return { release, general, fallback, fallbackMargin };
}
