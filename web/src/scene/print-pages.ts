import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  type Scene,
  type ShaderMaterial,
  StaticDrawUsage,
} from "three";
import type { DeskPose } from "../contracts";
import type { AtlasRect, PrintAtlas } from "./atlas";
import { cellsPerPage } from "./atlas";
import {
  createPrintMaterial,
  createShadowMaterial,
  type PrintUniforms,
} from "./print-material";

const ATTRIBUTE_NAMES = [
  "aPose",
  "aMotion",
  "aShape",
  "aAtlas",
  "aMark",
  "aTimes",
  "aFlags",
] as const;

type AttributeName = (typeof ATTRIBUTE_NAMES)[number];

const DYNAMIC: ReadonlySet<AttributeName> = new Set(["aPose", "aMotion"]);

class TrackedAttribute {
  readonly attribute: InstancedBufferAttribute;
  readonly array: Float32Array;
  private low = Number.POSITIVE_INFINITY;
  private high = -1;
  private readonly range = { start: 0, count: 0 };

  constructor(capacity: number, dynamic: boolean) {
    this.array = new Float32Array(capacity * 4);
    this.attribute = new InstancedBufferAttribute(this.array, 4);
    this.attribute.setUsage(dynamic ? DynamicDrawUsage : StaticDrawUsage);
  }

  set(cell: number, x: number, y: number, z: number, w: number): void {
    const offset = cell * 4;
    this.array[offset] = x;
    this.array[offset + 1] = y;
    this.array[offset + 2] = z;
    this.array[offset + 3] = w;
    if (cell < this.low) {
      this.low = cell;
    }
    if (cell > this.high) {
      this.high = cell;
    }
  }

  flush(): void {
    if (this.high < 0) {
      return;
    }
    this.range.start = this.low * 4;
    this.range.count = (this.high - this.low + 1) * 4;
    this.attribute.updateRanges.length = 0;
    this.attribute.updateRanges.push(this.range);
    this.attribute.needsUpdate = true;
    this.low = Number.POSITIVE_INFINITY;
    this.high = -1;
  }
}

interface PrintPage {
  readonly geometry: InstancedBufferGeometry;
  readonly shadowGeometry: InstancedBufferGeometry;
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly shadowMesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly material: ShaderMaterial;
  readonly shadowMaterial: ShaderMaterial;
  readonly attributes: Record<AttributeName, TrackedAttribute>;
  used: number;
}

export interface PrintPagesOptions {
  scene: Scene;
  atlas: PrintAtlas;
  printUniforms: PrintUniforms;
  segments: number;
}

export class PrintPages {
  private readonly options: PrintPagesOptions;
  private readonly perPage: number;
  private readonly pages: PrintPage[] = [];
  private readonly printBase: PlaneGeometry;
  private readonly shadowBase: PlaneGeometry;

  constructor(options: PrintPagesOptions) {
    this.options = options;
    this.perPage = cellsPerPage(options.atlas.spec);
    this.printBase = new PlaneGeometry(
      1,
      1,
      options.segments,
      Math.max(2, Math.round(options.segments * 0.75)),
    );
    this.printBase.rotateX(-Math.PI / 2);
    this.printBase.deleteAttribute("uv");
    this.printBase.deleteAttribute("normal");
    this.shadowBase = new PlaneGeometry(1, 1, 1, 1);
    this.shadowBase.rotateX(-Math.PI / 2);
    this.shadowBase.deleteAttribute("uv");
    this.shadowBase.deleteAttribute("normal");
  }

  ensure(index: number): void {
    const page = this.pageFor(index);
    const cell = index % this.perPage;
    if (cell + 1 > page.used) {
      page.used = cell + 1;
      page.geometry.instanceCount = page.used;
      page.shadowGeometry.instanceCount = page.used;
    }
  }

  writePose(index: number, pose: DeskPose, shadowY: number): void {
    const page = this.pageFor(index);
    const cell = index % this.perPage;
    page.attributes.aPose.set(cell, pose.x, pose.y, pose.z, pose.yaw);
    page.attributes.aMotion.set(
      cell,
      pose.tiltX,
      pose.tiltZ,
      pose.scale,
      shadowY,
    );
  }

