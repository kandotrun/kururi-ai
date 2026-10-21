import { describe, expect, it } from "vitest";
import { quadGeometry, ribbonGeometry } from "./stage-util";

function signedAreas(
  index: ArrayLike<number>,
  point: (vertex: number) => [number, number],
): number[] {
  const areas: number[] = [];
  for (let offset = 0; offset < index.length; offset += 3) {
    const [ax, ay] = point(index[offset]!);
    const [bx, by] = point(index[offset + 1]!);
    const [cx, cy] = point(index[offset + 2]!);
    areas.push((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  }
  return areas;
}

describe("ribbonGeometry", () => {
  it("winds every triangle counter-clockwise when extruded to the left of its travel", () => {
    const geometry = ribbonGeometry(12);
    const along = geometry.getAttribute("aS").array;
    const side = geometry.getAttribute("aSide").array;
    const index = geometry.getIndex()!.array;
    const areas = signedAreas(index, (vertex) => [along[vertex]!, side[vertex]!]);
    expect(areas).toHaveLength(24);
    for (const area of areas) {
      expect(area).toBeGreaterThan(0);
    }
  });

  it("covers the whole length from start to end", () => {
    const geometry = ribbonGeometry(8);
    const along = Array.from(geometry.getAttribute("aS").array);
    expect(Math.min(...along)).toBe(0);
    expect(Math.max(...along)).toBe(1);
  });
});

describe("quadGeometry", () => {
  it("winds both triangles counter-clockwise", () => {
    const geometry = quadGeometry();
    const corner = geometry.getAttribute("aCorner").array;
    const index = geometry.getIndex()!.array;
    const areas = signedAreas(index, (vertex) => [
      corner[vertex * 2]!,
      corner[vertex * 2 + 1]!,
    ]);
    for (const area of areas) {
      expect(area).toBeGreaterThan(0);
    }
  });
});
