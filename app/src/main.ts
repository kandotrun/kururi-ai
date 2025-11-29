import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, type OpenDialogOptions, app, dialog, ipcMain } from "electron";
import type { PredictRequest, PredictStatus } from "./preload";
import { ensurePythonRuntime } from "./runtime";

const isMac = process.platform === "darwin";
const isDev = process.env.NODE_ENV !== "production";

const pythonExecutable = async (): Promise<string> => {
  const envPath = process.env.KURURI_PYTHON_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const projectVenv = isMac
    ? path.resolve(__dirname, "..", "..", ".venv", "bin", "python3")
    : path.resolve(__dirname, "..", "..", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(projectVenv)) return projectVenv;
  const runtimePath = await ensurePythonRuntime({ resourcesPath: process.resourcesPath });
  if (runtimePath) return runtimePath;
  const candidates = isMac ? ["python3", "python"] : ["python.exe", "python"];
  return candidates[0];
};

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const indexPath = path.join(__dirname, "renderer", "index.html");
  win.loadFile(indexPath);
  if (isDev) win.webContents.openDevTools({ mode: "detach" });
};

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

ipcMain.handle("select-path", async (_event, args: { type: "file" | "directory" }) => {
  const props: OpenDialogOptions["properties"] =
    args.type === "file" ? ["openFile"] : ["openDirectory"];
  const result = await dialog.showOpenDialog({ properties: props });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("select-output-dir", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

const buildArgs = (request: PredictRequest): string[] => {
  const stats = fs.statSync(request.inputPath);
  const args: string[] = ["-m", "cli.main", "predict"];
  if (stats.isDirectory()) {
    args.push("--dir", request.inputPath);
    if (request.outputDir) args.push("--save-rotated-dir", request.outputDir);
  } else {
    args.push("--image", request.inputPath);
    if (request.outputDir)
      args.push("--save-rotated", path.join(request.outputDir, path.basename(request.inputPath)));
  }
  args.push("--device", request.device);
  if (request.skipBroken) args.push("--skip-broken");
  return args;
};

ipcMain.handle("run-predict", async (event, request: PredictRequest) => {
  let pythonPath: string | undefined;
  try {
    pythonPath = await pythonExecutable();
    const args = buildArgs(request);
    const child = spawn(pythonPath, args, {
      cwd: isDev ? path.resolve(__dirname, "..", "..") : process.resourcesPath,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: isDev ? path.resolve(__dirname, "..", "..") : process.resourcesPath,
      },
    });

    child.on("error", (err) => {
      event.sender.send(
        "predict-log",
        `[spawn error] ${err.message} (python=${pythonPath ?? "unknown"})`,
      );
      const status: PredictStatus = { kind: "exit", code: -1, signal: null };
      event.sender.send("predict-status", status);
    });

    child.stdout.on("data", (data) => {
      const lines = data.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        event.sender.send("predict-log", line);
      }
    });

    child.stderr.on("data", (data) => {
      const lines = data.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        event.sender.send("predict-log", `[stderr] ${line}`);
      }
    });

    child.on("close", (code, signal) => {
      const status: PredictStatus = { kind: "exit", code: code ?? -1, signal: signal ?? null };
      event.sender.send("predict-status", status);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    event.sender.send(
      "predict-log",
      `[python setup error] ${message}${pythonPath ? ` (python=${pythonPath})` : ""}`,
    );
    const status: PredictStatus = { kind: "exit", code: -1, signal: null };
    event.sender.send("predict-status", status);
  }
});
