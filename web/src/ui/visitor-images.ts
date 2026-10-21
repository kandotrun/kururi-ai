export interface VisitorImages {
  url(file: File): Promise<string>;
}

export interface VisitorImageDeps {
  preview: (file: File) => Promise<Blob>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  limit: number;
}

export function createVisitorImages(deps: VisitorImageDeps): VisitorImages {
  const entries = new Map<File, Promise<string>>();

  function evict(): void {
    while (entries.size > deps.limit) {
      const oldest = entries.keys().next();
      if (oldest.done) {
        return;
      }
      const pending = entries.get(oldest.value);
      entries.delete(oldest.value);
      void pending?.then(deps.revokeUrl, () => {});
    }
  }

  return {
    url(file) {
      const existing = entries.get(file);
      if (existing) {
        entries.delete(file);
        entries.set(file, existing);
        return existing;
      }
      const pending = deps.preview(file).then(deps.createUrl);
      entries.set(file, pending);
      pending.catch(() => {
        if (entries.get(file) === pending) {
          entries.delete(file);
        }
      });
      evict();
      return pending;
    },
  };
}
