import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CommonsEntry, CommonsManifest } from "../contracts";
import {
  commonsPageUrl,
  commonsSource,
  commonsThumbUrl,
  commonsTopicLabel,
  decodeManifest,
} from "./manifest";

const LONG_FILE = `${"Very_long_descriptive_file_name_".repeat(6)}end.jpg`;

function rawManifest(): Record<string, unknown> {
  return {
    version: 1,
    generatedAt: "2026-10-21T00:00:00.000Z",
    thumbBase: "https://upload.wikimedia.org/wikipedia/commons/thumb/",
    pageBase: "https://commons.wikimedia.org/wiki/File:",
    licenses: [
      ["CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0"],
      ["Public domain", null],
    ],
    topics: ["cityscapes", "birds"],
    authors: ["Dietmar Rabich", "Adam Cuerden"],
    items: [
      ["Amboy_(California,_USA)_--_2012_--_4.jpg", "a3", 4693, 3129, 0, 0, 0],
      [
        "Detroit_Publishing_Company_-_Shakespeare's_Memorial_Theatre,_Stratford-on-Avon,_England.jpg",
        "02",
        3506,
        2587,
        1,
        1,
        1,
      ],
      [LONG_FILE, "4f", 1800, 2400, 0, 0, 1, "thumbnail.jpg"],
    ],
  };
}

function decoded(): CommonsManifest {
  return decodeManifest(rawManifest());
}

function entry(manifest: CommonsManifest, index: number): CommonsEntry {
  const item = manifest.items[index];
  if (!item) {
    throw new Error(`missing entry ${index}`);
  }
  return item;
}

function withItem(item: unknown): Record<string, unknown> {
  return { ...rawManifest(), items: [item] };
}

describe("decodeManifest", () => {
  it("expands compact rows through the index tables", () => {
    const manifest = decoded();
    expect(manifest.version).toBe(1);
    expect(manifest.generatedAt).toBe("2026-10-21T00:00:00.000Z");
    expect(manifest.topics).toEqual(["cityscapes", "birds"]);
    expect(manifest.licenses).toEqual([
      {
        name: "CC BY-SA 4.0",
        url: "https://creativecommons.org/licenses/by-sa/4.0",
      },
      { name: "Public domain", url: null },
    ]);
    expect(manifest.items).toHaveLength(3);
    expect(entry(manifest, 1)).toEqual({
      file: "Detroit_Publishing_Company_-_Shakespeare's_Memorial_Theatre,_Stratford-on-Avon,_England.jpg",
      hash: "02",
      width: 3506,
      height: 2587,
      author: "Adam Cuerden",
      license: 1,
      topic: "birds",
      thumbName: null,
      location: null,
    });
    expect(entry(manifest, 2).thumbName).toBe("thumbnail.jpg");
    expect(entry(manifest, 2).location).toBeNull();
  });

  it("rejects values that are not a manifest object", () => {
    expect(() => decodeManifest(null)).toThrow(/manifest/);
    expect(() => decodeManifest([])).toThrow(/manifest/);
    expect(() => decodeManifest("{}")).toThrow(/manifest/);
  });

  it("rejects an unknown version", () => {
    expect(() => decodeManifest({ ...rawManifest(), version: 2 })).toThrow(
      /version/,
    );
  });

  it("rejects missing or malformed header fields", () => {
    const { generatedAt: _generatedAt, ...withoutDate } = rawManifest();
    expect(() => decodeManifest(withoutDate)).toThrow(/generatedAt/);
    expect(() =>
      decodeManifest({ ...rawManifest(), thumbBase: "http://example.com/" }),
    ).toThrow(/thumbBase/);
    expect(() =>
      decodeManifest({
        ...rawManifest(),
        pageBase: "https://commons.wikimedia.org/wiki",
      }),
    ).toThrow(/pageBase/);
    expect(() => decodeManifest({ ...rawManifest(), topics: [1] })).toThrow(
      /topics\[0\]/,
    );
    expect(() =>
      decodeManifest({ ...rawManifest(), licenses: [["CC0"]] }),
    ).toThrow(/licenses\[0\]/);
    expect(() =>
      decodeManifest({ ...rawManifest(), authors: "Diliff" }),
    ).toThrow(/authors/);
    expect(() => decodeManifest({ ...rawManifest(), items: {} })).toThrow(
      /items/,
    );
  });

  it("names the offending row and field", () => {
    expect(() => decodeManifest(withItem(["a.jpg", "a3", 10, 10]))).toThrow(
      /items\[0\]/,
    );
    expect(() =>
      decodeManifest(withItem(["", "a3", 10, 10, 0, 0, 0])),
    ).toThrow(/items\[0\].*file/);
    expect(() =>
      decodeManifest(withItem(["a b.jpg", "a3", 10, 10, 0, 0, 0])),
    ).toThrow(/items\[0\].*file/);
    expect(() =>
      decodeManifest(withItem(["a.jpg", "A3", 10, 10, 0, 0, 0])),
    ).toThrow(/items\[0\].*hash/);
    expect(() =>
      decodeManifest(withItem(["a.jpg", "a3", 0, 10, 0, 0, 0])),
    ).toThrow(/items\[0\].*width/);
    expect(() =>
      decodeManifest(withItem(["a.jpg", "a3", 10, 1.5, 0, 0, 0])),
    ).toThrow(/items\[0\].*height/);
    expect(() =>
      decodeManifest(withItem(["a.jpg", "a3", 10, 10, 9, 0, 0])),
    ).toThrow(/items\[0\].*author/);
    expect(() =>
      decodeManifest(withItem(["a.jpg", "a3", 10, 10, 0, 2, 0])),
    ).toThrow(/items\[0\].*license/);
    expect(() =>
      decodeManifest(withItem(["a.jpg", "a3", 10, 10, 0, 0, -1])),
    ).toThrow(/items\[0\].*topic/);
    expect(() =>
      decodeManifest(withItem(["a.jpg", "a3", 10, 10, 0, 0, 0, 7])),
    ).toThrow(/items\[0\].*thumbName/);
    expect(() =>
      decodeManifest(withItem(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 1])),
    ).toThrow(/items\[0\]/);
  });

  it("accepts an explicit null thumbName", () => {
    const manifest = decodeManifest(
      withItem(["a.jpg", "a3", 10, 10, 0, 0, 0, null]),
    );
    expect(entry(manifest, 0).thumbName).toBeNull();
  });
});

