// Measures whether decoding JPEGs with jpegli (instead of libjpeg-turbo, which
// browsers use) improves lossy JPEG -> JXL re-encodes, and what it costs.
//
//   node scripts/tune/jpeg-decode.ts [--images test-images] [--reps 3] [--part a|b]
//
// Part A (ground truth): every non-JPEG test image is compressed to JPEG with
// cjpeg at several qualities, decoded each way, and re-encoded with cjxl -d 1
// -e 7; decodes and JXL outputs are scored against the original pixels.
// Part B (real JPEGs): the test JPEGs are decoded each way; reports JXL size,
// how far apart the decodes are, and decode time.
//
// Needs: ImageMagick, cjpeg/djpeg (libjpeg-turbo), cjxl/djxl, and
// .cache/bin/{ssimulacra2,djpegli} (scripts/tune/build-tools.sh).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { detectFormat } from '../../src/lib/formats.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, '.cache/tune');
const TMP = join(OUT, 'tmp-jpeg-decode');
const SSIM = join(ROOT, '.cache/bin/ssimulacra2');
const DJPEGLI = join(ROOT, '.cache/bin/djpegli');
const QUALITIES = [75, 85, 95];

const { values } = parseArgs({
  options: {
    images: { type: 'string', default: join(ROOT, 'test-images') },
    reps: { type: 'string', default: '3' },
    part: { type: 'string' }, // rerun only one part, keeping the other's saved results
  },
});
const reps = Number(values.reps);
const RESULTS = join(OUT, 'jpeg-decode.json');

type Decoder = 'turbo' | 'jpegli8' | 'jpegli16';
const DECODERS: Decoder[] = ['turbo', 'jpegli8', 'jpegli16'];

const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { maxBuffer: 2 ** 31, stdio: ['ignore', 'pipe', 'pipe'] });
const magick = (args: string[]) => run('magick', ['-limit', 'memory', '1GiB', '-limit', 'map', '2GiB', ...args]);
const ssim = (ref: string, img: string) => Number(run(SSIM, [ref, img]).toString().trim());

function decode(d: Decoder, jpg: string, out: string) {
  if (d === 'turbo') run('djpeg', ['-outfile', out, jpg]); // PPM, fancy upsampling (browser default)
  else run(DJPEGLI, ['--quiet', '--bitdepth', d === 'jpegli16' ? '16' : '8', jpg, out]);
}