  hide(index: number): void {
    const page = this.pageFor(index);
    const cell = index % this.perPage;
    page.attributes.aMotion.set(cell, 0, 0, 0, 0);
  }

  writeShape(
    index: number,
    width: number,
    depth: number,
    curl: number,
    seed: number,
  ): void {
    this.attr(index, "aShape", width, depth, curl, seed);
  }

  writeAtlas(
    index: number,
    rect: AtlasRect,
    readyTime: number,
    emphasis: boolean,
  ): void {
    this.attr(index, "aAtlas", rect.u0, rect.v0, rect.u1, rect.v1);
    this.attr(
      index,
      "aFlags",
      rect.rotated ? 1 : 0,
      readyTime,
      rect.aspect,
      emphasis ? 1 : 0,
    );
  }

  writeMark(
    index: number,
    side: number,
    start: number,
    tilt: number,
    offset: number,
  ): void {
    this.attr(index, "aMark", side, start, tilt, offset);
  }

  writeTimes(
    index: number,
    scanStart: number,
    scanEnd: number,
    fadeStart: number,
    fadeDuration: number,
  ): void {
    this.attr(index, "aTimes", scanStart, scanEnd, fadeStart, fadeDuration);
  }

  flush(): void {
    for (const page of this.pages) {
      for (const name of ATTRIBUTE_NAMES) {
        page.attributes[name].flush();
      }
    }
  }

  drawCalls(): number {
    return this.pages.length * 2;
  }

  dispose(): void {
    for (const page of this.pages) {
      this.options.scene.remove(page.mesh);
      this.options.scene.remove(page.shadowMesh);
      page.geometry.dispose();
      page.shadowGeometry.dispose();
      page.material.dispose();
      page.shadowMaterial.dispose();
    }
    this.pages.length = 0;
    this.printBase.dispose();
    this.shadowBase.dispose();
  }

  private attr(
    index: number,
    name: AttributeName,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    const page = this.pageFor(index);
    page.attributes[name].set(index % this.perPage, x, y, z, w);
  }

  private pageFor(index: number): PrintPage {
    const pageIndex = Math.floor(index / this.perPage);
    for (let next = this.pages.length; next <= pageIndex; next += 1) {
      this.pages.push(this.createPage(next));
    }
    const page = this.pages[pageIndex];
    if (!page) {
      throw new Error("print page is unavailable");
    }
    return page;
  }

  private createPage(pageIndex: number): PrintPage {
    const { atlas, printUniforms, scene } = this.options;
    const attributes = {} as Record<AttributeName, TrackedAttribute>;
    for (const name of ATTRIBUTE_NAMES) {
      attributes[name] = new TrackedAttribute(this.perPage, DYNAMIC.has(name));
    }
    const geometry = new InstancedBufferGeometry();
    geometry.index = this.printBase.index;
    geometry.setAttribute("position", this.printBase.getAttribute("position"));
    const shadowGeometry = new InstancedBufferGeometry();
    shadowGeometry.index = this.shadowBase.index;
    shadowGeometry.setAttribute(
      "position",
      this.shadowBase.getAttribute("position"),
    );
    for (const name of ATTRIBUTE_NAMES) {
      geometry.setAttribute(name, attributes[name].attribute);
      shadowGeometry.setAttribute(name, attributes[name].attribute);
    }
    geometry.instanceCount = 0;
    shadowGeometry.instanceCount = 0;
    const material = createPrintMaterial(
      printUniforms,
      atlas.page(pageIndex),
      pageIndex * this.perPage,
    );
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    const shadowMaterial = createShadowMaterial(
      printUniforms,
      pageIndex * this.perPage,
    );
    const shadowMesh = new Mesh(shadowGeometry, shadowMaterial);
    shadowMesh.frustumCulled = false;
    shadowMesh.renderOrder = 3;
    scene.add(mesh);
    scene.add(shadowMesh);
    return {
      geometry,
      shadowGeometry,
      mesh,
      shadowMesh,
      material,
      shadowMaterial,
      attributes,
      used: 0,
    };
  }
}
