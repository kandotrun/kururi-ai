export type ProgressReport = (loaded: number, total: number) => void;

export interface ProgressMeter {
  readonly total: number;
  readonly loaded: number;
  add(index: number, bytes: number): void;
  finish(index: number): void;
  reset(index: number): void;
}

export function createProgressMeter(
  sizes: readonly number[],
  report: ProgressReport,
  step: number,
): ProgressMeter {
  const loaded = sizes.map(() => 0);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  let current = 0;
  let reported = 0;

  function emit(force: boolean): void {
    if (force || current - reported >= step || current === total) {
      reported = current;
      report(current, total);
    }
  }

  function set(index: number, value: number, force: boolean): void {
    const size = sizes[index];
    if (size === undefined) {
      return;
    }
    const next = Math.min(size, Math.max(0, value));
    current += next - loaded[index]!;
    loaded[index] = next;
    emit(force);
  }

  report(0, total);
  return {
    total,
    get loaded() {
      return current;
    },
    add(index, bytes) {
      set(index, (loaded[index] ?? 0) + bytes, false);
    },
    finish(index) {
      set(index, sizes[index] ?? 0, false);
    },
    reset(index) {
      set(index, 0, true);
    },
  };
}
