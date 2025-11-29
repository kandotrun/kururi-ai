import { PredictRequest, PredictStatus } from "./preload";

declare global {
  interface Window {
    kururi: {
      selectInput: (type: "file" | "directory") => Promise<string | null>;
      selectOutputDir: () => Promise<string | null>;
      runPredict: (request: PredictRequest) => Promise<void>;
      onLog: (handler: (line: string) => void) => void;
      onStatus: (handler: (status: PredictStatus) => void) => void;
    };
  }
}

export {};
