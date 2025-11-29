import { contextBridge, ipcRenderer } from "electron";

export type PredictRequest = {
  inputPath: string;
  outputDir: string | null;
  device: "cpu" | "mps" | "cuda";
  skipBroken: boolean;
};

export type PredictStatus = {
  kind: "exit";
  code: number;
  signal: string | null;
};

const api = {
  selectInput: async (type: "file" | "directory"): Promise<string | null> => {
    const result = await ipcRenderer.invoke("select-path", { type });
    return result as string | null;
  },
  selectOutputDir: async (): Promise<string | null> => {
    const result = await ipcRenderer.invoke("select-output-dir");
    return result as string | null;
  },
  runPredict: async (request: PredictRequest): Promise<void> => {
    await ipcRenderer.invoke("run-predict", request);
  },
  onLog: (handler: (line: string) => void): void => {
    ipcRenderer.on("predict-log", (_event, line: string) => handler(line));
  },
  onStatus: (handler: (status: PredictStatus) => void): void => {
    ipcRenderer.on("predict-status", (_event, status: PredictStatus) => handler(status));
  },
};

contextBridge.exposeInMainWorld("kururi", api);
