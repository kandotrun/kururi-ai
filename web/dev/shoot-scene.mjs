import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.SCENE_URL ?? "http://127.0.0.1:5173/dev/scene.html";
const extra = process.env.SCENE_EXTRA ?? "";
const outDir = process.argv[2];
const only = new Set(process.argv.slice(3));

if (!outDir) {
  throw new Error("usage: node dev/shoot-scene.mjs <out-dir> [scenario...]");
}
mkdirSync(outDir, { recursive: true });

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

async function waitFor(page, predicate, arg, timeout = 240_000) {
  await page.waitForFunction(predicate, arg, { timeout, polling: 250 });
}

async function pause(page, ms) {
  await page.waitForTimeout(ms);
}

const scenarios = {
  async arrival(page, shot) {
    await page.goto(`${base}?${extra}n=120&seed=3`);
    await waitFor(page, () => window.__harness?.ready === true);
    await pause(page, 300);
    await shot("arrival");
  },
  async opening(page, shot) {
    await page.goto(
      `${base}?${extra}n=260&rate=12&seed=3&opening=36&hold=2000`,
    );
    await waitFor(page, () => window.__harness?.opening === "holding");
    await pause(page, 1300);
    await shot("opening-crooked");
    console.log(
      "opening report",
      JSON.stringify(
        await page.evaluate(() => window.__harness.openingReport()),
      ),
    );
    await waitFor(page, () => window.__harness?.opening === "released");
    await pause(page, 650);
    await shot("opening-wave");
    await waitFor(page, () => window.__harness?.placed >= 90);
    await pause(page, 150);
    await shot("stream-front");
  },
  async mid(page, shot) {
    await page.goto(`${base}?${extra}n=420&rate=14&seed=5`);
    await waitFor(page, () => window.__harness?.placed >= 150);
    await pause(page, 300);
    await shot("mid-follow");
    const id = await page.evaluate(() => {
      const ids = window.__harness.ids;
      return ids[Math.max(0, window.__harness.placed - 12)] ?? null;
    });
    if (id) {
      await page.evaluate((target) => window.__harness.focus(target), id);
      await pause(page, 3200);
      await shot("mid-closeup");
      await page.evaluate(() => window.__harness.focus(null));
    }
    await pause(page, 1500);
    const target = await page.evaluate(() => {
      const ids = window.__harness.ids.slice(
        0,
        Math.max(0, window.__harness.placed - 20),
      );
      let best = null;
      let bestDistance = Infinity;
      for (const id of ids) {
        const point = window.__harness.screenPosition(id);
        if (!point) {
          continue;
        }
        const distance = Math.hypot(
          point.x - innerWidth * 0.55,
          point.y - innerHeight * 0.5,
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = point;
        }
      }
      return best;
    });
    console.log("hover target", JSON.stringify(target));
    if (target) {
      await page.mouse.move(target.x, target.y, { steps: 4 });
      await pause(page, 900);
      await shot("hover");
    }
  },
  async reveal(page, shot) {
    await page.goto(
      `${base}?${extra}n=1400&rate=70&pile=48&loading=24&workers=24&infer=120&seed=7`,
    );
    await waitFor(
      page,
      () => window.__harness?.finished === true,
      undefined,
      420_000,
    );
    await pause(page, 13000);
    await shot("reveal-wide");
    page.evaluate(() => window.__harness.scatter());
    await pause(page, 1150);
    await shot("scatter-out");
    await pause(page, 850);
    await shot("scatter-wave");
    await waitFor(
      page,
      () => window.__harness?.scatters >= 1,
      undefined,
      120_000,
    );
    await pause(page, 800);
    await shot("scatter-done");
  },
  async reduced(page, shot) {
    await page.goto(`${base}?${extra}n=220&rate=14&reduced=1&seed=9`);
    await waitFor(page, () => window.__harness?.opening === "holding");
    await pause(page, 600);
    await shot("reduced-opening");
    await waitFor(page, () => window.__harness?.placed >= 110);
    await pause(page, 400);
    await shot("reduced");
  },
};

const launchArgs =
  process.env.SCENE_GPU === "1"
    ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
    : ["--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ args: launchArgs });
try {
  for (const [viewportName, viewport] of Object.entries(viewports)) {
    if (only.has("desktop-only") && viewportName !== "desktop") {
      continue;
    }
    if (only.has("mobile-only") && viewportName !== "mobile") {
      continue;
    }
    for (const [name, scenario] of Object.entries(scenarios)) {
      if (only.size > 0 && ![...only].some((entry) => entry === name)) {
        continue;
      }
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
          errors.push(`${message.type()}: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) =>
        errors.push(`pageerror: ${error.message}`),
      );
      const shot = async (label) => {
        const file = join(outDir, `${viewportName}-${label}.png`);
        await page.screenshot({ path: file });
        const state = await page.evaluate(() => ({
          opening: window.__harness?.opening,
          placed: window.__harness?.placed,
          landed: window.__harness?.landed,
          commons: window.__harness?.commonsLoaded,
          commonsFailed: window.__harness?.commonsFailed,
          error: window.__harness?.error,
          stats: window.__harness?.stats(),
        }));
        console.log(file, JSON.stringify(state));
      };
      try {
        await scenario(page, shot);
      } catch (error) {
        console.log(`scenario ${name} failed: ${error.message}`);
      }
      if (errors.length > 0) {
        console.log(
          `${viewportName}/${name} console:\n  ${errors.slice(0, 12).join("\n  ")}`,
        );
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
