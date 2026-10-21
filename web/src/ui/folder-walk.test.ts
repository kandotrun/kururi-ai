import { describe, expect, it } from "vitest";
import {
  type FolderAccess,
  type FolderEntry,
  inSystemFolder,
  isSystemFolder,
  walkFolder,
  withRelativePath,
} from "./folder-walk";

interface FakeEntry extends FolderEntry {
  readonly children: readonly FakeEntry[];
  readonly broken: boolean;
}

type Tree = { readonly [name: string]: Tree | string | null };

function build(name: string, parent: string, node: Tree | string | null): FakeEntry {
  const fullPath = `${parent}/${name}`;
  if (typeof node === "string" || node === null) {
    return {
      name,
      fullPath,
      isFile: true,
      isDirectory: false,
      children: [],
      broken: node === null,
    };
  }
  return {
    name,
    fullPath,
    isFile: false,
    isDirectory: true,
    children: Object.entries(node).map(([child, value]) => build(child, fullPath, value)),
    broken: false,
  };
}

interface FakeAccess extends FolderAccess<FakeEntry> {
  readonly reads: Map<string, number>;
  readonly peak: () => number;
}

function access(
  options: { batch?: number; brokenFolders?: readonly string[]; delayMs?: number } = {},
): FakeAccess {
  const batch = options.batch ?? 2;
  const reads = new Map<string, number>();
  let active = 0;
  let peak = 0;
  return {
    reads,
    peak: () => peak,
    reader(directory) {
      let offset = 0;
      return async () => {
        reads.set(directory.fullPath, (reads.get(directory.fullPath) ?? 0) + 1);
        if (options.brokenFolders?.includes(directory.fullPath)) {
          throw new Error("unreadable folder");
        }
        const slice = directory.children.slice(offset, offset + batch);
        offset += slice.length;
        return slice;
      };
    },
    async file(entry) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
      active -= 1;
      if (entry.broken) {
        throw new Error("unreadable file");
      }
      return new File([entry.name], entry.name, { type: "" });
    },
  };
}

function paths(files: readonly File[]): string[] {
  return files.map((file) => file.webkitRelativePath);
}

