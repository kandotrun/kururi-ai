export interface NanoInitRequest {
  type: "init";
  engine: "nano";
  models: Array<{ bytes: ArrayBuffer; weight: number }>;
  wasmBaseUrl: string;
}

export interface FullInitRequest {
  type: "init";
  engine: "full";
  baseUrl: string;
  wasmBaseUrl: string;
}

export type InitRequest = NanoInitRequest | FullInitRequest;

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
