// Times the jpegli wasm decoder (scripts/build-jpegli.sh)
// in Node on every test JPEG and checks its pixels against native djpegli.
//
//   node scripts/tune/jpegli-bench.ts [--images test-images] [--reps 3]

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { detectFormat } from '../../src/lib/formats.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const { default: createJpegliModule } = await import(join(ROOT, 'src/codecs/jpegli/build/jpegli.js'));
const { values } = parseArgs({
  options: {
    images: { type: 'string', default: join(ROOT, 'test-images') },
    reps: { type: 'string', default: '3' },
  },
});

const m = await createJpegliModule();

function decode(bytes: Uint8Array) {
  const ptr = m._malloc(bytes.byteLength);
  try {
    m.HEAPU8.set(bytes, ptr);
    if (m._jpegli_decode_rgba(ptr, bytes.byteLength) !== 0) throw new Error('decode failed');
    const out = m.HEAPU8.slice(m._jpegli_out_ptr(), m._jpegli_out_ptr() + m._jpegli_out_len());
    return { data: out, width: m._jpegli_out_width(), height: m._jpegli_out_height() };
  } finally {
    m._free(ptr);
    m._jpegli_out_free();
  }
}

console.log('| file | MP | wasm ms | MP/s | matches djpegli |');
console.log('|---|---|---|---|---|');
const rates: number[] = [];
for (const category of readdirSync(values.images!, { withFileTypes: true })) {
  if (!category.isDirectory()) continue;
  for (const f of readdirSync(join(values.images!, category.name)).sort()) {
    const file = join(values.images!, category.name, f);
    const bytes = new Uint8Array(readFileSync(file));
    if (detectFormat(bytes) !== 'jpeg') continue;
    let best = Infinity;
    let img!: ReturnType<typeof decode>;
    for (let i = 0; i < Number(values.reps); i++) {
      const t0 = performance.now();
      img = decode(bytes);
      best = Math.min(best, performance.now() - t0);
    }
    // Native reference: djpegli -> PPM -> RGBA via ImageMagick.
    const native = execFileSync('sh', ['-c', `t=$(mktemp --suffix=.ppm) && "$0" --quiet "$1" "$t" && magick "$t" -alpha set RGBA:- ; rm -f "$t"`,
      join(ROOT, '.cache/bin/djpegli'), file], { maxBuffer: 2 ** 31 });
    let diff = 0;
    for (let i = 0; i < img.data.length; i++) if (img.data[i] !== native[i]) diff++;
    const mp = (img.width * img.height) / 1e6;
    rates.push(mp / (best / 1000));
    console.log(`| ${category.name}/${f.slice(0, 24)} | ${mp.toFixed(1)} | ${best.toFixed(0)} | ${(mp / (best / 1000)).toFixed(0)} | ` +
      `${native.length === img.data.length && diff === 0 ? 'yes' : `${diff} bytes differ`} |`);
  }
}
rates.sort((a, b) => a - b);
console.log(`\nmedian ${rates[rates.length >> 1].toFixed(0)} MP/s; wasm heap after run: ${(m.HEAPU8.byteLength / 2 ** 20).toFixed(0)} MiB`);