describe("decodeManifest locations", () => {
  function located(...rows: unknown[]): Record<string, unknown> {
    return { ...rawManifest(), countries: ["JP", "KE"], items: rows };
  }

  it("decodes coordinates and the country through the countries table", () => {
    const manifest = decodeManifest(
      located(
        ["a.jpg", "a3", 10, 10, 0, 0, 0, null, -1.29, 36.82, 1],
        ["b.jpg", "b4", 10, 10, 0, 0, 0, "thumbnail.jpg", 35.68, 139.77, 0],
      ),
    );
    expect(entry(manifest, 0).location).toEqual({
      lat: -1.29,
      lon: 36.82,
      country: "KE",
    });
    expect(entry(manifest, 0).thumbName).toBeNull();
    expect(entry(manifest, 1).location).toEqual({
      lat: 35.68,
      lon: 139.77,
      country: "JP",
    });
    expect(entry(manifest, 1).thumbName).toBe("thumbnail.jpg");
  });

  it("keeps coordinates without a country", () => {
    const manifest = decodeManifest(
      located(["a.jpg", "a3", 10, 10, 0, 0, 0, null, -54.8, -68.3]),
    );
    expect(entry(manifest, 0).location).toEqual({
      lat: -54.8,
      lon: -68.3,
      country: null,
    });
  });

  it("accepts the extreme coordinates", () => {
    const manifest = decodeManifest(
      located(
        ["a.jpg", "a3", 10, 10, 0, 0, 0, null, 90, 180],
        ["b.jpg", "a3", 10, 10, 0, 0, 0, null, -90, -180],
      ),
    );
    expect(entry(manifest, 0).location).toEqual({
      lat: 90,
      lon: 180,
      country: null,
    });
    expect(entry(manifest, 1).location).toEqual({
      lat: -90,
      lon: -180,
      country: null,
    });
  });

  it("decodes manifests without a countries table", () => {
    const manifest = decodeManifest(
      withItem(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 48.21, 16.37]),
    );
    expect(entry(manifest, 0).location).toEqual({
      lat: 48.21,
      lon: 16.37,
      country: null,
    });
    expect(() =>
      decodeManifest(
        withItem(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 48.21, 16.37, 0]),
      ),
    ).toThrow(/items\[0\].*country/);
  });

  it("rejects a malformed countries table", () => {
    expect(() =>
      decodeManifest({ ...rawManifest(), countries: "JP" }),
    ).toThrow(/countries/);
    expect(() =>
      decodeManifest({ ...rawManifest(), countries: ["JP", "jp"] }),
    ).toThrow(/countries\[1\]/);
    expect(() =>
      decodeManifest({ ...rawManifest(), countries: ["JPN"] }),
    ).toThrow(/countries\[0\]/);
    expect(() =>
      decodeManifest({ ...rawManifest(), countries: [392] }),
    ).toThrow(/countries\[0\]/);
  });

  it("names the offending location field", () => {
    expect(() =>
      decodeManifest(located(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 35.68])),
    ).toThrow(/items\[0\]/);
    expect(() =>
      decodeManifest(
        located(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 90.5, 139.77]),
      ),
    ).toThrow(/items\[0\].*lat/);
    expect(() =>
      decodeManifest(
        located(["a.jpg", "a3", 10, 10, 0, 0, 0, null, "35.68", 139.77]),
      ),
    ).toThrow(/items\[0\].*lat/);
    expect(() =>
      decodeManifest(
        located(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 35.68, -180.01]),
      ),
    ).toThrow(/items\[0\].*lon/);
    expect(() =>
      decodeManifest(
        located(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 35.68, Number.NaN]),
      ),
    ).toThrow(/items\[0\].*lon/);
    expect(() =>
      decodeManifest(
        located(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 35.68, 139.77, 2]),
      ),
    ).toThrow(/items\[0\].*country/);
    expect(() =>
      decodeManifest(
        located(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 35.68, 139.77, null]),
      ),
    ).toThrow(/items\[0\].*country/);
    expect(() =>
      decodeManifest(
        located(["a.jpg", "a3", 10, 10, 0, 0, 0, null, 35.68, 139.77, 0, 1]),
      ),
    ).toThrow(/items\[0\]/);
  });
});

