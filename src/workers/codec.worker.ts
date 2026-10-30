/// <reference lib="webworker" />
import { decodeRgba } from '../codecs/jxl';
import { encodeAvif } from '../codecs/avif';
import { encodeImage } from '../lib/encode';
import type { WorkerRequest, WorkerResponse } from './protocol';

async function decodeWithBrowser(bytes: Uint8Array): Promise<ImageData> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'default',
  });
  try {
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function handle(req: WorkerRequest): Promise<{ result: unknown; transfer: Transferable[] }> {
  if (req.kind === 'decode-jxl') {
    const img = await decodeRgba(req.bytes);
    return { result: img, transfer: [img.data.buffer] };
  }
  const result = await encodeImage(req.bytes, req.format, req.settings, {
    decode: () => decodeWithBrowser(req.bytes),
    encodeAvif: (img, opts) => encodeAvif(img as ImageData, opts),
  });
  return { result, transfer: [result.data.buffer] };
}

self.onmessage = async (e: MessageEvent<{ id: number; req: WorkerRequest }>) => {
  const { id, req } = e.data;
  try {
    const { result, transfer } = await handle(req);
    self.postMessage({ id, ok: true, result } satisfies WorkerResponse, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};
