export interface InitRequest {
  type: "init";
  models: Array<{ url: string; weight: number }>;
  wasmBaseUrl: string;
}

export interface ProcessRequest {
  type: "process";
  id: string;
  file: Blob;
  simulateRotation: number;
}

export type WorkerRequest = InitRequest | ProcessRequest;

export interface ProgressMessage {
  type: "load-progress";
  loaded: number;
  total: number;
  modelIndex: number;
  modelCount: number;
}

export interface ReadyMessage {
  type: "ready";
  loadMs: number;
}

export interface ResultMessage {
  type: "result";
  id: string;
  correctionCw: number;
  confidence: number;
  probabilities: number[];
  inferenceMs: number;
}

export interface ErrorMessage {
  type: "error";
  id?: string;
  message: string;
}

export type WorkerResponse =
  | ProgressMessage
  | ReadyMessage
  | ResultMessage
  | ErrorMessage;