describe("commonsThumbUrl", () => {
  it("builds the hashed thumbnail path with strict percent-encoding", () => {
    const manifest = decoded();
    expect(commonsThumbUrl(manifest, entry(manifest, 0), 330)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Amboy_%28California%2C_USA%29_--_2012_--_4.jpg/330px-Amboy_%28California%2C_USA%29_--_2012_--_4.jpg",
    );
    expect(commonsThumbUrl(manifest, entry(manifest, 1), 960)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Detroit_Publishing_Company_-_Shakespeare%27s_Memorial_Theatre%2C_Stratford-on-Avon%2C_England.jpg/960px-Detroit_Publishing_Company_-_Shakespeare%27s_Memorial_Theatre%2C_Stratford-on-Avon%2C_England.jpg",
    );
  });

  it("encodes non-ASCII names and reserved characters", () => {
    const manifest = decodeManifest(
      withItem([
        "2017_-_Київ_-_Місячний_вечір_на_Замковій_горі.jpg",
        "21",
        2755,
        2350,
        0,
        0,
        0,
      ]),
    );
    expect(commonsThumbUrl(manifest, entry(manifest, 0), 330)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/2017_-_%D0%9A%D0%B8%D1%97%D0%B2_-_%D0%9C%D1%96%D1%81%D1%8F%D1%87%D0%BD%D0%B8%D0%B9_%D0%B2%D0%B5%D1%87%D1%96%D1%80_%D0%BD%D0%B0_%D0%97%D0%B0%D0%BC%D0%BA%D0%BE%D0%B2%D1%96%D0%B9_%D0%B3%D0%BE%D1%80%D1%96.jpg/330px-2017_-_%D0%9A%D0%B8%D1%97%D0%B2_-_%D0%9C%D1%96%D1%81%D1%8F%D1%87%D0%BD%D0%B8%D0%B9_%D0%B2%D0%B5%D1%87%D1%96%D1%80_%D0%BD%D0%B0_%D0%97%D0%B0%D0%BC%D0%BA%D0%BE%D0%B2%D1%96%D0%B9_%D0%B3%D0%BE%D1%80%D1%96.jpg",
    );
    const plus = decodeManifest(
      withItem(["Zug_16x9+R_!*~&=?#.JPG", "a2", 4000, 2250, 0, 0, 0]),
    );
    expect(commonsThumbUrl(plus, entry(plus, 0), 330)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Zug_16x9%2BR_%21%2A~%26%3D%3F%23.JPG/330px-Zug_16x9%2BR_%21%2A~%26%3D%3F%23.JPG",
    );
  });

  it("uses the stored thumbnail name for very long files", () => {
    const manifest = decoded();
    expect(commonsThumbUrl(manifest, entry(manifest, 2), 960)).toBe(
      `https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/${LONG_FILE}/960px-thumbnail.jpg`,
    );
  });
});

