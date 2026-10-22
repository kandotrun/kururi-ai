import { describe, expect, it } from "vitest";
import { createFolderImport, type FolderImportOptions } from "./folder-import";
import {
  type FolderAccess,
  type FolderEntry,
  withRelativePath as withPath,
} from "./folder-walk";

interface FakeEntry extends FolderEntry {
  readonly children: readonly FakeEntry[];
}

type Tree = { readonly [name: string]: Tree | string };

function build(name: string, parent: string, node: Tree | string): FakeEntry {
  const fullPath = `${parent}/${name}`;
  if (typeof node === "string") {
    return { name, fullPath, isFile: true, isDirectory: false, children: [] };
  }
  return {
    name,
    fullPath,
    isFile: false,
    isDirectory: true,
    children: Object.entries(node).map(([child, value]) => build(child, fullPath, value)),
  };
}

function fakeAccess(gate: Promise<void> = Promise.resolve()): FolderAccess<FakeEntry> {
  return {
    reader(directory) {
      let done = false;
      return async () => {
        await gate;
        if (done) {
          return [];
        }
        done = true;
        return directory.children;
      };
    },
    async file(entry) {
      return new File(["x"], entry.name);
    },
  };
}

interface Recorder {
  batches: string[][];
  scans: Array<number | null>;
  notices: string[];
  kinds: string[];
}

function setup(
  overrides: Partial<FolderImportOptions<FakeEntry>> = {},
): { recorder: Recorder; folders: ReturnType<typeof createFolderImport<FakeEntry>> } {
  const recorder: Recorder = { batches: [], scans: [], notices: [], kinds: [] };
  const folders = createFolderImport<FakeEntry>({
    access: fakeAccess(),
    countsAsPhoto: (file) => /\.(jpe?g|png|dng)$/i.test(file.name),
    mayBePhoto: (file) => /\.(jpe?g|png|dng|heic)$/i.test(file.name),
    onFiles: (files) =>
      recorder.batches.push(files.map((file) => file.webkitRelativePath || file.name)),
    onScan: (photos) => recorder.scans.push(photos),
    onNotice: (message, kind) => {
      recorder.notices.push(message);
      recorder.kinds.push(kind);
    },
    throttleMs: 0,
    ...overrides,
  });
  return { recorder, folders };
}

