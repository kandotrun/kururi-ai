import type { InferencePool, ModelId } from "./contracts";

export interface PoolFactories {
  nano(): Promise<InferencePool>;
  full(): InferencePool;
}

export async function choosePool(
  model: ModelId,
  factories: PoolFactories,
  onFallback: (error: unknown) => void,
): Promise<InferencePool> {
  if (model === "nano") {
    return factories.nano();
  }
  let full: InferencePool | null = null;
  try {
    full = factories.full();
    await full.ready;
    return full;
  } catch (error) {
    full?.dispose();
    onFallback(error);
    return factories.nano();
  }
}
