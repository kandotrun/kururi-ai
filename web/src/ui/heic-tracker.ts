import type { FolderProgress } from "../contracts";

export interface HandoffCounts {
  found: number;
  photos: number;
  photosWithHeic: number;
}

export interface HeicTracker {
  handOff(counts: HandoffCounts): void;
  leftOut(progress: FolderProgress): number;
}

interface Batch {
  counts: HandoffCounts;
  heicLeftOut: number | null;
}

export function createHeicTracker(): HeicTracker {
  let batch: Batch | null = null;

  return {
    handOff(counts) {
      batch = { counts, heicLeftOut: null };
    },
    leftOut(progress) {
      if (!batch || batch.counts.found !== progress.found) {
        return 0;
      }
      if (batch.heicLeftOut === null) {
        const { found, photos, photosWithHeic } = batch.counts;
        const heic = photosWithHeic - photos;
        batch.heicLeftOut =
          heic > 0 && progress.skipped === found - photos ? heic : 0;
      }
      return batch.heicLeftOut;
    },
  };
}
