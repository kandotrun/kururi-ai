import type { DeskScene, Quarter } from "../src/contracts";
import { spiralCell } from "../src/core/layout";
import { mulberry32, type Random } from "../src/core/random";
import { expectedCorrection, pickSimulated } from "../src/core/rotation";
import {
  createDeskScene,
  deskSceneProject,
  deskSceneStats,
  WebGLUnavailableError,
} from "../src/scene/desk-scene";

interface HarnessSource {
  kind: "sample" | "commons" | "synthetic";
  url: string | null;
  aspect: number;
  uprightFix: Quarter;
  label: string;
}

interface FrameReport {
  frames: number;
  averageMs: number;
  p95Ms: number;
  sceneRenderMs: number;
  pixelRatio: number;
  drawCalls: number;
}

type OpeningPhase = "gathering" | "holding" | "released";

interface OpeningReport {
  prints: number;
  inView: number;
  minAcrossPx: number;
  minAlongPx: number;
  medianAcrossPx: number;
}

interface HarnessProgress {
  ready: boolean;
  opening: OpeningPhase;
  openingLandedAt: number;
  releasedAt: number;
  added: number;
  landed: number;
  decided: number;
  placed: number;
  failed: number;
  correct: number;
  scattering: boolean;
  scatters: number;
  finished: boolean;
  commonsLoaded: number;
  commonsFailed: number;
  error: string | null;
  ids: string[];
  scene: DeskScene | null;
  measure(seconds: number): Promise<FrameReport>;
  scatter(): Promise<void>;
  focus(id: string | null): void;
  select(id: string | null): void;
  openingReport(): OpeningReport | null;
  screenPosition(id: string): { x: number; y: number } | null;
  stats(): unknown;
  loseContext(): boolean;
  dispose(): void;
}

declare global {
  interface Window {
    __harness: HarnessProgress;
  }
}

const COMMONS_THUMB = "https://upload.wikimedia.org/wikipedia/commons/thumb/";

