import { describe, expect, it } from "vitest";
import type {
  DeskStats,
  ModelOption,
  PhotoRecord,
  PhotoSource,
  Prediction,
  Quarter,
} from "../contracts";
import {
  creditText,
  folderProgressText,
  folderScanText,
  folderTruncatedText,
  headlineChange,
  headlineState,
  judgementText,
  loupeRotation,
  modelLoadingNote,
  modelOptionText,
  modelStateText,
  modelSwitch,
  photoPlace,
  progressAnnouncement,
  switchConfirmText,
  verdictOf,
  verdictText,
} from "./copy";

function source(overrides: Partial<PhotoSource> = {}): PhotoSource {
  return {
    id: "c1",
    kind: "commons",
    title: "Lake Bled from the hill",
    aspect: 1.5,
    thumbUrl: "https://upload.wikimedia.org/thumb/a.jpg",
    largeUrl: "https://upload.wikimedia.org/large/a.jpg",
    file: null,
    attribution: {
      author: "Diliff",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
    },
    uprightFix: 0,
    ...overrides,
  };
}

function prediction(correction: Quarter, confidence = 0.98): Prediction {
  return {
    correction,
    confidence,
    probabilities: [0.01, confidence, 0.005, 0.005],
    inferenceMs: 238,
  };
}

function record(overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id: "c1",
    source: source(),
    simulated: 3,
    phase: "placed",
    aspect: 1.5,
    prediction: prediction(1),
    slot: 4,
    correct: true,
    addedAt: 0,
    decidedAt: 100,
    error: null,
    ...overrides,
  };
}

function stats(overrides: Partial<DeskStats> = {}): DeskStats {
  return {
    total: 3005,
    added: 1400,
    processed: 1290,
    placed: 1284,
    rotatedFixed: 937,
    judged: 1280,
    correct: 1187,
    accuracy: 1187 / 1280,
    perSecond: 16.2,
    medianMs: 238,
    failed: 6,
    crooked: 24,
    ...overrides,
  };
}

describe("judgementText", () => {
  it("names the predicted correction", () => {
    expect(judgementText(record())).toBe("時計回りに 90°");
    expect(judgementText(record({ prediction: prediction(0) }))).toBe(
      "回転なし",
    );
  });

  it("describes photos that are not judged yet", () => {
    expect(
      judgementText(record({ prediction: null, phase: "waiting" })),
    ).toBe("判定待ち");
    expect(
      judgementText(record({ prediction: null, phase: "scanning" })),
    ).toBe("判定中");
    expect(
      judgementText(
        record({ prediction: null, phase: "failed", error: "timeout" }),
      ),
    ).toBe("読み込めませんでした");
  });
});

describe("verdictOf", () => {
  it("marks a correct prediction", () => {
    expect(verdictOf(record())).toEqual({
      tone: "correct",
      label: "正解",
      detail: null,
    });
  });

  it("names the expected correction for a miss", () => {
    expect(
      verdictOf(record({ prediction: prediction(2), correct: false })),
    ).toEqual({ tone: "miss", label: "不正解", detail: "正しくは時計回りに 90°" });
    expect(
      verdictOf(
        record({
          simulated: 0,
          prediction: prediction(1),
          correct: false,
        }),
      ),
    ).toEqual({ tone: "miss", label: "不正解", detail: "正しくは回転なし" });
  });

  it("uses the sample's known fix for the expected answer", () => {
    expect(
      verdictOf(
        record({
          source: source({ kind: "sample", uprightFix: 2, attribution: null }),
          simulated: 0,
          prediction: prediction(3),
          correct: false,
        }),
      ),
    ).toEqual({ tone: "miss", label: "不正解", detail: "正しくは 180°" });
  });

  it("does not grade visitors' photos", () => {
    expect(
      verdictOf(
        record({
          source: source({ kind: "user", uprightFix: null, attribution: null }),
          correct: null,
        }),
      ),
    ).toEqual({ tone: "unknown", label: "答え合わせなし", detail: null });
  });

  it("reports pending and failed photos", () => {
    expect(verdictOf(record({ prediction: null, correct: null }))).toEqual({
      tone: "pending",
      label: "判定待ち",
      detail: null,
    });
    expect(
      verdictOf(
        record({ prediction: null, correct: null, phase: "failed" }),
      ),
    ).toEqual({ tone: "failed", label: "読み込めませんでした", detail: null });
  });
});

