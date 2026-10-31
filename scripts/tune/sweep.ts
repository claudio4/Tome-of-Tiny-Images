// Encodes every image in test-images/<category>/ with a sweep of JXL and AVIF
// settings, using the same encoders as the app, and scores each result against
// the original with ssimulacra2. Results are cached per image as JSON.
//
//   node scripts/tune/sweep.ts [--images test-images] [--jobs 4] [--budget-mp 45]
//
// Jobs run in parallel only while their summed size stays under --budget-mp
// megapixels (~100 B/pixel per process); a bigger image runs alone.
//
// Needs: ImageMagick (`magick`), djxl, avifdec, and .cache/bin/ssimulacra2
// (scripts/tune/build-tools.sh).

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import encodeAvif, { init as initAvif } from '@jsquash/avif/encode.js';
import { encodeRgba, resetJxlModule, transcodeJpeg } from '../../src/codecs/jxl/index.ts';
import { detectFormat } from '../../src/lib/formats.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, '.cache/tune');
const SSIM = join(ROOT, '.cache/bin/ssimulacra2');

export interface Variant {
  codec: 'jxl' | 'avif';
  /** JXL: distance (0 = lossless) or 'transcode'. AVIF: quality (100 = lossless). */
  param: number | 'transcode';
  /** JXL effort or AVIF speed. */
  speed: number;
  chroma444?: boolean;
}

export interface Measurement extends Variant {
  bytes: number;
  bpp: number;
  score: number;
  ms: number;
}

export interface ImageResult {
  category: string;
  file: string;
  format: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  originalBytes: number;
  results: Measurement[];
}

const BIG = 8_000_000; // pixels; above this only the main quality sweeps run
const HUGE = 16_000_000; // pixels; above this each encode gets a fresh wasm heap
const AVIF_WASM = join(ROOT, 'node_modules/@jsquash/avif/codec/enc/avif_enc.wasm');

function variantsFor(format: string, pixels: number): Variant[] {
  const v: Variant[] = [];
  if (format === 'jpeg') v.push({ codec: 'jxl', param: 'transcode', speed: 7 });
  for (const d of [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4]) v.push({ codec: 'jxl', param: d, speed: 7 });
  for (const q of [40, 50, 58, 64, 70, 76, 82, 88]) v.push({ codec: 'avif', param: q, speed: 6 });
  if (format !== 'jpeg') v.push({ codec: 'jxl', param: 0, speed: 7 });
  if (pixels <= BIG) {
    for (const e of [3, 5, 9]) v.push({ codec: 'jxl', param: 1, speed: e });
    for (const s of [4, 8]) v.push({ codec: 'avif', param: 64, speed: s });
    v.push({ codec: 'avif', param: 64, speed: 6, chroma444: true });
  }
  return v;
}

const id = (v: Variant) => `${v.codec}-${v.param}-s${v.speed}${v.chroma444 ? '-444' : ''}`;

function magick(args: string[], maxBuffer = 2 ** 31): Buffer {
  // Cap ImageMagick's RAM (it spills to disk instead) so huge maps can't exhaust memory.
  const limits = ['-limit', 'memory', '1GiB', '-limit', 'map', '2GiB'];
  const full = args[0] === 'identify' ? ['identify', ...limits, ...args.slice(1)] : [...limits, ...args];
  return execFileSync('magick', full, { maxBuffer });
}

async function encode(v: Variant, src: Uint8Array, rgba: Uint8ClampedArray, w: number, h: number, alpha: boolean) {
  if (v.codec === 'jxl') {
    if (v.param === 'transcode') return transcodeJpeg(src, v.speed);
    const lossless = v.param === 0;
    return encodeRgba({ data: rgba, width: w, height: h }, alpha, { distance: v.param, effort: v.speed, lossless });
  }
  const out = await encodeAvif(
    { data: rgba, width: w, height: h } as ImageData,
    {
      quality: v.param as number,
      speed: v.speed,
      lossless: v.param === 100,
      subsample: v.chroma444 ? 3 : 1,
      enableSharpYUV: !v.chroma444,
    },
  );
  return new Uint8Array(out);
}

