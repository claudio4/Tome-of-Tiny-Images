// Summarizes .cache/tune/results/*.json (from sweep.ts) per image category.
//
//   node scripts/tune/report.ts > .cache/tune/report.md
//
// SSIMULACRA2 rough scale: 90 ≈ visually lossless at 1:1, 80 ≈ very high
// quality, 70 ≈ high quality, 50 ≈ medium.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ImageResult, Measurement } from './sweep.ts';

const DIR = join(resolve(import.meta.dirname, '../..'), '.cache/tune/results');
const TARGETS = [90, 85, 80, 75];

const images: ImageResult[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const min = (xs: number[]) => Math.min(...xs);
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');
const pct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : '–');
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Main quality sweeps: JXL distance at effort 7, AVIF quality at speed 6, 4:2:0. */
const sweep = (img: ImageResult, codec: 'jxl' | 'avif') =>
  img.results
    .filter((r) => r.codec === codec && r.speed === (codec === 'jxl' ? 7 : 6) && !r.chroma444)
    .filter((r) => typeof r.param === 'number' && (codec === 'jxl' ? r.param > 0 : r.param < 100))
    .sort((a, b) => b.score - a.score);

/**
 * Interpolates (in log-size) the setting and size at which the image reaches
 * `target`. Returns undefined when the sweep doesn't bracket the target.
 */
function atTarget(rs: Measurement[], target: number) {
  for (let i = 0; i + 1 < rs.length; i++) {
    const [hi, lo] = [rs[i], rs[i + 1]];
    if (hi.score >= target && lo.score <= target) {
      const t = hi.score === lo.score ? 0 : (hi.score - target) / (hi.score - lo.score);
      const param = (hi.param as number) + t * ((lo.param as number) - (hi.param as number));
      const bytes = Math.exp(Math.log(hi.bytes) + t * (Math.log(lo.bytes) - Math.log(hi.bytes)));
      return { param, bytes };
    }
  }
  return undefined;
}

const find = (img: ImageResult, pred: (r: Measurement) => boolean) => img.results.find(pred);

const out: string[] = [];
const p = (s = '') => out.push(s);

const categories = [...new Set(images.map((i) => i.category))].sort();
p(`# Tuning report`);
p();
p(`${images.length} images. Scores are SSIMULACRA2; sizes relative to the original file.`);