describe("commonsPageUrl", () => {
  it("keeps MediaWiki's readable punctuation in page links", () => {
    const manifest = decoded();
    expect(commonsPageUrl(manifest, entry(manifest, 0))).toBe(
      "https://commons.wikimedia.org/wiki/File:Amboy_(California,_USA)_--_2012_--_4.jpg",
    );
    expect(commonsPageUrl(manifest, entry(manifest, 1))).toBe(
      "https://commons.wikimedia.org/wiki/File:Detroit_Publishing_Company_-_Shakespeare%27s_Memorial_Theatre,_Stratford-on-Avon,_England.jpg",
    );
  });

  it("percent-encodes characters that would break the link", () => {
    const manifest = decodeManifest(
      withItem(["Café_&_bar_?_50%_#1.jpg", "a2", 4000, 2250, 0, 0, 0]),
    );
    expect(commonsPageUrl(manifest, entry(manifest, 0))).toBe(
      "https://commons.wikimedia.org/wiki/File:Caf%C3%A9_%26_bar_%3F_50%25_%231.jpg",
    );
  });
});

describe("commonsSource", () => {
  it("describes a Commons photo for the stream", () => {
    const manifest = decoded();
    expect(commonsSource(manifest, entry(manifest, 0), "commons-0")).toEqual({
      id: "commons-0",
      kind: "commons",
      title: "Amboy (California, USA) -- 2012 -- 4",
      aspect: 4693 / 3129,
      thumbUrl: commonsThumbUrl(manifest, entry(manifest, 0), 330),
      largeUrl: commonsThumbUrl(manifest, entry(manifest, 0), 960),
      file: null,
      attribution: {
        author: "Dietmar Rabich",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
        pageUrl:
          "https://commons.wikimedia.org/wiki/File:Amboy_(California,_USA)_--_2012_--_4.jpg",
      },
      uprightFix: 0,
      location: null,
    });
  });

  it("carries the capture location", () => {
    const manifest = decodeManifest({
      ...rawManifest(),
      countries: ["KE"],
      items: [["a.jpg", "a3", 10, 10, 0, 0, 0, null, -1.29, 36.82, 0]],
    });
    expect(commonsSource(manifest, entry(manifest, 0), "x").location).toEqual({
      lat: -1.29,
      lon: 36.82,
      country: "KE",
    });
  });

  it("treats an entry without a location field as unknown", () => {
    const manifest = decoded();
    const { location: _location, ...bare } = entry(manifest, 0);
    expect(commonsSource(manifest, bare, "x").location).toBeNull();
  });

  it("keeps a null license URL and strips upper-case extensions", () => {
    const manifest = decodeManifest({
      ...rawManifest(),
      items: [["Gdansk,_2013-05-20,_DD_01.JPG", "59", 4982, 3060, 1, 1, 0]],
    });
    const source = commonsSource(manifest, entry(manifest, 0), "commons-9");
    expect(source.title).toBe("Gdansk, 2013-05-20, DD 01");
    expect(source.attribution?.licenseUrl).toBeNull();
    expect(source.attribution?.license).toBe("Public domain");
  });

  it("only strips the last extension", () => {
    const manifest = decodeManifest(
      withItem(["Ericushöft_(Hamburg).14.12471.ajb.jpg", "a2", 4000, 2250, 0, 0, 0]),
    );
    expect(commonsSource(manifest, entry(manifest, 0), "x").title).toBe(
      "Ericushöft (Hamburg).14.12471.ajb",
    );
  });
});

describe("commonsTopicLabel", () => {
  it("names known topics in Japanese", () => {
    expect(commonsTopicLabel("birds")).toBe("鳥");
    expect(commonsTopicLabel("cityscapes")).toBe("街並み");
  });

  it("falls back to the topic key", () => {
    expect(commonsTopicLabel("volcanoes")).toBe("volcanoes");
  });
});

