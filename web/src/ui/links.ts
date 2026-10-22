export const GITHUB_URL = "https://github.com/kandotrun/kururi-ai";

export const RELEASE_URL =
  "https://github.com/kandotrun/kururi-ai/releases/tag/v2.0.0";

export const MODEL_CARD_URL =
  "https://github.com/kandotrun/kururi-ai/blob/main/web/MODEL_CARD.md";

export const FULL_MODEL_CARD_URL =
  "https://github.com/kandotrun/kururi-ai/blob/main/MODEL_CARD.md";

export const CREDITS_PATH = "commons/credits.html";

export const PROVENANCE_PATH = "model/provenance.json";

export const NASA_EARTH_URL = "https://visibleearth.nasa.gov/images/74218";

export const NASA_NIGHT_URL = "https://visibleearth.nasa.gov/images/144898";

export interface FullModelDocs {
  license: string;
  notices: string;
  card: string;
}

export function fullModelDocs(
  baseSetting: string | undefined,
  appBase: string,
): FullModelDocs | null {
  const setting = baseSetting?.trim() ?? "";
  if (setting === "") {
    return null;
  }
  const folder = new URL(setting.endsWith("/") ? setting : `${setting}/`, appBase);
  return {
    license: new URL("LICENSE", folder).href,
    notices: new URL("THIRD_PARTY_NOTICES.md", folder).href,
    card: new URL("MODEL_CARD.md", folder).href,
  };
}
