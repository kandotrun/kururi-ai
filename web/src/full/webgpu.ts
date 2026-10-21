export interface AdapterLike {
  isFallbackAdapter?: boolean;
  info?: {
    isFallbackAdapter?: boolean;
    architecture?: string;
    vendor?: string;
  };
}

export interface GpuLike {
  requestAdapter(): Promise<AdapterLike | null>;
}

const SOFTWARE = /swiftshader/i;

export function usableAdapter(adapter: AdapterLike | null): boolean {
  if (adapter === null) {
    return false;
  }
  if (
    adapter.isFallbackAdapter === true ||
    adapter.info?.isFallbackAdapter === true
  ) {
    return false;
  }
  return !SOFTWARE.test(adapter.info?.architecture ?? "");
}

export async function detectWebGpu(gpu: GpuLike | undefined): Promise<boolean> {
  if (!gpu) {
    return false;
  }
  try {
    return usableAdapter(await gpu.requestAdapter());
  } catch {
    return false;
  }
}