describe("verdictText", () => {
  it("puts the detail in full-width parentheses", () => {
    expect(
      verdictText({ tone: "miss", label: "不正解", detail: "正しくは 180°" }),
    ).toBe("不正解（正しくは 180°）");
    expect(verdictText({ tone: "correct", label: "正解", detail: null })).toBe(
      "正解",
    );
  });
});

describe("creditText", () => {
  it("joins author and license for Commons photos", () => {
    expect(creditText(source())).toBe("Diliff / CC BY-SA 4.0");
  });

  it("falls back to the site name when attribution is missing", () => {
    expect(creditText(source({ attribution: null }))).toBe(
      "Wikimedia Commons",
    );
  });

  it("labels samples and visitors' photos", () => {
    expect(creditText(source({ kind: "sample", attribution: null }))).toBe(
      "サンプル写真",
    );
    expect(creditText(source({ kind: "user", attribution: null }))).toBe(
      "あなたの写真",
    );
  });
});

describe("loupeRotation", () => {
  it("shows the simulated rotation before the print is placed", () => {
    expect(loupeRotation(record({ phase: "scanning", simulated: 3 }))).toBe(
      270,
    );
    expect(loupeRotation(record({ phase: "placing", simulated: 1 }))).toBe(
      90,
    );
  });

  it("adds the correction along the shortest turn once placed", () => {
    expect(
      loupeRotation(record({ simulated: 3, prediction: prediction(1) })),
    ).toBe(360);
    expect(
      loupeRotation(record({ simulated: 1, prediction: prediction(3) })),
    ).toBe(0);
    expect(
      loupeRotation(record({ simulated: 2, prediction: prediction(2) })),
    ).toBe(360);
    expect(
      loupeRotation(record({ simulated: 0, prediction: prediction(3) })),
    ).toBe(-90);
  });

  it("keeps the simulated rotation when no prediction exists", () => {
    expect(loupeRotation(record({ simulated: 2, prediction: null }))).toBe(
      180,
    );
  });
});

describe("headlineState", () => {
  it("counts the crooked photos before anything is straightened", () => {
    expect(headlineState(null, "loading-model")).toEqual({
      label: "向きがばらばらの写真",
      value: 0,
    });
    expect(headlineState(stats({ placed: 0, crooked: 36 }), "running")).toEqual({
      label: "向きがばらばらの写真",
      value: 36,
    });
  });

  it("switches to the straightened count once one lands", () => {
    expect(headlineState(stats({ placed: 1, crooked: 40 }), "running")).toEqual({
      label: "向きを直した写真",
      value: 1,
    });
    expect(headlineState(stats({ placed: 1284 }), "paused")).toEqual({
      label: "向きを直した写真",
      value: 1284,
    });
  });

  it("names the final count when the desk is finished", () => {
    expect(headlineState(stats({ placed: 3005 }), "finished")).toEqual({
      label: "並べ終えた写真",
      value: 3005,
    });
  });
});

describe("progressAnnouncement", () => {
  it("is empty before anything is placed", () => {
    expect(progressAnnouncement(stats({ placed: 0 }), "running")).toBe("");
  });

  it("reports the straightened count and accuracy", () => {
    expect(progressAnnouncement(stats(), "running")).toBe(
      "向きを直した写真 1,284枚。正解率 92.7%。",
    );
  });

  it("omits accuracy when nothing could be graded", () => {
    expect(
      progressAnnouncement(stats({ placed: 3, accuracy: null }), "running"),
    ).toBe("向きを直した写真 3枚。");
  });

  it("uses the finished label at the end", () => {
    expect(
      progressAnnouncement(stats({ placed: 3005 }), "finished"),
    ).toBe("並べ終えた写真 3,005枚。正解率 92.7%。");
  });
});

