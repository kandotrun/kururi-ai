import {
  FULL_FALLBACK_BYTES,
  FULL_GENERAL_BYTES,
  NANO_BYTES,
} from "../core/model-profiles";
import { externalLink, h } from "./dom";
import { formatSize } from "./format";
import {
  CREDITS_PATH,
  FULL_MODEL_CARD_URL,
  GITHUB_URL,
  MODEL_CARD_URL,
  NASA_EARTH_URL,
  NASA_NIGHT_URL,
  PROVENANCE_PATH,
  RELEASE_URL,
  fullModelDocs,
} from "./links";

export interface AboutView {
  readonly element: HTMLDialogElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

function section(title: string, body: readonly Node[]): HTMLElement {
  return h("section", { class: "about-section" }, [
    h("h3", {}, [title]),
    ...body,
  ]);
}

function paragraph(children: readonly (Node | string)[]): HTMLParagraphElement {
  return h("p", {}, children);
}

function fact(term: string, detail: string): HTMLElement {
  return h("div", {}, [h("dt", {}, [term]), h("dd", {}, [detail])]);
}

function model(title: string, facts: readonly HTMLElement[]): HTMLElement {
  return h("div", { class: "about-model" }, [
    h("h4", {}, [title]),
    h("dl", { class: "about-facts" }, facts),
  ]);
}

function linkItem(href: string, text: string, external: boolean): HTMLLIElement {
  return h("li", {}, [external ? externalLink(href, text) : h("a", { href }, [text])]);
}

function modelLinks(): HTMLLIElement[] {
  const docs = fullModelDocs(
    import.meta.env.VITE_FULL_MODEL_BASE_URL,
    new URL(import.meta.env.BASE_URL, window.location.href).href,
  );
  if (!docs) {
    return [linkItem(FULL_MODEL_CARD_URL, "v2.0.0 のモデルカード（GitHub）", true)];
  }
  return [
    linkItem(docs.card, "v2.0.0 のモデルカード", true),
    linkItem(docs.license, "v2.0.0 のライセンス（Apache-2.0）", true),
    linkItem(docs.notices, "v2.0.0 の第三者ライセンス表記", true),
  ];
}

export function createAbout(): AboutView {
  const closeButton = h(
    "button",
    { type: "button", class: "about-close", autofocus: true },
    ["閉じる"],
  );
  const tenMark = h("span", { class: "ten-mark", "aria-hidden": "true" }, [
    "天",
  ]);
  const content = h("div", { class: "about-inner" }, [
    h("div", { class: "about-head" }, [
      h("h2", { id: "about-title" }, ["このデモについて"]),
      closeButton,
    ]),
    h("div", { class: "about-lede" }, [
      paragraph([
        "机に並ぶ写真は、Wikimedia Commons の写真をこちらでわざと 90°、180°、270° のどれかに回したものです。1割ほどは回さずにそのまま混ぜています。",
      ]),
      h("p", { class: "about-ten" }, [
        tenMark,
        h("span", {}, [
          "くるりAI は写真ごとに上になる辺を見分けて、その辺に赤い「天」の印を付け、その場で正しい向きに回します。",
        ]),
      ]),
    ]),
    section("答え合わせ", [
      paragraph([
        "どの写真をどれだけ回したかはこちらで分かっているので、判定が合っているかをその場で確かめています。外れた写真は、外れた向きのまま並びます。",
      ]),
      paragraph([
        "画面の正解率はこのデモでの目安で、ベンチマークではありません。Commons の写真の一部はモデルの学習に使った写真と重なっている可能性があり、写真の選び方も評価用のテストとは違います。",
      ]),
    ]),
    section("判定モデル", [
      paragraph([
        "最初は軽量モデルで判定します。「判定モデル」の欄で高精度モデルに切り替えられます。",
      ]),
      model("軽量 v2-nano", [
        fact("大きさ", formatSize(NANO_BYTES)),
        fact("動く場所", "このブラウザの中（WebAssembly）"),
        fact("未使用テストの正解率", "81.82%（99枚×4方向）"),
        fact("構成", "MobileNetV4 の Small と Medium を組み合わせた INT8 モデル"),
      ]),
      model("高精度 v2.0.0", [
        fact("大きさ", `約${formatSize(FULL_GENERAL_BYTES)}`),
        fact(
          "追加の読み込み",
          `判定に迷う写真に使う補助モデル 約${formatSize(FULL_FALLBACK_BYTES)}。メインのモデルの準備ができるとすぐ読み込みます（合わせて約${formatSize(FULL_GENERAL_BYTES + FULL_FALLBACK_BYTES)}）`,
        ),
        fact("動く場所", "このブラウザの中（WebGPU）"),
        fact("未使用テストの正解率", "99.43%（176枚×4方向）"),
        fact("構成", "ConvNeXt の Base と Small を組み合わせたモデル"),
        fact("保存", "一度読み込むとブラウザに保存し、2回目からはダウンロードしません"),
      ]),
      paragraph([
        "正解率は、学習に使っていないテスト用の写真をそれぞれ4つの向きにして測ったものです。2つのテストは別々に用意したもので、数字をそのまま比べることはできません。どちらのモデルも、判定のときは1枚を4方向に回して見て、結果を合わせて向きを決めます。",
      ]),
      paragraph([
        "高精度モデルは WebGPU に対応したブラウザでだけ選べます。読み込みが終わるまでは写真を向きがばらばらのまま並べておき、終わってからまとめて直します。",
      ]),
    ]),
    section("写真の扱い", [
      paragraph([
        "あなたの写真は送信しません。デモ写真は Wikimedia Commons から読み込みます。",
      ]),
      paragraph([
        "自分の写真は、読み込みも判定も表示もこのタブの中で行い、ページを閉じると消えます。ブラウザに保存するのは、高精度モデルを選んだときのモデルのファイルだけです。",
      ]),
      paragraph([
        "フォルダを選ぶか机にドロップすると、中の写真をすべて並べます。動画など写真でないファイルは読み込みません。HEIC の写真は、HEIC を開けるブラウザ（Safari など）でだけ並べられます。DNG や NEF などの RAW ファイルは、ファイルの中にあるプレビュー画像の部分だけを読んで判定します。",
      ]),
    ]),
    section("出典", [
      paragraph([
        "デモ写真は Wikimedia Commons の秀逸な画像から、上下がはっきりしている風景、建物、動物、植物、食べ物、乗り物などを選んでいます。作者とライセンスは写真ごとにクレジット一覧にまとめています。",
      ]),
      paragraph([
        "最初のほうに混ざる5枚は、このリポジトリの作者が撮ったサンプル写真です。横向きや逆さまに撮れたままの写真なので、こちらでは回していません。",
      ]),
      paragraph([
        "オープニングの地球の画像: NASA Earth Observatory（",
        externalLink(NASA_EARTH_URL, "Blue Marble"),
        "、",
        externalLink(NASA_NIGHT_URL, "Black Marble"),
        "、パブリックドメイン）",
      ]),
      h("ul", { class: "about-links" }, [
        linkItem(CREDITS_PATH, "写真のクレジット一覧", false),
        linkItem(MODEL_CARD_URL, "v2-nano のモデルカード（GitHub）", true),
        linkItem(PROVENANCE_PATH, "v2-nano の来歴（provenance.json）", false),
        ...modelLinks(),
        linkItem(RELEASE_URL, "CLI 版 v2.0.0 のダウンロード（GitHub、Mac・Linux）", true),
        linkItem(GITHUB_URL, "ソースコード（GitHub）", true),
      ]),
    ]),
    h("p", { class: "about-license" }, [
      "コードは MIT License です。v2-nano は timm の MobileNetV4、v2.0.0 は timm の ConvNeXt の事前学習済み重み（どちらも Apache-2.0）をもとにしています。",
    ]),
  ]);
  const element = h(
    "dialog",
    { class: "about", "aria-labelledby": "about-title" },
    [content],
  );

  closeButton.addEventListener("click", () => element.close());
  element.addEventListener("click", (event) => {
    if (event.target === element) {
      element.close();
    }
  });

  return {
    element,
    get isOpen() {
      return element.open;
    },
    open() {
      if (!element.open) {
        element.showModal();
      }
    },
    close() {
      if (element.open) {
        element.close();
      }
    },
  };
}
