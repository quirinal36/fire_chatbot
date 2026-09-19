/** 그림 일부를 확대해 저장한다: tsx crop.ts in.png x0 y0 x1 y1 out.png [배율] */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
const [, , inp, x0s, y0s, x1s, y1s, out, ks] = process.argv;
if (!inp || !out) throw new Error('usage');
const buf = readFileSync(inp);
const src = inp.toLowerCase().endsWith('.png') ? PNG.sync.read(buf) : (() => { const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true }); return { width: j.width, height: j.height, data: j.data }; })();
const x0 = Number(x0s), y0 = Number(y0s), x1 = Number(x1s), y1 = Number(y1s), k = Number(ks ?? 2);
const W = (x1 - x0) * k, H = (y1 - y0) * k;
const png = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const sx = x0 + Math.floor(x / k), sy = y0 + Math.floor(y / k);
  const p = (sy * src.width + sx) * 4, q = (y * W + x) * 4;
  png.data[q] = src.data[p] ?? 255; png.data[q + 1] = src.data[p + 1] ?? 255; png.data[q + 2] = src.data[p + 2] ?? 255; png.data[q + 3] = 255;
}
writeFileSync(out, PNG.sync.write(png));