const NANO: ModelOption = {
  id: "nano",
  label: "軽量",
  version: "v2-nano",
  sizeBytes: 11_908_441,
  testAccuracy: 0.8182,
  needsWebGPU: false,
  available: true,
  unavailableReason: null,
};

const FULL: ModelOption = {
  id: "full",
  label: "高精度",
  version: "v2.0.0",
  sizeBytes: 551_055_739,
  testAccuracy: 0.9943,
  needsWebGPU: true,
  available: true,
  unavailableReason: null,
};

describe("modelStateText", () => {
  it("shows download progress for the light model", () => {
    expect(
      modelStateText(
        "loading-model",
        { loaded: 4_200_000, total: 11_908_441, ready: false },
        NANO,
      ),
    ).toBe("軽量モデル 4.2 / 11.9 MB");
  });

  it("shows whole megabytes for the full model", () => {
    expect(
      modelStateText(
        "loading-model",
        { loaded: 231_400_000, total: 551_055_739, ready: false },
        FULL,
      ),
    ).toBe("高精度モデル 231 / 551 MB");
  });

  it("names the model before the size is known", () => {
    expect(
      modelStateText(
        "loading-model",
        { loaded: 0, total: 0, ready: false },
        NANO,
      ),
    ).toBe("軽量モデルを準備中");
    expect(
      modelStateText(
        "loading-model",
        { loaded: 0, total: 0, ready: false },
        FULL,
      ),
    ).toBe("高精度モデルを準備中");
  });

  it("says the model is being prepared once every byte arrived", () => {
    expect(
      modelStateText(
        "loading-model",
        { loaded: 551_055_739, total: 551_055_739, ready: false },
        FULL,
      ),
    ).toBe("高精度モデルを準備中");
  });

  it("names the model that is judging", () => {
    const ready = { loaded: 1, total: 1, ready: true };
    expect(modelStateText("running", ready, NANO)).toBe("v2-nano で判定中");
    expect(modelStateText("running", ready, FULL)).toBe("v2.0.0 で判定中");
    expect(modelStateText("offline", ready, FULL)).toBe("v2.0.0 で判定中");
  });

  it("describes paused and finished desks", () => {
    const ready = { loaded: 1, total: 1, ready: true };
    expect(modelStateText("paused", ready, NANO)).toBe("一時停止中");
    expect(modelStateText("finished", ready, FULL)).toBe("並べ終えました");
  });
});

describe("headlineChange", () => {
  const crooked = { label: "向きがばらばらの写真", value: 36 };

  it("jumps on the first render", () => {
    expect(headlineChange(null, crooked)).toBe("jump");
  });

  it("jumps when the label changes instead of counting down", () => {
    expect(
      headlineChange(crooked, { label: "向きを直した写真", value: 1 }),
    ).toBe("jump");
    expect(
      headlineChange(
        { label: "向きを直した写真", value: 3005 },
        { label: "並べ終えた写真", value: 3005 },
      ),
    ).toBe("jump");
  });

  it("eases within the same label", () => {
    expect(headlineChange(crooked, { ...crooked, value: 48 })).toBe("ease");
  });

  it("does nothing when nothing changed", () => {
    expect(headlineChange(crooked, { ...crooked })).toBe("none");
  });
});

describe("modelOptionText", () => {
  it("names each model with its version and download size", () => {
    expect(modelOptionText(NANO)).toEqual({
      label: "軽量",
      detail: "v2-nano 11.9MB",
      meta: "未使用テスト 81.8%",
    });
    expect(modelOptionText(FULL)).toEqual({
      label: "高精度",
      detail: "v2.0.0 551MB",
      meta: "未使用テスト 99.4%",
    });
  });
});

describe("modelSwitch", () => {
  it("asks before downloading the full model", () => {
    expect(modelSwitch("nano", FULL)).toBe("confirm");
  });

  it("switches back to the light model at once", () => {
    expect(modelSwitch("full", NANO)).toBe("switch");
  });

  it("ignores the current model and unavailable models", () => {
    expect(modelSwitch("nano", NANO)).toBe("none");
    expect(modelSwitch("full", FULL)).toBe("none");
    expect(
      modelSwitch("nano", {
        ...FULL,
        available: false,
        unavailableReason: "このブラウザは WebGPU に対応していないため使えません。",
      }),
    ).toBe("none");
  });
});