describe("shipped manifest", () => {
  const manifest = decodeManifest(
    JSON.parse(
      readFileSync(
        new URL("../../public/commons/manifest.json", import.meta.url),
        "utf8",
      ),
    ),
  );

  it("holds a few thousand distinct, usable photos", () => {
    expect(manifest.items.length).toBeGreaterThanOrEqual(2000);
    expect(new Set(manifest.items.map((item) => item.file)).size).toBe(
      manifest.items.length,
    );
    for (const item of manifest.items) {
      const aspect = item.width / item.height;
      expect(aspect).toBeGreaterThanOrEqual(0.5);
      expect(aspect).toBeLessThanOrEqual(2);
      expect(item.width).toBeGreaterThan(960);
      expect(item.author.length).toBeGreaterThan(0);
    }
  });

  it("keeps every author credit whole and free of e-mail addresses", () => {
    for (const item of manifest.items) {
      expect(item.author, item.file).not.toMatch(/…$/);
      expect(item.author, item.file).not.toContain("@");
      expect(item.author, item.file).not.toMatch(/\(\s*\)/);
      expect(item.author, item.file).not.toMatch(/^Feel free\b/);
    }
  });

  it("keeps the attribution the licensors asked for", () => {
    const authorOf = (file: string): string => {
      const item = manifest.items.find((entry) => entry.file === file);
      expect(item, file).toBeDefined();
      return item?.author ?? "";
    };
    const expected: readonly [string, string][] = [
      [
        "Tulip_Tulipa_clusiana_'Lady_Jane'_Rock_Ledge_Flower_Edit_2000px.jpg",
        "Co-attribution must be given to the Chanticleer Garden.",
      ],
      [
        "Lotus_Nelumbo_'Mrs._Perry_D._Slocum'_Dried_Seed_Head_2000px.jpg",
        "Co-attribution must be given to the Chanticleer Garden.",
      ],
      ["Audi_e-tron_(Edit1).jpg", "Retouched by: LiveChocolate"],
      ["Rhinechis_scalaris_cropped.jpg", "derivative work: Papa Lima Whiskey 2"],
      ["Translohr_STE4_-_143.jpg", "credit the author (William Crochot)"],
      [
        "Our_Lady_of_Mount_Carmel_and_St_Pauls_Pro-Cathedral.jpg",
        "Please credit this with: Photo: Anton Zelenov",
      ],
      ["Hylobates_lar_-_Kaeng_Krachan_WB.jpg", "JJ Harrison"],
    ];
    for (const [file, credit] of expected) {
      expect(authorOf(file), file).toContain(credit);
    }
    expect(authorOf("Malachitfalter,_Bambuspage,_Siproeta_stelenes_3.JPG")).toMatch(
      /^Böhringer: Feel free to use my photos, but please mention me as the author/,
    );
  });

  it("balances topics that all have a Japanese label", () => {
    for (const topic of manifest.topics) {
      expect(commonsTopicLabel(topic)).not.toBe(topic);
      const count = manifest.items.filter((item) => item.topic === topic).length;
      expect(count).toBeGreaterThan(0);
      expect(count / manifest.items.length).toBeLessThan(0.15);
    }
  });

  it("knows where many of the photos were taken", () => {
    const located = manifest.items.flatMap((item) =>
      item.location ? [item.location] : [],
    );
    expect(located.length / manifest.items.length).toBeGreaterThan(0.6);
    const named = located.filter((place) => place.country !== null);
    expect(named.length / located.length).toBeGreaterThan(0.9);
    const regions = new Intl.DisplayNames(["en"], {
      type: "region",
      fallback: "none",
    });
    for (const place of located) {
      expect(Math.round(place.lat * 100) / 100).toBe(place.lat);
      expect(Math.round(place.lon * 100) / 100).toBe(place.lon);
      expect(place.lat === 0 && place.lon === 0).toBe(false);
      if (place.country !== null) {
        expect(regions.of(place.country)).toBeDefined();
      }
    }
  });

  it("only uses free licenses", () => {
    for (const license of manifest.licenses) {
      expect(license.name).toMatch(
        /^(CC0 1\.0|Public domain|CC BY(-SA)? \d\.\d( [a-z]{2,})?)$/,
      );
    }
  });
});
