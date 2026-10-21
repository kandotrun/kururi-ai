import { chromium } from "@playwright/test";

const out = process.argv[2];
const time = Number(process.argv[3] ?? 3000);
const only = (process.argv[4] ?? "6").split(",").map(Number);
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=metal", "--enable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") {
    console.log("console", m.type(), m.text());
  }
});
await page.goto(`http://127.0.0.1:5173/dev/intro.html?t=0&${process.env.EXTRA ?? ""}`);
await page.waitForFunction(() => window.__intro !== undefined);
await page.evaluate(() => window.__intro.ready);
const info = await page.evaluate(
  ({ time, only }) => {
    const c = window.__intro.controller;
    c.seek(time);
    const globe = c.globe;
    const children = globe.scene.children;
    const keep = children.map((child) => child.visible);
    children.forEach((child, index) => {
      child.visible = only.includes(index) && keep[index];
    });
    const renderer = c.renderer;
    if (window.location.hash !== "x") {
      globe.arcMesh.material.depthTest = false;
      globe.arcMesh.material.uniforms.uGain.value = 20;
      globe.arcMesh.material.uniforms.uWidth.value = 3;
      if (window.location.search.includes("flat")) {
        globe.arcMesh.material.fragmentShader = globe.arcMesh.material.fragmentShader.replace(
          "gl_FragColor = vec4(color * uGain * uFade, 1.0);",
          "gl_FragColor = vec4(vec3(0.05, 0.02 + 0.2 * clamp(vK, 0.0, 1.0), 0.0) * uGain, 1.0);",
        );
        globe.arcMesh.material.needsUpdate = true;
      }
      if (window.location.search.includes("full")) {
        globe.arcMesh.material.vertexShader = globe.arcMesh.material.vertexShader
          .replace("float visible = step(0.0, progress) * step(from + 1e-4, to);", "float visible = 1.0;")
          .replace("float s = mix(from, to, aS);", "float s = aS;")
          .replace("vK = clamp((s - (head - uTail)) / uTail, 0.0, 1.0);", "vK = aS;")
          .replace("return dir * (1.0008 + lift * rise);", window.location.search.includes("chord") ? "return mix(a, b, s) * 1.2;" : "return dir * (1.0008 + lift * rise);");
        globe.arcMesh.material.needsUpdate = true;
      }
    }
    renderer.setRenderTarget(c.post.targetA);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(globe.scene, globe.camera);
    c.params.weightB = 0;
    c.post.render(c.params);
    const geometry = globe.arcMesh.geometry;
    return {
      instanceCount: geometry.instanceCount,
      attributes: Object.keys(geometry.attributes),
      aS: Array.from(geometry.attributes.aS.array.slice(0, 12)),
      aSide: Array.from(geometry.attributes.aSide.array.slice(0, 6)),
      index: Array.from(geometry.index.array.slice(0, 12)),
      indexCount: geometry.index.count,
      drawRange: geometry.drawRange,
      uniforms: Object.fromEntries(Object.entries(globe.arcMesh.material.uniforms).map(([k, v]) => [k, v.value && v.value.toArray ? v.value.toArray() : v.value])),
      visible: keep,
    };
  },
  { time, only },
);
console.log(JSON.stringify(info));
await page.screenshot({ path: out });
await browser.close();
