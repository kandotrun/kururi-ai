import { chromium } from "@playwright/test";

const variants = [
  ["--enable-unsafe-swiftshader", "--use-angle=metal", "--enable-gpu"],
  ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  ["--enable-unsafe-swiftshader"],
];
for (const args of variants) {
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage();
  await page.setContent("<canvas id=c></canvas>");
  const info = await page.evaluate(() => {
    const gl = document.getElementById("c").getContext("webgl2");
    if (!gl) {
      return "no webgl2";
    }
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const half = gl.getExtension("EXT_color_buffer_float") ? "cbf" : "nocbf";
    return `${ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "webgl2"} ${half} samples=${gl.getParameter(gl.MAX_SAMPLES)}`;
  });
  console.log(args.join(" "), "=>", info);
  await browser.close();
}
