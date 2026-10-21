import type { InferencePool, Prediction, Quarter } from "./contracts";

export function createLazyPool(
  pending: Promise<InferencePool>,
  size: number,
): InferencePool {
  let pool: InferencePool | null = null;
  let disposed = false;
  const settled = pending.then((resolved) => {
    if (disposed) {
      resolved.dispose();
      throw new Error("推論プールは終了しました");
    }
    pool = resolved;
    return resolved;
  });
  const ready = settled.then((resolved) => resolved.ready);
  ready.catch(() => {});
  return {
    size,
    ready,
    idleCount() {
      return pool && !disposed ? pool.idleCount() : 0;
    },
    async infer(id: string, blob: Blob, simulated: Quarter): Promise<Prediction> {
      const resolved = await settled;
      return resolved.infer(id, blob, simulated);
    },
    dispose() {
      disposed = true;
      pool?.dispose();
      pool = null;
    },
  };
}
