import { zip } from 'fflate';

/** Bundles already-compressed files into a ZIP without recompressing them. */
export async function makeZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  const names = uniqueNames(files.map((f) => f.name));
  await Promise.all(
    files.map(async (f, i) => {
      entries[names[i]] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
    }),
  );
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(entries, (err, out) => (err ? reject(err) : resolve(out))),
  );
  return new Blob([data as BlobPart], { type: 'application/zip' });
}

/** Appends " (2)", " (3)", … to repeated names. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
  });
}