for (const cat of categories) {
  const imgs = images.filter((i) => i.category === cat);
  const orig = imgs.reduce((s, i) => s + i.originalBytes, 0);
  const fmts = Object.entries(
    imgs.reduce<Record<string, number>>((acc, i) => ((acc[i.format] = (acc[i.format] ?? 0) + 1), acc), {}),
  )
    .map(([f, n]) => `${n} ${f}`)
    .join(', ');
  const mp = median(imgs.map((i) => (i.width * i.height) / 1e6));
  p();
  p(`## ${cat}`);
  p();
  p(`${imgs.length} images (${fmts}), ${mb(orig)} total, median ${fmt(mp)} MP, ${imgs.filter((i) => i.hasAlpha).length} with alpha.`);

  const jpegs = imgs.filter((i) => i.format === 'jpeg');
  if (jpegs.length) {
    const t = jpegs.map((i) => find(i, (r) => r.param === 'transcode')!.bytes / i.originalBytes);
    p();
    p(`**Lossless JPEG transcode** (${jpegs.length} JPEGs): median size ${pct(median(t))} of original (range ${pct(min(t))}–${pct(Math.max(...t))}).`);
  }
  const pngs = imgs.filter((i) => i.format !== 'jpeg');
  if (pngs.length) {
    const l = pngs.map((i) => find(i, (r) => r.codec === 'jxl' && r.param === 0)!.bytes / i.originalBytes);
    p();
    p(`**JXL lossless** (${pngs.length} non-JPEG): median size ${pct(median(l))} of original.`);
  }

  p();
  p(`### Setting needed to reach a target score (median across images)`);
  p();
  p(`| target | JXL distance | JXL size | AVIF quality | AVIF size | images bracketed (jxl/avif) |`);
  p(`|---|---|---|---|---|---|`);
  for (const target of TARGETS) {
    const j = imgs.map((i) => ({ i, r: atTarget(sweep(i, 'jxl'), target) })).filter((x) => x.r);
    const a = imgs.map((i) => ({ i, r: atTarget(sweep(i, 'avif'), target) })).filter((x) => x.r);
    p(
      `| ${target} | ${fmt(median(j.map((x) => x.r!.param)), 2)} | ${pct(median(j.map((x) => x.r!.bytes / x.i.originalBytes)))} | ` +
        `${fmt(median(a.map((x) => x.r!.param)), 0)} | ${pct(median(a.map((x) => x.r!.bytes / x.i.originalBytes)))} | ${j.length}/${a.length} of ${imgs.length} |`,
    );
  }

  p();
  p(`### Sweeps (median score / worst score / median size)`);
  p();
  p(`| JXL d (e7) | score | worst | size || AVIF q (s6) | score | worst | size |`);
  p(`|---|---|---|---||---|---|---|---|`);
  const ds = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4];
  const qs = [88, 82, 76, 70, 64, 58, 50, 40];
  for (let k = 0; k < ds.length; k++) {
    const jr = imgs.map((i) => ({ i, r: find(i, (r) => r.codec === 'jxl' && r.param === ds[k] && r.speed === 7) })).filter((x) => x.r);
    const ar = imgs.map((i) => ({ i, r: find(i, (r) => r.codec === 'avif' && r.param === qs[k] && r.speed === 6 && !r.chroma444) })).filter((x) => x.r);
    p(
      `| ${ds[k]} | ${fmt(median(jr.map((x) => x.r!.score)))} | ${fmt(min(jr.map((x) => x.r!.score)))} | ${pct(median(jr.map((x) => x.r!.bytes / x.i.originalBytes)))} || ` +
        `${qs[k]} | ${fmt(median(ar.map((x) => x.r!.score)))} | ${fmt(min(ar.map((x) => x.r!.score)))} | ${pct(median(ar.map((x) => x.r!.bytes / x.i.originalBytes)))} |`,
    );
  }

  // Effort / speed trade-offs relative to the defaults, on images small enough to have them.
  const rel = (pred: (r: Measurement) => boolean, base: (r: Measurement) => boolean) => {
    const xs = imgs
      .map((i) => ({ a: find(i, pred), b: find(i, base) }))
      .filter((x) => x.a && x.b)
      .map((x) => ({ size: x.a!.bytes / x.b!.bytes, score: x.a!.score - x.b!.score, time: x.a!.ms / x.b!.ms }));
    return xs.length
      ? `${pct(median(xs.map((x) => x.size)))} size, ${fmt(median(xs.map((x) => x.score)), 2)} score, ${fmt(median(xs.map((x) => x.time)), 1)}× time (n=${xs.length})`
      : '–';
  };
  const jxlBase = (r: Measurement) => r.codec === 'jxl' && r.param === 1 && r.speed === 7;
  const avifBase = (r: Measurement) => r.codec === 'avif' && r.param === 64 && r.speed === 6 && !r.chroma444;
  p();
  p(`### Effort / speed vs default (JXL d1 e7, AVIF q64 s6)`);
  p();
  for (const e of [3, 5, 9]) p(`- JXL effort ${e}: ${rel((r) => r.codec === 'jxl' && r.param === 1 && r.speed === e, jxlBase)}`);
  for (const s of [4, 8]) p(`- AVIF speed ${s}: ${rel((r) => r.codec === 'avif' && r.param === 64 && r.speed === s && !r.chroma444, avifBase)}`);
  p(`- AVIF 4:4:4: ${rel((r) => r.codec === 'avif' && r.param === 64 && r.speed === 6 && !!r.chroma444, avifBase)}`);
  const jt = imgs.map((i) => find(i, jxlBase)).filter(Boolean).map((r) => r!.ms / 1000);
  const at = imgs.map((i) => find(i, avifBase)).filter(Boolean).map((r) => r!.ms / 1000);
  p(`- Encode time at defaults (wasm, 1 thread): JXL median ${fmt(median(jt))} s / max ${fmt(Math.max(...jt))} s; AVIF median ${fmt(median(at))} s / max ${fmt(Math.max(...at))} s`);
}

console.log(out.join('\n'));