describe("switchConfirmText", () => {
  it("states the download size taken from the option", () => {
    expect(switchConfirmText(FULL)).toBe(
      "約551MBのモデルを読み込みます。読み込みが終わるまで写真はばらばらの向きのまま並べておき、終わったらまとめて直します。2回目からはブラウザに保存したモデルを使います。",
    );
  });
});

describe("modelLoadingNote", () => {
  it("shows whole percent while bytes arrive", () => {
    expect(
      modelLoadingNote({ loaded: 231_400_000, total: 551_055_739, ready: false }),
    ).toBe("読み込み中 41%");
    expect(
      modelLoadingNote({ loaded: 0, total: 551_055_739, ready: false }),
    ).toBe("読み込み中 0%");
  });

  it("does not claim progress before the size is known", () => {
    expect(modelLoadingNote({ loaded: 0, total: 0, ready: false })).toBe(
      "読み込み中",
    );
  });

  it("says it is preparing once the download finished", () => {
    expect(
      modelLoadingNote({ loaded: 551_055_739, total: 551_055_739, ready: false }),
    ).toBe("準備中");
  });

  it("is empty once the model is ready", () => {
    expect(
      modelLoadingNote({ loaded: 551_055_739, total: 551_055_739, ready: true }),
    ).toBe("");
  });
});

describe("photoPlace", () => {
  it("names the country where a Commons photo was taken", () => {
    expect(
      photoPlace(source({ location: { lat: -1.29, lon: 36.82, country: "KE" } })),
    ).toBe("ケニア");
  });

  it("falls back to coordinates without a country", () => {
    expect(
      photoPlace(source({ location: { lat: 35.68, lon: 139.77, country: null } })),
    ).toBe("北緯 35.68° 東経 139.77°");
  });

  it("is empty when the place is unknown", () => {
    expect(photoPlace(source({ location: null }))).toBeNull();
    expect(photoPlace(source())).toBeNull();
  });

  it("never shows a place for visitors' photos", () => {
    expect(
      photoPlace(
        source({
          kind: "user",
          attribution: null,
          location: { lat: 35.68, lon: 139.77, country: "JP" },
        }),
      ),
    ).toBeNull();
  });
});

describe("folderScanText", () => {
  it("counts the photos found so far", () => {
    expect(folderScanText(0)).toBe("フォルダを読み込み中");
    expect(folderScanText(340)).toBe("フォルダを読み込み中 340枚");
    expect(folderScanText(1284)).toBe("フォルダを読み込み中 1,284枚");
  });
});

describe("folderProgressText", () => {
  it("says how many photos will be lined up and how many files are left out", () => {
    expect(
      folderProgressText({ found: 1159, accepted: 740, skipped: 419, done: false }),
    ).toBe("740枚を並べます（動画など 419件は対象外）");
  });

  it("omits the left-out part when every file is a photo", () => {
    expect(
      folderProgressText({ found: 12, accepted: 12, skipped: 0, done: false }),
    ).toBe("12枚を並べます");
  });

  it("explains when nothing can be lined up", () => {
    expect(
      folderProgressText({ found: 3, accepted: 0, skipped: 3, done: false }),
    ).toBe("並べられる写真がありませんでした（動画など 3件は対象外）");
    expect(
      folderProgressText({ found: 0, accepted: 0, skipped: 0, done: true }),
    ).toBe("写真が見つかりませんでした");
  });

  it("formats large numbers with separators", () => {
    expect(
      folderProgressText({ found: 4000, accepted: 2512, skipped: 1488, done: false }),
    ).toBe("2,512枚を並べます（動画など 1,488件は対象外）");
  });
});

describe("folderTruncatedText", () => {
  it("states the cap that was applied", () => {
    expect(folderTruncatedText(20000)).toBe(
      "フォルダの中のファイルが多いため、最初の 20,000件だけ読み込みました。",
    );
  });
});