describe("walkFolder", () => {
  it("collects every file below the folder in path order with relative paths", async () => {
    const root = build("Photos", "", {
      "b.jpg": "b",
      trip: { "IMG_10.DNG": "x", "IMG_2.DNG": "y", inner: { "c.png": "c" } },
      "a.jpg": "a",
      "clip.mov": "v",
    });
    const result = await walkFolder(root, access());
    expect(paths(result.files)).toEqual([
      "Photos/a.jpg",
      "Photos/b.jpg",
      "Photos/clip.mov",
      "Photos/trip/IMG_2.DNG",
      "Photos/trip/IMG_10.DNG",
      "Photos/trip/inner/c.png",
    ]);
    expect(result.files.map((file) => file.name)).toContain("IMG_10.DNG");
    expect(result).toMatchObject({ failed: 0, truncated: false });
  });

  it("keeps reading a folder until the reader returns an empty batch", async () => {
    const root = build("Photos", "", {
      "1.jpg": "",
      "2.jpg": "",
      "3.jpg": "",
      "4.jpg": "",
      "5.jpg": "",
    });
    const fake = access({ batch: 2 });
    const result = await walkFolder(root, fake);
    expect(result.files).toHaveLength(5);
    expect(fake.reads.get("/Photos")).toBe(4);
  });

  it("skips hidden and NAS system folders but keeps every file for classification", async () => {
    const root = build("Photos", "", {
      ".DS_Store": "",
      ".thumbnails": { "t.jpg": "" },
      "@eaDir": { "SYNOPHOTO_THUMB_XL.jpg": "" },
      "#recycle": { "old.jpg": "" },
      "keep.jpg": "",
    });
    const result = await walkFolder(root, access());
    expect(paths(result.files)).toEqual(["Photos/.DS_Store", "Photos/keep.jpg"]);
  });

  it("reports each file as soon as it is read", async () => {
    const root = build("Photos", "", { "a.jpg": "", sub: { "b.jpg": "" } });
    const seen: string[] = [];
    await walkFolder(root, access(), { onFile: (file) => seen.push(file.name) });
    expect(seen.sort()).toEqual(["a.jpg", "b.jpg"]);
  });

  it("counts unreadable files and folders and carries on", async () => {
    const root = build("Photos", "", {
      "a.jpg": null,
      locked: { "x.jpg": "" },
      open: { "y.jpg": "" },
    });
    const result = await walkFolder(root, access({ brokenFolders: ["/Photos/locked"] }));
    expect(paths(result.files)).toEqual(["Photos/open/y.jpg"]);
    expect(result.failed).toBe(2);
  });

  it("stops at the file cap and says so", async () => {
    const root = build("Photos", "", {
      "1.jpg": "",
      "2.jpg": "",
      sub: { "3.jpg": "", "4.jpg": "" },
    });
    const result = await walkFolder(root, access(), { maxFiles: 3 });
    expect(paths(result.files)).toEqual(["Photos/1.jpg", "Photos/2.jpg", "Photos/sub/3.jpg"]);
    expect(result.truncated).toBe(true);
  });

  it("does not flag a folder that exactly fills the cap", async () => {
    const root = build("Photos", "", { "1.jpg": "", "2.jpg": "" });
    const result = await walkFolder(root, access(), { maxFiles: 2 });
    expect(result.truncated).toBe(false);
  });

  it("reads only a few files at a time", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 30; index += 1) {
      files[`${index}.jpg`] = "";
    }
    const fake = access({ batch: 100, delayMs: 2 });
    const result = await walkFolder(build("Photos", "", files), fake, { concurrency: 4 });
    expect(result.files).toHaveLength(30);
    expect(fake.peak()).toBeLessThanOrEqual(4);
    expect(fake.peak()).toBeGreaterThan(1);
  });

  it("does not descend deeper than the depth limit", async () => {
    const root = build("Photos", "", { a: { b: { c: { "deep.jpg": "" } }, "shallow.jpg": "" } });
    const result = await walkFolder(root, access(), { maxDepth: 2 });
    expect(paths(result.files)).toEqual(["Photos/a/shallow.jpg"]);
  });

  it("stops with an AbortError when the visitor cancels", async () => {
    const root = build("Photos", "", { "a.jpg": "", sub: { "b.jpg": "" } });
    const controller = new AbortController();
    const walk = walkFolder(root, access({ delayMs: 5 }), {
      signal: controller.signal,
      onFile: () => controller.abort(),
    });
    await expect(walk).rejects.toMatchObject({ name: "AbortError" });
  });

  it("accepts a single file as the root", async () => {
    const root = build("loose.jpg", "", "x");
    const result = await walkFolder(root, access());
    expect(paths(result.files)).toEqual(["loose.jpg"]);
  });

  it("survives a reader that never ends", async () => {
    const root = build("Photos", "", { "a.jpg": "" });
    const endless: FolderAccess<FakeEntry> = {
      reader: () => async () => root.children,
      file: async (entry) => new File([""], entry.name),
    };
    const result = await walkFolder(root, endless, { maxFiles: 5 });
    expect(result.files.length).toBeLessThanOrEqual(5);
    expect(result.truncated).toBe(true);
  });
});

describe("isSystemFolder", () => {
  it("recognises hidden, trash and NAS thumbnail folders", () => {
    for (const name of [".git", ".Trashes", "@eaDir", "#recycle", "#snapshot", "$RECYCLE.BIN", "System Volume Information"]) {
      expect(isSystemFolder(name)).toBe(true);
    }
  });

  it("keeps ordinary folders", () => {
    for (const name of ["2024", "旅行", "DCIM", "eaDir"]) {
      expect(isSystemFolder(name)).toBe(false);
    }
  });
});

describe("inSystemFolder", () => {
  it("spots files that a folder picker listed inside hidden or NAS folders", () => {
    expect(inSystemFolder("Photos/@eaDir/IMG_0001.JPG/SYNOPHOTO_THUMB_XL.jpg")).toBe(true);
    expect(inSystemFolder("Photos/.thumbnails/a.jpg")).toBe(true);
    expect(inSystemFolder("Photos/2024/#recycle/a.jpg")).toBe(true);
  });

  it("keeps hidden files themselves for classification", () => {
    expect(inSystemFolder("Photos/.DS_Store")).toBe(false);
    expect(inSystemFolder("Photos/2024/a.jpg")).toBe(false);
    expect(inSystemFolder("a.jpg")).toBe(false);
    expect(inSystemFolder("")).toBe(false);
  });
});

describe("withRelativePath", () => {
  it("adds the folder path that a dropped file is missing", () => {
    const file = withRelativePath(new File(["x"], "a.jpg"), "Photos/a.jpg");
    expect(file.webkitRelativePath).toBe("Photos/a.jpg");
    expect(file.name).toBe("a.jpg");
  });

  it("keeps the path a folder picker already set", () => {
    const original = withRelativePath(new File(["x"], "a.jpg"), "Picked/a.jpg");
    expect(withRelativePath(original, "Other/a.jpg").webkitRelativePath).toBe("Picked/a.jpg");
  });
});