describe("createFolderImport", () => {
  it("hands every file of each folder over once per folder", async () => {
    const { recorder, folders } = setup();
    await folders.importFolders([
      build("Trip", "", { "a.jpg": "", "clip.mov": "", inner: { "b.dng": "" } }),
      build("Home", "", { "c.png": "" }),
    ]);
    expect(recorder.batches).toEqual([
      ["Trip/a.jpg", "Trip/clip.mov", "Trip/inner/b.dng"],
      ["Home/c.png"],
    ]);
    expect(recorder.notices).toEqual([]);
  });

  it("counts the photos found while it reads and clears the count at the end", async () => {
    const { recorder, folders } = setup();
    await folders.importFolders([
      build("Trip", "", { "a.jpg": "", "clip.mov": "", inner: { "b.dng": "" } }),
    ]);
    const counts = recorder.scans.filter((value): value is number => value !== null);
    expect(counts[0]).toBe(0);
    expect(Math.max(...counts)).toBe(2);
    expect(counts).toEqual([...counts].sort((left, right) => left - right));
    expect(recorder.scans.at(-1)).toBeNull();
  });

  it("keeps counting across several folders dropped together", async () => {
    const { recorder, folders } = setup();
    await folders.importFolders([
      build("One", "", { "a.jpg": "" }),
      build("Two", "", { "b.jpg": "", "c.jpg": "" }),
    ]);
    const counts = recorder.scans.filter((value): value is number => value !== null);
    expect(Math.max(...counts)).toBe(3);
  });

  it("explains a folder without photos instead of handing it over", async () => {
    const { recorder, folders } = setup();
    await folders.importFolders([build("Clips", "", { "a.mov": "", "b.mp4": "" })]);
    expect(recorder.batches).toEqual([]);
    expect(recorder.notices).toEqual([
      "並べられる写真がありませんでした（動画など 2件は対象外）",
    ]);
    expect(recorder.kinds).toEqual(["empty"]);
  });

  it("says when a folder is empty", async () => {
    const { recorder, folders } = setup();
    await folders.importFolders([build("Empty", "", {})]);
    expect(recorder.notices).toEqual(["写真が見つかりませんでした"]);
  });

  it("mentions the cap when a folder is too large", async () => {
    const { recorder, folders } = setup({ maxFiles: 2 });
    await folders.importFolders([build("Big", "", { "a.jpg": "", "b.jpg": "", "c.jpg": "" })]);
    expect(recorder.batches).toEqual([["Big/a.jpg", "Big/b.jpg"]]);
    expect(recorder.notices).toEqual([
      "フォルダの中のファイルが多いため、最初の 2件だけ読み込みました。",
    ]);
    expect(recorder.kinds).toEqual(["warning"]);
  });

  it("drops a folder the visitor cancelled", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { recorder, folders } = setup({ access: fakeAccess(gate) });
    const running = folders.importFolders([build("Trip", "", { "a.jpg": "" })]);
    expect(folders.busy).toBe(true);
    folders.cancel();
    open();
    await running;
    expect(recorder.batches).toEqual([]);
    expect(recorder.scans.at(-1)).toBeNull();
    expect(folders.busy).toBe(false);
  });

  it("queues a second drop behind the first", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { recorder, folders } = setup({ access: fakeAccess(gate) });
    const first = folders.importFolders([build("One", "", { "a.jpg": "" })]);
    const second = folders.importFolders([build("Two", "", { "b.jpg": "" })]);
    open();
    await Promise.all([first, second]);
    expect(recorder.batches).toEqual([["One/a.jpg"], ["Two/b.jpg"]]);
    expect(folders.busy).toBe(false);
  });
});

describe("addFiles", () => {
  it("hands loose files over when at least one is a photo", () => {
    const { recorder, folders } = setup();
    folders.addFiles([new File(["x"], "a.jpg"), new File(["x"], "notes.txt")], "files");
    expect(recorder.batches).toEqual([["a.jpg", "notes.txt"]]);
  });

  it("leaves formats it cannot count to the classifier downstream", () => {
    const { recorder, folders } = setup();
    folders.addFiles([new File(["x"], "IMG_0001.HEIC")], "files");
    expect(recorder.batches).toEqual([["IMG_0001.HEIC"]]);
  });

  it("asks for photos when none of the loose files is one", () => {
    const { recorder, folders } = setup();
    folders.addFiles([new File(["x"], "notes.txt")], "files");
    expect(recorder.batches).toEqual([]);
    expect(recorder.notices).toEqual([
      "写真が見つかりませんでした。JPEG、PNG、WebP、DNG などの写真を選んでください。",
    ]);
  });

  it("uses the folder wording for a picked folder without photos", () => {
    const { recorder, folders } = setup();
    folders.addFiles([new File(["x"], "clip.mov")], "folder");
    expect(recorder.notices).toEqual([
      "並べられる写真がありませんでした（動画など 1件は対象外）",
    ]);
  });

  it("leaves out files inside hidden or NAS system folders of a picked folder", () => {
    const { recorder, folders } = setup();
    const picked = [
      withPath(new File(["x"], "a.jpg"), "Trip/a.jpg"),
      withPath(new File(["x"], "t.jpg"), "Trip/@eaDir/t.jpg"),
      withPath(new File(["x"], "x.jpg"), "Trip/.hidden/x.jpg"),
    ];
    folders.addFiles(picked, "folder");
    expect(recorder.batches).toEqual([["Trip/a.jpg"]]);
  });

  it("says so when a picked folder has no files at all", () => {
    const { recorder, folders } = setup();
    folders.addFiles([], "folder");
    expect(recorder.notices).toEqual(["写真が見つかりませんでした"]);
  });

  it("ignores an empty selection", () => {
    const { recorder, folders } = setup();
    folders.addFiles([], "files");
    expect(recorder.batches).toEqual([]);
    expect(recorder.notices).toEqual([]);
  });
});
