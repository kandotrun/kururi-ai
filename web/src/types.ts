export interface InitRequest {
  type: "init";
  models: Array<{ bytes: ArrayBuffer; weight: number }>;
  wasmBaseUrl: string;
}

export interface ProcessRequest {
  type: "process";
  id: string;
  file: Blob;
  simulateRotation: number;
}

export type WorkerRequest = InitRequest | ProcessRequest;

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

export type WorkerResponse = ReadyMessage | ResultMessage | ErrorMessage;
