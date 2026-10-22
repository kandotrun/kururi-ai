import { describe, expect, it } from "vitest";
import { carriesFiles } from "./files";

describe("carriesFiles", () => {
  it("detects file drags", () => {
    expect(carriesFiles(["Files"])).toBe(true);
    expect(carriesFiles(["text/plain", "Files"])).toBe(true);
  });

  it("ignores text and link drags", () => {
    expect(carriesFiles(["text/plain", "text/uri-list"])).toBe(false);
    expect(carriesFiles([])).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});
