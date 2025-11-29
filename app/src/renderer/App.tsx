import { useEffect, useMemo, useState } from 'react';
import { Play, FolderOpen, File as FileIcon, HardDrive, Cpu } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Switch } from './components/ui/switch';
import './index.css';

type Device = 'cpu' | 'mps' | 'cuda';

const devices: Array<{ value: Device; label: string }> = [
  { value: 'cpu', label: 'CPU' },
  { value: 'mps', label: 'MPS (macOS)' },
  { value: 'cuda', label: 'CUDA (Windows/NVIDIA)' }
];

const formatLabel = (value: string | null) => value ?? 'Not selected';

export const App = () => {
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('cpu');
  const [skipBroken, setSkipBroken] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const api = window.kururi;
    if (!api) return;
    api.onLog(line => setLogLines(prev => [...prev, line]));
    api.onStatus(status => {
      setLogLines(prev => [...prev, `Process exited code=${status.code} signal=${status.signal ?? 'none'}`]);
      setRunning(false);
    });
  }, []);

  const handleChoose = async (type: 'file' | 'directory') => {
    const selected = await window.kururi.selectInput(type);
    if (!selected) return;
    setInputPath(selected);
  };

  const handleOutput = async () => {
    const selected = await window.kururi.selectOutputDir();
    if (!selected) return;
    setOutputDir(selected);
  };

  const handleRun = async () => {
    if (!inputPath) {
      setLogLines(prev => [...prev, 'Please select input first.']);
      return;
    }
    setLogLines([]);
    setRunning(true);
    await window.kururi.runPredict({
      inputPath,
      outputDir,
      device,
      skipBroken
    });
  };

  const deviceLabel = useMemo(() => devices.find(d => d.value === device)?.label ?? device, [device]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-5 py-6 text-slate-900">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-600">Kururi AI</p>
            <h1 className="text-2xl font-semibold text-slate-900">Desktop</h1>
          </div>
        </div>

        <Card className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => handleChoose('file')}><FileIcon size={18} className="mr-2" />Select File</Button>
            <Button variant="secondary" onClick={() => handleChoose('directory')}><FolderOpen size={18} className="mr-2" />Select Directory</Button>
            <Badge>{formatLabel(inputPath)}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={handleOutput}><HardDrive size={18} className="mr-2" />Select Output Directory</Button>
            <Badge>{formatLabel(outputDir) === 'Not selected' ? 'In-place' : formatLabel(outputDir)}</Badge>
          </div>
        </Card>

        <Card className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600">Device</span>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Cpu size={16} className="text-cyan-600" />
              <select
                value={device}
                onChange={e => setDevice(e.target.value as Device)}
                className="bg-transparent text-sm focus:outline-none"
              >
                {devices.map(d => (
                  <option key={d.value} value={d.value} className="bg-white text-slate-900">
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Switch checked={skipBroken} onCheckedChange={checked => setSkipBroken(Boolean(checked))} />
              <span className="text-sm text-slate-700">skip broken files</span>
            </div>
          </div>
        </Card>

        <Card className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-600">Ready to process images</p>
          </div>
          <Button variant="default" size="lg" onClick={handleRun} disabled={running}>
            <Play size={18} className="mr-2" />
            {running ? 'Running...' : 'Run'}
          </Button>
        </Card>

        <Card className="grid gap-2">
          <div className="text-sm text-slate-600">Log</div>
          <div className="h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-800">
            {logLines.length === 0 ? (
              <div className="text-slate-500">Logs will appear here</div>
            ) : (
              logLines.map((line, idx) => <div key={idx}>{line}</div>)
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
