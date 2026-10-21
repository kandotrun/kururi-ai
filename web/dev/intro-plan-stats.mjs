import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=metal", "--enable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5173/dev/intro.html?t=0");
await page.waitForFunction(() => window.__intro !== undefined);
await page.evaluate(() => window.__intro.ready);
const stats = await page.evaluate(() => {
  const c = window.__intro.controller;
  c.seek(2400);
  const globe = c.globe;
  const plan = globe.plan;
  const camera = globe.camera;
  const target = globe.arcs.uniforms.uTarget.value;
  const out = [];
  const V = target.constructor;
  for (let i = 0; i < plan.count && out.length < 6; i++) {
    const d = plan.data;
    const a = new V(d[i * 8], d[i * 8 + 1], d[i * 8 + 2]);
    const launch = d[i * 8 + 4];
    const travel = d[i * 8 + 5];
    const lift = d[i * 8 + 6];
    const progress = (2.4 - launch) / travel;
    if (progress <= 0 || progress >= 1) continue;
    const p = Math.min(1, Math.max(0, progress));
    const eased = p * p * (3 - 2 * p);
    const head = eased * 1.42;
    const from = Math.min(1, Math.max(0, head - 0.42));
    const to = Math.min(1, head);
    const angle = Math.acos(Math.min(1, Math.max(-1, a.dot(target))));
    const pts = [];
    for (const s of [from, (from + to) / 2, to]) {
      const dir = a.clone().multiplyScalar(Math.sin((1 - s) * angle)).add(target.clone().multiplyScalar(Math.sin(s * angle))).divideScalar(Math.sin(angle));
      const pos = dir.multiplyScalar(1.0008 + lift * Math.sin(Math.PI * s));
      const ndc = pos.clone().project(camera);
      pts.push([Math.round((ndc.x * 0.5 + 0.5) * 1440), Math.round((0.5 - ndc.y * 0.5) * 900), +ndc.z.toFixed(3)]);
    }
    out.push({ i, from: +from.toFixed(3), to: +to.toFixed(3), angle: +angle.toFixed(3), pts });
  }
  return { cam: camera.position.toArray(), near: camera.near, far: camera.far, out };
});
console.log(JSON.stringify(stats, null, 1));
await browser.close();
