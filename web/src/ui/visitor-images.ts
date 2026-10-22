export interface VisitorImageLease {
  readonly url: Promise<string>;
  release(): void;
}

export interface VisitorImages {
  acquire(file: File): VisitorImageLease;
}

export interface VisitorImageDeps {
  preview: (file: File) => Promise<Blob>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  idleLimit: number;
}

interface Entry {
  readonly url: Promise<string>;
  holders: number;
}

export function createVisitorImages(deps: VisitorImageDeps): VisitorImages {
  const entries = new Map<File, Entry>();
  const idle = new Set<File>();

  function trimIdle(): void {
    while (idle.size > Math.max(0, deps.idleLimit)) {
      const oldest = idle.values().next();
      if (oldest.done) {
        return;
      }
      idle.delete(oldest.value);
      const entry = entries.get(oldest.value);
      entries.delete(oldest.value);
      void entry?.url.then(deps.revokeUrl, () => {});
    }
  }

  function entryFor(file: File): Entry {
    const existing = entries.get(file);
    if (existing) {
      return existing;
    }
    const entry: Entry = {
      url: deps.preview(file).then(deps.createUrl),
      holders: 0,
    };
    entries.set(file, entry);
    entry.url.catch(() => {
      if (entries.get(file) === entry) {
        entries.delete(file);
        idle.delete(file);
      }
    });
    return entry;
  }

  return {
    acquire(file) {
      const entry = entryFor(file);
      entry.holders += 1;
      idle.delete(file);
      let held = true;
      return {
        url: entry.url,
        release() {
          if (!held) {
            return;
          }
          held = false;
          entry.holders -= 1;
          if (entry.holders === 0 && entries.get(file) === entry) {
            idle.add(file);
            trimIdle();
          }
        },
      };
    },
  };
}
