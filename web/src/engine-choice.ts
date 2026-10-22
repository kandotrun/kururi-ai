import type { InferencePool, ModelId } from "./contracts";

export interface PoolFactories {
  nano(): Promise<InferencePool>;
  full(): InferencePool;
}

export interface ChosenPool {
  pool: InferencePool;
  model: ModelId;
}

export async function choosePool(
  model: ModelId,
  factories: PoolFactories,
  onFallback: (error: unknown) => void,
): Promise<ChosenPool> {
  if (model === "nano") {
    return { pool: await factories.nano(), model: "nano" };
  }
  let full: InferencePool | null = null;
  try {
    full = factories.full();
    await full.ready;
    return { pool: full, model: "full" };
  } catch (error) {
    full?.dispose();
    onFallback(error);
    return { pool: await factories.nano(), model: "nano" };
  }
}
