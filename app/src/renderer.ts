type Device = "cpu" | "mps" | "cuda";

let inputPath: string | null = null;
let outputDir: string | null = null;

const bindUI = (): void => {
  const api = window.kururi;
  if (!api) {
    // preloadが読めていない場合の早期警告
    // eslint-disable-next-line no-console
    console.error("kururi API is not available");
    return;
  }

  const inputLabel = document.getElementById("input-label");
  const outputLabel = document.getElementById("output-label");
  const logView = document.getElementById("log");
  const deviceSelect = document.getElementById("device") as HTMLSelectElement | null;
  const skipBroken = document.getElementById("skip-broken") as HTMLInputElement | null;
  const runButton = document.getElementById("run");

  if (!inputLabel || !outputLabel || !logView || !deviceSelect || !skipBroken || !runButton) {
    // eslint-disable-next-line no-console
    console.error("UI elements missing");
    return;
  }

  const appendLog = (line: string): void => {
    const div = document.createElement("div");
    div.textContent = line;
    logView.appendChild(div);
    logView.scrollTop = logView.scrollHeight;
  };

  const setRunning = (running: boolean): void => {
    (runButton as HTMLButtonElement).disabled = running;
  };

  const chooseInput = async (type: "file" | "directory"): Promise<void> => {
    const selected = await api.selectInput(type);
    if (!selected) return;
    inputPath = selected;
    inputLabel.textContent = selected;
  };

  const chooseOutput = async (): Promise<void> => {
    const selected = await api.selectOutputDir();
    if (!selected) return;
    outputDir = selected;
    outputLabel.textContent = selected;
  };

  const run = async (): Promise<void> => {
    if (!inputPath) {
      appendLog("Please select input first.");
      return;
    }
    logView.textContent = "";
    setRunning(true);
    const device = deviceSelect.value as Device;
    await api.runPredict({
      inputPath,
      outputDir,
      device,
      skipBroken: skipBroken.checked,
    });
  };

  document.getElementById("choose-file")?.addEventListener("click", () => chooseInput("file"));
  document.getElementById("choose-dir")?.addEventListener("click", () => chooseInput("directory"));
  document.getElementById("choose-output")?.addEventListener("click", () => chooseOutput());
  runButton.addEventListener("click", () => void run());

  api.onLog((line) => appendLog(line));
  api.onStatus((status) => {
    appendLog(`Process exited code=${status.code} signal=${status.signal ?? "none"}`);
    setRunning(false);
  });
};

window.addEventListener("DOMContentLoaded", () => {
  bindUI();
});