const COMMONS: readonly (readonly [number, string])[] = [
  [1.5, "b/bf/Carls_stoll_Bergslagssafari.jpg"],
  [
    1.5,
    "5/54/Kimono_Forest_at_night%2C_Arashiyama_Station%2C_Arashiyama%2C_Kyoto%2C_Japan.jpg",
  ],
  [1.7, "3/36/Donbas_U500_2012_G1.jpg"],
  [1.476, "c/c4/Darwin_%28AU%29%2C_Stokes_Hill_Wharf_--_2019_--_4362.jpg"],
  [1.548, "c/c6/Barranco_Valle_de_la_Fuente_-_Fuerteventura.jpg"],
  [1.333, "c/c2/Colorful_bottle.jpg"],
  [1.778, "5/50/ABOU_KARIM_IV_%28ship%2C_1978%29%2C_S%C3%A8te_01.jpg"],
  [0.667, "c/c9/At_Tenerife_2026_566_-_Musaceae_flower.jpg"],
  [1.493, "2/20/Coloured%2C_textured_craft_card_edit.jpg"],
  [
    1.333,
    "7/74/Langweerderwielen_%28Langwarder_Wielen%29_in_de_mist._01-04-2026._%28d.j.b.%29_08.jpg",
  ],
  [0.75, "2/26/Iwami_squid_drying_DSC01868.jpg"],
  [1.0, "3/3d/Edible_fungi_in_basket_2026_G01.jpg"],
  [1.401, "c/c2/Fluorescence_rainbow.JPG"],
  [
    1.746,
    "7/7c/A_pier_at_a_campsite_during_sunset%2C_Sidney_Spit_%28part_of_Gulf_Islands_National_Park_Reserve%29%2C_Sidney_Island%2C_British_Columbia%2C_Canada_20.jpg",
  ],
  [1.51, "a/ac/Brooklyn_Botanic_Garden_New_York_May_2015_003.jpg"],
  [1.505, "0/01/Alone_in_the_unspoilt_wilderness_%28Unsplash%29.jpg"],
  [0.794, "3/35/Infinity_Edge_Pool%2C_Mauritius.JPG"],
  [
    1.632,
    "d/de/Centro_hist%C3%B3rico%2C_Baku%2C_Azerbaiy%C3%A1n%2C_2016-09-26%2C_DD_221-223_HDR.jpg",
  ],
  [
    1.709,
    "8/8a/Aguarales_de_Valpalmas%2C_Zaragoza%2C_Espa%C3%B1a%2C_2015-01-06%2C_DD_26.JPG",
  ],
  [1.592, "e/e3/Luxembourg_City_Hall_%2854540726309%29.jpg"],
  [0.716, "f/fb/Pavillon_Cour_des_Lions_Alhambra_Granada_Spain.jpg"],
  [
    1.686,
    "2/28/Algar_do_Carvao%2C_isla_de_Terceira%2C_Azores%2C_Portugal%2C_2020-07-25%2C_DD_68-70_HDR.jpg",
  ],
  [1.5, "9/9b/Abstract_pattern_on_a_tree_stump.jpg"],
  [
    0.794,
    "6/6b/Alfred_Stieglitz_-_The_Steerage_-_Google_Art_Project%2C_from_Getty.jpg",
  ],
  [1.433, "4/44/Courtyard_Zappeion_Athens%2C_Greece.jpg"],
  [1.777, "2/2f/Fantastic_%28ship%2C_1996%29_-_S%C3%A8te_-_October_2018.jpg"],
  [1.504, "4/4b/20180915_-_European_Rover_Challenge_-_1531_9129_DxO.jpg"],
  [1.285, "4/47/20090726_Birds_on_stick_Shanghai_Qibao_Imgp1996.jpg"],
  [1.0, "5/55/Bloem_van_een_Geranium_palustre._03-07-2021_%28actm.%29.jpg"],
  [1.5, "0/0a/Calaveras_Tonal%C3%A1_%282%29.jpg"],
  [
    0.606,
    "1/10/Ascensor_del_Monte_de_San_Pedro%2C_La_Coru%C3%B1a%2C_Espa%C3%B1a%2C_2015-09-25%2C_DD_113.JPG",
  ],
  [1.7, "1/12/Bydgoszcz%2C_Przysta%C5%84_Bydgoszcz%2C_okna.jpg"],
  [1.584, "e/e2/13-08-31-Kochtreffen-Wien-RalfR-N3S_7849-024.jpg"],
  [1.5, "b/b3/Arabs_Baths_of_Alhama_de_Granada_in_Andalusia%2C_Spain.jpg"],
  [
    1.5,
    "6/66/D%C3%BClmen%2C_Hausd%C3%BClmen%2C_eisbedeckte_Pflanze_--_2021_--_5015.jpg",
  ],
  [1.5, "a/a3/Amboy_%28California%2C_USA%29_--_2012_--_4.jpg"],
  [1.6, "7/75/Chemical_Challenger_%28ship%2C_2015%29_S%C3%A8te_cf01.jpg"],
  [1.5, "1/1a/A_heap_of_shrimp_shells_on_a_plate_in_Tuntorp_1.jpg"],
  [1.5, "8/8d/A5_Aarebruecke.jpg"],
  [
    1.5,
    "0/02/Rome_%28Italy%29%2C_Piazza_della_Rotonda%2C_Hub_of_a_Coach_--_2013_--_10.jpg",
  ],
  [1.5, "8/81/Edro_III_Shipwreck_LE.jpg"],
  [1.428, "b/b3/Elfbergen_Gaasterland._Brug_over_de_vijver_01.JPG"],
  [1.521, "8/8e/15-10-28-Pont_Bac_de_Roda_Barcelona-RalfR-WMA_3105.jpg"],
  [
    1.5,
    "b/bc/2015-09-18_MS_OCEAN_ENDEAVOUR_-_IMO_7625811%2C_at_Qeqertarsuaq_Island_%28Karrat_Fjord%29%2C_Greenland.jpg",
  ],
  [
    1.48,
    "c/c0/Aekingerzand_Nationaal_Park_Drents-Friese_Wold._11-08-2025._%28actm.%29_09.jpg",
  ],
  [1.0, "4/4d/Cloud_Forest%2C_Gardens_by_the_Bay%2C_Singapore.jpg"],
  [1.5, "3/32/FCCA_GE_C30-7_Infiernillo_Viaduct.jpg"],
  [
    1.444,
    "d/d9/Bridge_to_Don_Khon_seen_from_Don_Det_with_water_reflection_of_stringy_orange_clouds_at_sunrise_in_Laos.jpg",
  ],
  [
    1.5,
    "1/19/Beige_and_brown_oil-paper_umbrella_on_the_edge_of_a_wooden_house_in_Luang_Prabang_Laos.jpg",
  ],
  [
    1.506,
    "e/ed/Klagenfurt_Viktring_Quellenstrasse_Strom-Verbundnetz_13022010_1580.jpg",
  ],
  [
    0.667,
    "0/04/Ascensor_del_Monte_de_San_Pedro%2C_La_Coru%C3%B1a%2C_Espa%C3%B1a%2C_2015-09-25%2C_DD_99.JPG",
  ],
  [1.5, "f/f2/2015_Ribblehead_Viaduct_1.jpg"],
  [1.823, "0/0c/Dam_at_Jalpa_de_Canovas_2.jpg"],
  [
    1.555,
    "2/2d/Bruggetje_in_fietspad_naar_Langweerderwielen._Locatie%2C_Langweerderwielen_%28Langwarder_Wielen%29_en_omgeving_02.jpg",
  ],
  [1.333, "a/a8/Bleu_de_Gex.jpg"],
  [
    0.667,
    "7/79/Duisburg%2C_Landschaftspark_Duisburg-Nord%2C_Hochofenstra%C3%9Fe_--_2025_--_7448-50.jpg",
  ],
  [0.694, "d/d6/Ant_on_golden_club_%2824749%29.jpg"],
  [1.158, "9/9a/Big_Mac_hamburger.jpg"],
  [1.25, "4/4b/Dipsacus_seedling.jpg"],
  [
    1.388,
    "e/e3/2024_Most_%C5%BBelazny_w_K%C5%82odzku_%288%29%2C_pow%C3%B3d%C5%BA.jpg",
  ],
  [
    1.0,
    "0/02/Carved_wooden_bench_furniture_and_crafts_at_Heuan_Chan_heritage_house_in_Luang_Prabang_Laos.jpg",
  ],
  [1.5, "2/20/FCCA_GE_C30-7_Rio_Blanco_-_San_Mateo.jpg"],
  [0.716, "9/98/GokulPithe-Home-Kolkata-West_Bengal-001.jpg"],
  [1.5, "8/8d/Edible_mushrooms_in_baskets_2022_G1.jpg"],
  [1.59, "8/8b/2014_K%C5%82odzko%2C_most_gotycki.jpg"],
  [1.62, "3/30/AB_BDe_4-4_Jakobsbad_-_Urn%C3%A4sch.jpg"],
  [
    1.506,
    "5/53/Arauc%C3%A1rias_ao_fundo_Parque_Nacional_da_Serra_da_Bocaina_-_denoise.jpg",
  ],
  [
    0.667,
    "c/ce/Hydrangea_petiolaris_%28klimhortensia%29%2C_05-03-2024._%28actm.%29_01.jpg",
  ],
  [1.548, "e/eb/07R01.jpg"],
  [
    1.5,
    "1/1a/Ganado%2C_Imehejek%2C_Sud%C3%A1n_del_Sur%2C_2024-01-21%2C_DD_10.jpg",
  ],
  [1.164, "e/ea/Liospiriferina_rostrata_Noir.jpg"],
  [1.778, "d/d8/HDMY_Dannebrog_%28A540%29_2017-08-16.jpg"],
  [1.5, "f/f6/Bangkok_skytrain_sunset.jpg"],
  [
    1.5,
    "d/df/Esponja_%28Scalarispongia_scalaris%29%2C_%C4%8Airkewwa%2C_Malta%2C_Malta%2C_2021-08-24%2C_DD_31.jpg",
  ],
  [1.5, "a/a3/Amboy_%28California%2C_USA%29_--_2012_--_4.jpg"],
  [0.664, "a/a0/Escalator%2C_Public_Hotel_New_York_%282024%29-L1005609.jpg"],
  [1.5, "9/93/Dominostein_edelherb.jpg"],
  [1.504, "8/8d/CVN-69-SPIE-training.jpg"],
  [0.714, "e/ed/Lijsterbes_%28Sorbus%29._31-03-2024_%28d.j.b.%29_02.jpg"],
  [
    0.667,
    "6/64/Half_geopende_bladknop_van_een_lijsterbes_%28Sorbus%29_29-03-2026._%28d.j.b%29.jpg",
  ],
  [
    1.25,
    "a/ab/Bloem_van_een_gele_kamille_%28Cota_tinctoria%29_24-06-2026._%28actm.%29.jpg",
  ],
  [1.636, "1/10/Cranes_made_by_Origami_paper.jpg"],
  [1.335, "2/26/Edible_fungi_in_basket_2012_G1.jpg"],
  [1.778, "8/84/Birka_June_2013.jpg"],
  [0.667, "2/26/Daikanransha.jpg"],
  [1.502, "f/f6/Viagem_inaugural_do_VLT_carioca_02.jpg"],
  [1.506, "d/dc/Coulommiers_lait_cru.jpg"],
  [1.5, "0/02/HMS_Belfast_with_rainbow.jpg"],
  [1.852, "2/2e/Highspeed_6_-_Hellenic_Seaways_-_Santorini_-_Greece_-_02.jpg"],
  [1.443, "e/e9/Egyptian_food_Koshary.jpg"],
  [1.777, "7/7c/Alphonse-Desjardins_%28cropped%29.jpg"],
  [1.1, "4/4e/Edible_fungi_in_basket_2022_G5.jpg"],
  [1.778, "6/61/2013_Cogden_Bridge.jpg"],
  [1.5, "6/67/Alphonse-Desjardins.jpg"],
  [
    1.5,
    "b/b9/Canberra_%28AU%29%2C_Commonwealth_Avenue_Bridge_--_2019_--_1811.jpg",
  ],
  [
    1.333,
    "f/f2/Stranded_mules_during_the_Uttarakhand_Floods_of_2013_as_encountered_by_People_for_Animals_during_a_rescue_operation.jpg",
  ],
];