async function sweepOne(file: string, category: string): Promise<ImageResult> {
  const tmp = join(OUT, 'tmp', `${category}__${basename(file)}`);
  mkdirSync(tmp, { recursive: true });
  const src = new Uint8Array(readFileSync(file));
  const format = detectFormat(src)!;

  // Reference = what the browser would see: oriented, 8-bit sRGB RGBA.
  const ref = join(tmp, 'ref.png');
  magick([file + '[0]', '-auto-orient', '-colorspace', 'sRGB', '-depth', '8', ref]);
  const [w, h] = magick(['identify', '-format', '%w %h', ref]).toString().split(' ').map(Number);
  const rgba = new Uint8ClampedArray(magick([ref, '-depth', '8', 'RGBA:-']));
  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { hasAlpha = true; break; }

  const results: Measurement[] = [];
  for (const v of variantsFor(format, w * h)) {
    if (w * h > HUGE) {
      resetJxlModule();
      await initAvif(await WebAssembly.compile(readFileSync(AVIF_WASM)));
    }
    const t0 = performance.now();
    const data = await encode(v, src, rgba, w, h, hasAlpha);
    const ms = performance.now() - t0;
    const enc = join(tmp, `${id(v)}.${v.codec}`);
    const dec = join(tmp, `${id(v)}.png`);
    writeFileSync(enc, data);
    if (v.codec === 'jxl') execFileSync('djxl', [enc, dec], { stdio: 'ignore' });
    else {
      execFileSync('avifdec', ['--depth', '8', enc, dec], { stdio: 'ignore' });
      // avifdec writes a cICP chunk that libjxl's PNG reader rejects.
      magick([dec, '-strip', dec]);
    }
    const score = v.param === 'transcode' ? 100 : Number(execFileSync(SSIM, [ref, dec]).toString().trim());
    results.push({ ...v, bytes: data.byteLength, bpp: (data.byteLength * 8) / (w * h), score, ms: Math.round(ms) });
    rmSync(enc);
    rmSync(dec);
    process.stderr.write(`  ${category}/${basename(file)} ${id(v)} → ${data.byteLength} B, ssim2 ${score.toFixed(1)}, ${Math.round(ms)} ms\n`);
  }
  rmSync(tmp, { recursive: true, force: true });
  return {
    category,
    file: basename(file),
    format,
    width: w,
    height: h,
    hasAlpha,
    originalBytes: src.byteLength,
    results,
  };
}

const { values } = parseArgs({
  options: {
    images: { type: 'string', default: join(ROOT, 'test-images') },
    jobs: { type: 'string', default: String(Math.max(1, Math.min(4, cpus().length - 1))) },
    'budget-mp': { type: 'string', default: '45' },
    one: { type: 'string' },
    category: { type: 'string' },
  },
});

if (values.one) {
  // Child mode: one image per process keeps wasm memory bounded.
  await initAvif(await WebAssembly.compile(readFileSync(AVIF_WASM)));
  const result = await sweepOne(values.one, values.category!);
  const dest = join(OUT, 'results', `${values.category}__${basename(values.one)}.json`);
  writeFileSync(dest, JSON.stringify(result, null, 1));
} else {
  mkdirSync(join(OUT, 'results'), { recursive: true });
  if (!existsSync(SSIM)) throw new Error('Missing ssimulacra2: run scripts/tune/build-tools.sh');
  const jobs: { file: string; category: string; mp: number }[] = [];
  for (const category of readdirSync(values.images!, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    for (const f of readdirSync(join(values.images!, category.name))) {
      const file = join(values.images!, category.name, f);
      const fmt = detectFormat(new Uint8Array(readFileSync(file).subarray(0, 32)));
      if (!fmt) {
        console.log(`skip (unsupported input): ${category.name}/${f}`);
        continue;
      }
      if (existsSync(join(OUT, 'results', `${category.name}__${f}.json`))) continue;
      const [w, h] = magick(['identify', '-ping', '-format', '%w %h', file + '[0]']).toString().split(' ').map(Number);
      jobs.push({ file, category: category.name, mp: (w * h) / 1e6 });
    }
  }
  // Largest first so the long ones don't end up running alone at the end.
  jobs.sort((a, b) => b.mp - a.mp);
  const maxJobs = Number(values.jobs);
  const budget = Number(values['budget-mp']);
  console.log(`${jobs.length} images to sweep, up to ${maxJobs} jobs / ${budget} MP at once`);

  let running = 0;
  let activeMp = 0;
  await new Promise<void>((allDone) => {
    const pump = () => {
      if (!jobs.length && !running) return allDone();
      while (running < maxJobs) {
        const i = jobs.findIndex((j) => running === 0 || activeMp + j.mp <= budget);
        if (i < 0) return;
        const job = jobs.splice(i, 1)[0];
        running++;
        activeMp += job.mp;
        const started = Date.now();
        const child = spawn(process.execPath, [import.meta.filename, '--one', job.file, '--category', job.category], {
          stdio: ['ignore', 'inherit', 'inherit'],
        });
        child.on('exit', (code) => {
          running--;
          activeMp -= job.mp;
          const secs = ((Date.now() - started) / 1000).toFixed(0);
          console.log(`${code === 0 ? 'done' : 'FAILED'} ${job.category}/${basename(job.file)} (${job.mp.toFixed(1)} MP) in ${secs} s`);
          pump();
        });
      }
    };
    pump();
  });
}
