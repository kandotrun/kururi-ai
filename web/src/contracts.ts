export type Quarter = 0 | 1 | 2 | 3;

export type PhotoKind = "commons" | "sample" | "user";

export interface Attribution {
  author: string;
  license: string;
  licenseUrl: string | null;
  pageUrl: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoPlace extends GeoPoint {
  country: string | null;
}

export interface PhotoSource {
  id: string;
  kind: PhotoKind;
  title: string;
  aspect: number | null;
  thumbUrl: string | null;
  largeUrl: string | null;
  file: File | null;
  attribution: Attribution | null;
  uprightFix: Quarter | null;
  location?: GeoPlace | null;
}

export type PhotoPhase =
  | "loading"
  | "landing"
  | "waiting"
  | "scanning"
  | "placing"
  | "placed"
  | "failed";

export type Probabilities = readonly [number, number, number, number];

export interface Prediction {
  correction: Quarter;
  confidence: number;
  probabilities: Probabilities;
  inferenceMs: number;
}

export interface PhotoRecord {
  id: string;
  source: PhotoSource;
  simulated: Quarter;
  phase: PhotoPhase;
  aspect: number;
  prediction: Prediction | null;
  slot: number | null;
  correct: boolean | null;
  addedAt: number;
  decidedAt: number | null;
  error: string | null;
}

export interface DeskState {
  records: ReadonlyMap<string, PhotoRecord>;
  order: readonly string[];
  nextSlot: number;
  total: number;
}

export type DeskAction =
  | { type: "added"; source: PhotoSource; simulated: Quarter; at: number }
  | { type: "loaded"; id: string; aspect: number }
  | { type: "landed"; id: string }
  | { type: "scanStarted"; id: string }
  | { type: "decided"; id: string; prediction: Prediction; at: number }
  | { type: "placed"; id: string }
  | { type: "failed"; id: string; error: string }
  | { type: "totalChanged"; total: number };

export interface Store {
  getState(): DeskState;
  dispatch(action: DeskAction): void;
  subscribe(
    listener: (state: DeskState, action: DeskAction) => void,
  ): () => void;
}

export interface DeskStats {
  total: number;
  added: number;
  processed: number;
  placed: number;
  rotatedFixed: number;
  judged: number;
  correct: number;
  accuracy: number | null;
  perSecond: number | null;
  medianMs: number | null;
  failed: number;
  crooked: number;
}

export interface DeskPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  scale: number;
}

export interface CommonsLicense {
  name: string;
  url: string | null;
}

export interface CommonsEntry {
  file: string;
  hash: string;
  width: number;
  height: number;
  author: string;
  license: number;
  topic: string;
  thumbName: string | null;
  location?: GeoPlace | null;
}

export interface CommonsManifest {
  version: 1;
  generatedAt: string;
  thumbBase: string;
  pageBase: string;
  licenses: readonly CommonsLicense[];
  topics: readonly string[];
  items: readonly CommonsEntry[];
}

export interface LoadedImage {
  bitmap: ImageBitmap;
  blob: Blob;
  aspect: number;
}

export interface ImageLoader {
  load(source: PhotoSource, signal?: AbortSignal): Promise<LoadedImage>;
}

export interface ModelProgress {
  loaded: number;
  total: number;
  ready: boolean;
}

export interface InferencePool {
  readonly size: number;
  readonly ready: Promise<void>;
  idleCount(): number;
  infer(id: string, blob: Blob, simulated: Quarter): Promise<Prediction>;
  dispose(): void;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface NewPrint {
  id: string;
  slot: number;
  aspect: number;
  simulated: Quarter;
  image: ImageBitmap;
  emphasis: boolean;
}

export interface DeskSceneEvents {
  hover: (id: string | null, at: ScreenPoint | null) => void;
  select: (id: string | null) => void;
}

export interface DeskScene {
  readonly capacity: number;
  readonly tileSize: number;
  start(): void;
  addPrint(print: NewPrint): Promise<void>;
  setScanning(id: string, scanning: boolean): void;
  decide(id: string, correction: Quarter): void;
  place(id: string, slot: number): Promise<void>;
  removePrint(id: string): void;
  scatterAll(): Promise<void>;
  focus(id: string | null): void;
  select(id: string | null): void;
  screenPosition(id: string): ScreenPoint | null;
  setReducedMotion(reduced: boolean): void;
  setViewInsets(insets: ViewInsets): void;
  on<K extends keyof DeskSceneEvents>(
    event: K,
    handler: DeskSceneEvents[K],
  ): () => void;
  dispose(): void;
}

export interface DeskSceneOptions {
  reducedMotion: boolean;
  lowPower: boolean;
}

export type ModelId = "nano" | "full";

export interface ModelOption {
  id: ModelId;
  label: string;
  version: string;
  sizeBytes: number;
  testAccuracy: number;
  needsWebGPU: boolean;
  available: boolean;
  unavailableReason: string | null;
}

export type StreamStatus =
  | "loading-model"
  | "running"
  | "paused"
  | "finished"
  | "offline";

export interface OverlayHandlers {
  addFiles(files: File[]): void;
  togglePause(): void;
  scatter(): void;
  setSimulateUser(enabled: boolean): void;
  selectRecord(id: string | null): void;
  selectModel(id: ModelId): void;
  skipIntro(): void;
}

export interface Overlay {
  readonly canvas: HTMLCanvasElement;
  setModelProgress(progress: ModelProgress): void;
  setStatus(status: StreamStatus): void;
  setStats(stats: DeskStats): void;
  upsertRecord(record: PhotoRecord): void;
  showLoupe(record: PhotoRecord, at: ScreenPoint): void;
  hideLoupe(): void;
  pin(record: PhotoRecord | null): void;
  notice(message: string | null): void;
  webglUnavailable(): void;
  simulateUser(): boolean;
  setModels(current: ModelId, options: readonly ModelOption[]): void;
  setIntroActive(active: boolean): void;
  viewInsets(): ViewInsets;
  onViewInsetsChange(handler: (insets: ViewInsets) => void): () => void;
  setFolderProgress(progress: FolderProgress | null): void;
}

export interface FolderProgress {
  found: number;
  accepted: number;
  skipped: number;
  done: boolean;
}

export interface Stream {
  readonly paused: boolean;
  start(): void;
  pause(): void;
  resume(): void;
  addUserFiles(files: File[]): void;
  dispose(): void;
}