const SAMPLES: readonly {
  file: string;
  uprightFix: Quarter;
  aspect: number;
}[] = [
  { file: "sample1.webp", uprightFix: 3, aspect: 1600 / 1067 },
  { file: "sample2.webp", uprightFix: 3, aspect: 1600 / 1067 },
  { file: "sample3.webp", uprightFix: 1, aspect: 1600 / 1200 },
  { file: "sample4.webp", uprightFix: 3, aspect: 1600 / 1067 },
  { file: "sample5.jpg", uprightFix: 2, aspect: 1200 / 1600 },
];

const SAMPLE_POSITIONS = [2, 6, 11, 17, 24];

const params = new URLSearchParams(location.search);

function numberParam(name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const total = Math.max(1, Math.floor(numberParam("n", 600)));
const rate = Math.max(0.5, numberParam("rate", 12));
const reduced = params.get("reduced") === "1";
const autoScatter = params.get("scatter") === "1";
const seed = Math.floor(numberParam("seed", 1));
const lowPower = params.get("low") === "1";
const useCommons = params.get("commons") !== "0";
const workers = Math.max(1, Math.floor(numberParam("workers", 6)));
const inferMs = Math.max(0, numberParam("infer", 245));
const accuracy = Math.min(1, Math.max(0, numberParam("accuracy", 0.9)));
const maxPile = Math.max(1, Math.floor(numberParam("pile", 16)));
const maxLoading = Math.max(1, Math.floor(numberParam("loading", 8)));
const focusAt = Math.floor(numberParam("focus", -1));
const showHud = params.get("hud") === "1";
const openingBatch = Math.max(0, Math.floor(numberParam("opening", 36)));
const holdMs = Math.max(0, numberParam("hold", 2000));
const beatMs = reduced ? 0 : 280;

const random: Random = mulberry32(seed);

const progress: HarnessProgress = {
  ready: false,
  opening: openingBatch > 0 ? "gathering" : "released",
  openingLandedAt: -1,
  releasedAt: -1,
  added: 0,
  landed: 0,
  decided: 0,
  placed: 0,
  failed: 0,
  correct: 0,
  scattering: false,
  scatters: 0,
  finished: false,
  commonsLoaded: 0,
  commonsFailed: 0,
  error: null,
  ids: [],
  scene: null,
  measure: () => Promise.reject(new Error("scene not ready")),
  scatter: () => Promise.resolve(),
  focus: () => undefined,
  select: () => undefined,
  openingReport: () => null,
  screenPosition: () => null,
  stats: () => null,
  loseContext: () => false,
  dispose: () => undefined,
};
window.__harness = progress;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSources(): HarnessSource[] {
  const sources: HarnessSource[] = [];
  let commonsIndex = 0;
  let sampleIndex = 0;
  for (let position = 0; position < total; position += 1) {
    const sample = SAMPLES[sampleIndex];
    if (sample && SAMPLE_POSITIONS[sampleIndex] === position) {
      sources.push({
        kind: "sample",
        url: `${import.meta.env.BASE_URL}samples/${sample.file}`,
        aspect: sample.aspect,
        uprightFix: sample.uprightFix,
        label: sample.file,
      });
      sampleIndex += 1;
      continue;
    }
    const commons = COMMONS[commonsIndex % COMMONS.length];
    const useThis = useCommons && commons !== undefined;
    commonsIndex += 1;
    if (useThis && commons) {
      const [aspect, path] = commons;
      const base = path.slice(path.lastIndexOf("/") + 1);
      sources.push({
        kind: "commons",
        url: `${COMMONS_THUMB}${path}/330px-${base}`,
        aspect,
        uprightFix: 0,
        label: decodeURIComponent(base),
      });
      continue;
    }
    sources.push({
      kind: "synthetic",
      url: null,
      aspect:
        [1.5, 1.333, 0.75, 0.667, 1, 1.778, 1.5, 1.25][position % 8] ?? 1.5,
      uprightFix: 0,
      label: `synthetic-${position}`,
    });
  }
  return sources;
}

const SKIES = [
  ["#9cc9e6", "#e9f1f4"],
  ["#f2b38a", "#fbe4c8"],
  ["#6e8fb8", "#c8d6e6"],
  ["#c6d9c1", "#f1f3e6"],
  ["#2f4a72", "#8aa2c4"],
  ["#e7c4c9", "#f7ece7"],
] as const;

const GROUNDS = [
  "#4f6b3c",
  "#7a6a4f",
  "#38544f",
  "#8b7a5c",
  "#2f3d2b",
  "#a08b6a",
];

function syntheticPhoto(
  index: number,
  aspect: number,
  tile: number,
): HTMLCanvasElement {
  const width = aspect >= 1 ? tile : Math.round(tile * aspect);
  const height = aspect >= 1 ? Math.round(tile / aspect) : tile;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }
  const local = mulberry32(index * 7919 + 13);
  const sky = SKIES[index % SKIES.length] ?? SKIES[0];
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, sky[0]);
  gradient.addColorStop(1, sky[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(255, 246, 216, 0.9)";
  context.beginPath();
  context.arc(
    width * (0.2 + local() * 0.6),
    height * (0.18 + local() * 0.15),
    height * 0.08,
    0,
    Math.PI * 2,
  );
  context.fill();
  const horizon = height * (0.55 + local() * 0.12);
  context.fillStyle = GROUNDS[(index * 5) % GROUNDS.length] ?? "#4f6b3c";
  context.beginPath();
  context.moveTo(0, horizon);
  for (let step = 0; step <= 8; step += 1) {
    context.lineTo((width * step) / 8, horizon - local() * height * 0.18);
  }
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();
  context.fillStyle = "rgba(20, 30, 28, 0.55)";
  const houseX = width * (0.25 + local() * 0.4);
  const houseW = width * 0.16;
  context.fillRect(houseX, horizon - height * 0.1, houseW, height * 0.12);
  context.beginPath();
  context.moveTo(houseX - houseW * 0.1, horizon - height * 0.1);
  context.lineTo(houseX + houseW / 2, horizon - height * 0.2);
  context.lineTo(houseX + houseW * 1.1, horizon - height * 0.1);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.font = `700 ${Math.round(height * 0.13)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.fillText("TOP", width / 2, height * 0.16);
  return canvas;
}

async function loadBitmap(
  source: HarnessSource,
  index: number,
  tile: number,
): Promise<{ image: ImageBitmap; aspect: number }> {
  if (source.url) {
    try {
      const response = await fetch(source.url, { mode: "cors" });
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const blob = await response.blob();
      const probe = await createImageBitmap(blob, {
        imageOrientation: "from-image",
      });
      const aspect = probe.width / Math.max(1, probe.height);
      const width = aspect >= 1 ? tile : Math.round(tile * aspect);
      const height = aspect >= 1 ? Math.round(tile / aspect) : tile;
      const image = await createImageBitmap(probe, {
        resizeWidth: Math.max(1, width),
        resizeHeight: Math.max(1, height),
        resizeQuality: "high",
      });
      probe.close();
      if (source.kind === "commons") {
        progress.commonsLoaded += 1;
      }
      return { image, aspect };
    } catch {
      if (source.kind === "commons") {
        progress.commonsFailed += 1;
      }
    }
  }
  const canvas = syntheticPhoto(index, source.aspect, tile);
  const image = await createImageBitmap(canvas);
  return { image, aspect: source.aspect };
}

function wrongCorrection(right: Quarter, local: Random): Quarter {
  const offset = 1 + Math.floor(local() * 3);
  return ((right + offset) % 4) as Quarter;
}

async function run(): Promise<void> {
  const canvas = document.getElementById("desk");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("canvas missing");
  }
  let scene: DeskScene;
  try {
    scene = createDeskScene(canvas, { reducedMotion: reduced, lowPower });
  } catch (error) {
    progress.error =
      error instanceof WebGLUnavailableError
        ? "webgl-unavailable"
        : String(error);
    return;
  }
  progress.scene = scene;
  scene.start();
  const loupe = document.getElementById("loupe");
  const hud = document.getElementById("hud");
  scene.on("hover", (id, at) => {
    if (!loupe) {
      return;
    }
    if (id && at) {
      loupe.hidden = false;
      loupe.style.left = `${at.x}px`;
      loupe.style.top = `${at.y}px`;
      loupe.dataset.id = id;
    } else {
      loupe.hidden = true;
    }
  });
  scene.on("select", (id) => {
    document.body.dataset.selected = id ?? "";
  });
  progress.scatter = async () => {
    progress.scattering = true;
    await scene.scatterAll();
    progress.scattering = false;
    progress.scatters += 1;
  };
  progress.focus = (id) => scene.focus(id);
  progress.select = (id) => scene.select(id);
  progress.openingReport = () => openingReport(scene, canvas);
  progress.screenPosition = (id) => scene.screenPosition(id);
  progress.stats = () => deskSceneStats(scene);
  progress.measure = (seconds) => measureFrames(scene, seconds);
  progress.loseContext = () => {
    const context = canvas.getContext("webgl2");
    const extension = context?.getExtension("WEBGL_lose_context");
    if (!extension) {
      return false;
    }
    extension.loseContext();
    return true;
  };
  progress.dispose = () => scene.dispose();
  progress.ready = true;

  if (hud && showHud) {
    hud.hidden = false;
    setInterval(() => {
      const stats = deskSceneStats(scene);
      hud.textContent = [
        `added ${progress.added} / landed ${progress.landed} / placed ${progress.placed}`,
        `commons ${progress.commonsLoaded} ok, ${progress.commonsFailed} failed`,
        `opening ${progress.opening}`,
        stats
          ? `mode ${stats.mode}  draw ${stats.drawCalls}  dpr ${stats.pixelRatio}`
          : "",
        stats ? `render ${stats.renderMs.toFixed(2)} ms` : "",
      ].join("\n");
    }, 500);
  }

  const sources = buildSources().slice(0, scene.capacity);
  const local = mulberry32(seed * 31 + 7);
  let nextSlot = 0;
  let pile = 0;
  let loading = 0;
  let idleWorkers = workers;
  const workerQueue: (() => void)[] = [];
  const pending: Promise<void>[] = [];
  const releaseWaiters: (() => void)[] = [];
  const openingTarget = Math.min(openingBatch, sources.length);

  const release = (): void => {
    progress.opening = "released";
    progress.releasedAt = performance.now();
    for (const resolve of releaseWaiters.splice(0)) {
      resolve();
    }
  };
  const updateOpening = (): void => {
    if (progress.opening !== "gathering" || progress.landed < openingTarget) {
      return;
    }
    progress.opening = "holding";
    progress.openingLandedAt = performance.now();
    setTimeout(release, holdMs);
  };
  const waitForRelease = (): Promise<void> =>
    progress.opening === "released"
      ? Promise.resolve()
      : new Promise((resolve) => releaseWaiters.push(resolve));
  const pileLimit = (): number =>
    progress.opening === "released"
      ? maxPile
      : Math.max(maxPile, openingTarget);

  const acquireWorker = (): Promise<void> => {
    if (idleWorkers > 0) {
      idleWorkers -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => workerQueue.push(resolve));
  };
  const releaseWorker = (): void => {
    const next = workerQueue.shift();
    if (next) {
      next();
    } else {
      idleWorkers += 1;
    }
  };

  const processOne = async (
    index: number,
    source: HarnessSource,
  ): Promise<void> => {
    const id = `print-${index}`;
    const simulated: Quarter =
      source.kind === "sample" ? 0 : pickSimulated(local);
    loading += 1;
    const { image, aspect } = await loadBitmap(source, index, scene.tileSize);
    loading -= 1;
    pile += 1;
    progress.added += 1;
    progress.ids.push(id);
    const slot = nextSlot;
    nextSlot += 1;
    try {
      await scene.addPrint({
        id,
        slot,
        aspect,
        simulated,
        image,
        emphasis: index === focusAt,
      });
    } catch (error) {
      pile -= 1;
      throw error;
    }
    progress.landed += 1;
    updateOpening();
    if (index === focusAt) {
      scene.focus(id);
    }
    await waitForRelease();
    await acquireWorker();
    scene.setScanning(id, true);
    await wait(inferMs * (0.8 + local() * 0.4));
    scene.setScanning(id, false);
    releaseWorker();
    const right = expectedCorrection(source.uprightFix, simulated);
    const isRight = local() < accuracy;
    const correction = isRight ? right : wrongCorrection(right, local);
    if (isRight) {
      progress.correct += 1;
    }
    scene.decide(id, correction);
    progress.decided += 1;
    await wait(beatMs);
    pile -= 1;
    await scene.place(id, slot);
    progress.placed += 1;
    if (index === focusAt) {
      await wait(1500);
      scene.focus(null);
    }
  };

  const interval = 1000 / rate;
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!source) {
      continue;
    }
    while (pile >= pileLimit() || loading >= maxLoading) {
      await wait(20);
    }
    pending.push(
      processOne(index, source).catch((error: unknown) => {
        progress.failed += 1;
        progress.error = String(error);
      }),
    );
    await wait(interval);
  }
  await Promise.all(pending);
  progress.finished = true;
  if (autoScatter) {
    await wait(600);
    await progress.scatter();
  }
}

function openingReport(
  scene: DeskScene,
  canvas: HTMLCanvasElement,
): OpeningReport {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const half = 0.45;
  const across: number[] = [];
  const along: number[] = [];
  let inView = 0;
  const count = Math.min(openingBatch, progress.landed);
  for (let slot = 0; slot < count; slot += 1) {
    const cell = spiralCell(slot);
    const centre = deskSceneProject(scene, cell.x, 0, cell.z);
    const left = deskSceneProject(scene, cell.x - half, 0, cell.z);
    const right = deskSceneProject(scene, cell.x + half, 0, cell.z);
    const near = deskSceneProject(scene, cell.x, 0, cell.z + half);
    const far = deskSceneProject(scene, cell.x, 0, cell.z - half);
    if (!centre || !left || !right || !near || !far) {
      continue;
    }
    const corners = [left, right, near, far];
    if (
      corners.every(
        (point) =>
          point.x >= 0 &&
          point.x <= width &&
          point.y >= 0 &&
          point.y <= height,
      )
    ) {
      inView += 1;
    }
    across.push(Math.hypot(right.x - left.x, right.y - left.y));
    along.push(Math.hypot(near.x - far.x, near.y - far.y));
  }
  const sorted = [...across].sort((left, right) => left - right);
  return {
    prints: count,
    inView,
    minAcrossPx: Math.min(...across),
    minAlongPx: Math.min(...along),
    medianAcrossPx: sorted[Math.floor(sorted.length / 2)] ?? 0,
  };
}

function measureFrames(
  scene: DeskScene,
  seconds: number,
): Promise<FrameReport> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    const before = deskSceneStats(scene);
    let last = performance.now();
    const started = last;
    const tick = (time: number): void => {
      intervals.push(time - last);
      last = time;
      if (time - started < seconds * 1000) {
        requestAnimationFrame(tick);
        return;
      }
      const after = deskSceneStats(scene);
      const sorted = [...intervals].sort((left, right) => left - right);
      const sum = intervals.reduce((total, value) => total + value, 0);
      const frames = after && before ? after.frames - before.frames : 0;
      const renderTotal =
        after && before
          ? after.renderMs * after.frames - before.renderMs * before.frames
          : 0;
      resolve({
        frames: intervals.length,
        averageMs: sum / Math.max(1, intervals.length),
        p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        sceneRenderMs: frames > 0 ? renderTotal / frames : 0,
        pixelRatio: after?.pixelRatio ?? 0,
        drawCalls: after?.drawCalls ?? 0,
      });
    };
    requestAnimationFrame((time) => {
      last = time;
      requestAnimationFrame(tick);
    });
  });
}

run().catch((error: unknown) => {
  progress.error = String(error);
});
