import { describe, expect, it } from "vitest";
import { fullModelDocs } from "./links";

describe("fullModelDocs", () => {
  it("serves the license files next to the full model", () => {
    expect(
      fullModelDocs("/models/v2.0.0/", "https://kururi-ai.2-38.com/"),
    ).toEqual({
      license: "https://kururi-ai.2-38.com/models/v2.0.0/LICENSE",
      notices: "https://kururi-ai.2-38.com/models/v2.0.0/THIRD_PARTY_NOTICES.md",
      card: "https://kururi-ai.2-38.com/models/v2.0.0/MODEL_CARD.md",
    });
  });

  it("resolves a relative base against the app and adds the missing slash", () => {
    expect(fullModelDocs("models/v2.0.0", "https://example.test/demo/")?.license).toBe(
      "https://example.test/demo/models/v2.0.0/LICENSE",
    );
  });

  it("offers nothing when the full model is not served", () => {
    expect(fullModelDocs(undefined, "https://example.test/")).toBeNull();
    expect(fullModelDocs("", "https://example.test/")).toBeNull();
    expect(fullModelDocs("   ", "https://example.test/")).toBeNull();
  });
});
