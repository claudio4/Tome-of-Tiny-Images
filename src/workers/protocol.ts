import type { EncodeResult } from '../lib/encode';
import type { InputFormat } from '../lib/formats';
import type { Settings } from '../lib/settings';
import type { RgbaImage } from '../codecs/jxl';

export type WorkerRequest =
  | { kind: 'encode'; bytes: Uint8Array; format: InputFormat; settings: Settings }
  | { kind: 'decode-jxl'; bytes: Uint8Array };

export type WorkerResult<R extends WorkerRequest> = R extends { kind: 'encode' } ? EncodeResult : RgbaImage;

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
