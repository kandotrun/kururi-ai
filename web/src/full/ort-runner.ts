import * as ort from "onnxruntime-web/webgpu";
import type { AssetBytes } from "./download";
import type { ModelRunner } from "./engine";
import type { EnsembleModel } from "./ensemble-manifest";

const INPUT = "images";
const OUTPUT = "logits";
const VIEWS = 4;
const MISSING_FILE = "高精度モデルのファイルが足りません";
const GPU_FAILED = "高精度モデルを GPU に読み込めませんでした";
const BAD_SIGNATURE = "高精度モデルの入出力が想定と違います";
const BAD_OUTPUT = "高精度モデルの出力を読み取れませんでした";

export function configureOrt(wasmBaseUrl: string): void {
  ort.env.wasm.wasmPaths = wasmBaseUrl;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "error";
}

function requireFile(
  files: ReadonlyMap<string, AssetBytes>,
  file: string,
): AssetBytes {
  const data = files.get(file);
  if (!data) {
    throw new Error(`${MISSING_FILE}（${file}）`);
  }
  return data;
}

export async function createOrtRunner(
  model: EnsembleModel,
  files: ReadonlyMap<string, AssetBytes>,
): Promise<ModelRunner> {
  const graph = requireFile(files, model.graph.file);
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ["webgpu"],
    graphOptimizationLevel: "all",
  };
  if (model.externalData !== null) {
    options.externalData = [
      {
        path: model.externalData.file,
        data: requireFile(files, model.externalData.file),
      },
    ];
  }
  let session: ort.InferenceSession;
  try {
    session = await ort.InferenceSession.create(graph, options);
  } catch (error) {
    throw new Error(GPU_FAILED, { cause: error });
  }
  if (
    !session.inputNames.includes(INPUT) ||
    !session.outputNames.includes(OUTPUT)
  ) {
    await session.release();
    throw new Error(BAD_SIGNATURE);
  }
  return {
    async run(batch, side) {
      const tensor = new ort.Tensor("float32", batch, [VIEWS, 3, side, side]);
      try {
        const outputs = await session.run({ [INPUT]: tensor });
        const logits = outputs[OUTPUT];
        if (!logits) {
          throw new Error(BAD_OUTPUT);
        }
        const data = await logits.getData();
        logits.dispose();
        if (!(data instanceof Float32Array)) {
          throw new Error(BAD_OUTPUT);
        }
        return data;
      } finally {
        tensor.dispose();
      }
    },
    release() {
      return session.release();
    },
  };
}
