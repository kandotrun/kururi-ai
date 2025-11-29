import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import tar from 'tar';
import tar from 'tar';
import AdmZip from 'adm-zip';
import { spawn } from 'child_process';

const pythonBuilds: Record<string, { url: string; exe: string }> = {
  'darwin-arm64': {
    url: 'https://github.com/indygreg/python-build-standalone/releases/download/20241002/cpython-3.12.7+20241002-aarch64-apple-darwin-install_only.tar.gz',
    exe: 'python/bin/python3'
  },
  'darwin-x64': {
    url: 'https://github.com/indygreg/python-build-standalone/releases/download/20241002/cpython-3.12.7+20241002-x86_64-apple-darwin-install_only.tar.gz',
    exe: 'python/bin/python3'
  },
  'win32-x64': {
    url: 'https://github.com/indygreg/python-build-standalone/releases/download/20241002/cpython-3.12.7+20241002-amd64-pc-windows-msvc-install_only.zip',
    exe: 'python/python.exe'
  }
};

type EnsureOptions = {
  resourcesPath: string;
};

const downloadFile = async (url: string, dest: string, redirects = 0): Promise<void> => {
  if (redirects > 5) throw new Error('Too many redirects');
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const file = fs.createWriteStream(dest);
  await new Promise<void>((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'kururi-ai-desktop' } }, res => {
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          const loc = res.headers.location;
          file.close();
          fs.unlink(dest, () => {
            /* noop */
          });
          if (!loc) {
            reject(new Error('Redirect with no location header'));
            return;
          }
          downloadFile(loc, dest, redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', reject);
  });
};

const extract = async (archive: string, targetDir: string): Promise<void> => {
  if (archive.endsWith('.tar.gz') || archive.endsWith('.tgz')) {
    await tar.x({ file: archive, cwd: targetDir });
  } else if (archive.endsWith('.zip')) {
    const zip = new AdmZip(archive);
    zip.extractAllTo(targetDir, true);
  } else {
    throw new Error('Unsupported archive format');
  }
};

const requirementsPath = (resourcesPath: string) =>
  path.join(resourcesPath, 'runtime', 'requirements-runtime.txt');

const ensureDeps = async (pythonPath: string, resourcesPath: string): Promise<void> => {
  const marker = path.join(resourcesPath, 'runtime', '.deps_installed');
  if (fs.existsSync(marker)) return;
  const reqPath = requirementsPath(resourcesPath);
  if (!fs.existsSync(reqPath)) return;
  const install = (args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const proc = spawn(pythonPath, args, { stdio: 'inherit' });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`pip exited with ${code}`));
      });
    });
  await install(['-m', 'pip', 'install', '--upgrade', 'pip']);
  await install([
    '-m',
    'pip',
    'install',
    '--extra-index-url',
    'https://download.pytorch.org/whl/cpu',
    '-r',
    reqPath
  ]);
  fs.writeFileSync(marker, 'ok');
};

export const ensurePythonRuntime = async ({ resourcesPath }: EnsureOptions): Promise<string | null> => {
  const platformKey = `${process.platform}-${process.arch}`;
  const build = pythonBuilds[platformKey];
  if (!build) return null;

  const runtimeDir = path.join(resourcesPath, 'runtime');
  const pythonPath = path.join(runtimeDir, build.exe);
  if (fs.existsSync(pythonPath)) {
    await ensureDeps(pythonPath, resourcesPath);
    return pythonPath;
  }

  await fs.promises.mkdir(runtimeDir, { recursive: true });
  const ext = build.url.endsWith('.zip') ? '.zip' : '.tar.gz';
  const tmpArchive = path.join(os.tmpdir(), `kururi-python-${Date.now()}${ext}`);
  await downloadFile(build.url, tmpArchive);
  await extract(tmpArchive, runtimeDir);
  fs.unlink(tmpArchive, () => {
    /* noop */
  });

  if (!fs.existsSync(pythonPath)) return null;

  await ensureDeps(pythonPath, resourcesPath);
  return pythonPath;
};