/** Best-of-N decode wall time in ms, output discarded. */
function decodeMs(d: Decoder, jpg: string) {
  let best = Infinity;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    if (d === 'turbo') run('djpeg', ['-outfile', '/dev/null', jpg]);
    else run(DJPEGLI, ['--quiet', '--disable_output', '--bitdepth', d === 'jpegli16' ? '16' : '8', jpg]);
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

/** Re-encodes a decoded image like the app's lossy default; returns bytes and the decoded result path. */
function jxl(src: string, base: string) {
  const enc = `${base}.jxl`;
  const dec = `${base}.jxl.png`;
  run('cjxl', ['--quiet', '-d', '1', '-e', '7', src, enc]);
  run('djxl', ['--quiet', enc, dec]);
  return { bytes: statSync(enc).size, dec };
}

const ext = (d: Decoder) => (d === 'turbo' ? 'ppm' : 'png');
const files: { file: string; category: string; format: string }[] = [];
for (const category of readdirSync(values.images!, { withFileTypes: true })) {
  if (!category.isDirectory()) continue;
  for (const f of readdirSync(join(values.images!, category.name))) {
    const file = join(values.images!, category.name, f);
    const format = detectFormat(new Uint8Array(readFileSync(file).subarray(0, 32)));
    if (format) files.push({ file, category: category.name, format });
  }
}

mkdirSync(TMP, { recursive: true });
const saved = values.part && existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
const partA: any[] = values.part === 'b' ? saved.partA ?? [] : [];
const partB: any[] = values.part === 'a' ? saved.partB ?? [] : [];
const log = (s: string) => process.stderr.write(s + '\n');

for (const { file, category, format } of files) {
  const name = `${category}/${basename(file)}`;
  const dir = join(TMP, `${category}__${basename(file)}`);
  mkdirSync(dir, { recursive: true });
  try {
    if (values.part && values.part !== (format === 'jpeg' ? 'b' : 'a')) continue;
    if (format !== 'jpeg') {
      // Part A: JPEGs made from known-good pixels (alpha flattened on white).
      const ref = join(dir, 'ref.png');
      magick([file + '[0]', '-auto-orient', '-background', 'white', '-alpha', 'remove', '-alpha', 'off',
        '-colorspace', 'sRGB', '-depth', '8', '-strip', ref]);
      const ppm = join(dir, 'ref.ppm');
      magick([ref, ppm]);
      for (const q of QUALITIES) {
        const jpg = join(dir, `q${q}.jpg`);
        run('cjpeg', ['-quality', String(q), '-outfile', jpg, ppm]);
        const row: any = { name, category, q, jpegBytes: statSync(jpg).size };
        for (const d of DECODERS) {
          const out = join(dir, `q${q}-${d}.${ext(d)}`);
          decode(d, jpg, out);
          const j = jxl(out, join(dir, `q${q}-${d}`));
          row[d] = { decodeScore: ssim(ref, out), jxlBytes: j.bytes, jxlScore: ssim(ref, j.dec) };
        }
        partA.push(row);
        log(`A ${name} q${q}: ` + DECODERS.map((d) => `${d} dec ${row[d].decodeScore.toFixed(1)} jxl ${row[d].jxlScore.toFixed(1)} ${row[d].jxlBytes}B`).join(' | '));
        writeFileSync(RESULTS, JSON.stringify({ partA, partB }, null, 1));
      }
    } else {
      // Part B: real JPEGs, no ground truth.
      const row: any = { name, category, jpegBytes: statSync(file).size };
      const outs: Record<string, string> = {};
      for (const d of DECODERS) {
        outs[d] = join(dir, `${d}.${ext(d)}`);
        decode(d, file, outs[d]);
        const j = jxl(outs[d], join(dir, d));
        row[d] = { ms: decodeMs(d, file), jxlBytes: j.bytes, jxlVsOwnDecode: ssim(outs[d], j.dec) };
      }
      const [w, h] = run('magick', ['identify', '-ping', '-format', '%w %h', file]).toString().split(' ').map(Number);
      row.mp = (w * h) / 1e6;
      // How different the decodes are (each scored against the 16-bit jpegli decode).
      row.turboVsJpegli16 = ssim(outs.jpegli16, outs.turbo);
      row.jpegli8VsJpegli16 = ssim(outs.jpegli16, outs.jpegli8);
      partB.push(row);
      log(`B ${name} (${row.mp.toFixed(1)} MP): ` + DECODERS.map((d) => `${d} ${row[d].ms.toFixed(0)} ms ${row[d].jxlBytes}B`).join(' | ') + ` turbo~jpegli16 ${row.turboVsJpegli16.toFixed(1)}`);
      writeFileSync(RESULTS, JSON.stringify({ partA, partB }, null, 1));
    }
  } catch (e) {
    log(`FAILED ${name}: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
rmSync(TMP, { recursive: true, force: true });

// Summary (medians).
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const f1 = (n: number) => n.toFixed(1);
const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const p = (s = '') => console.log(s);

p(`# jpegli vs libjpeg-turbo decode`);
p();
p(`## A: JPEGs made from ${new Set(partA.map((r) => r.name)).size} non-JPEG images, scored vs the original pixels`);
p();
p(`| cjpeg q | decoder | decode score | JXL d1 score | JXL size vs turbo | Δ score vs turbo |`);
p(`|---|---|---|---|---|---|`);
for (const q of QUALITIES) {
  const rows = partA.filter((r) => r.q === q);
  for (const d of DECODERS) {
    p(`| ${q} | ${d} | ${f1(median(rows.map((r) => r[d].decodeScore)))} | ${f1(median(rows.map((r) => r[d].jxlScore)))} | ` +
      `${pct(median(rows.map((r) => r[d].jxlBytes / r.turbo.jxlBytes - 1)))} | ${f1(median(rows.map((r) => r[d].jxlScore - r.turbo.jxlScore)))} |`);
  }
}
p();
p(`## B: ${partB.length} real JPEGs`);
p();
p(`Median turbo-vs-jpegli16 decode similarity: ${f1(median(partB.map((r) => r.turboVsJpegli16)))}; jpegli8-vs-jpegli16: ${f1(median(partB.map((r) => r.jpegli8VsJpegli16)))}.`);
p();
p(`| decoder | JXL size vs turbo | decode MP/s (median) | decode time vs turbo |`);
p(`|---|---|---|---|`);
for (const d of DECODERS) {
  p(`| ${d} | ${pct(median(partB.map((r) => r[d].jxlBytes / r.turbo.jxlBytes - 1)))} | ${f1(median(partB.map((r) => r.mp / (r[d].ms / 1000))))} | ` +
    `${median(partB.map((r) => r[d].ms / r.turbo.ms)).toFixed(2)}× |`);
}
