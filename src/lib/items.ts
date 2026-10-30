import type { InputFormat } from './formats';

export type ItemStatus = 'queued' | 'working' | 'done' | 'error' | 'unsupported';

export interface Item {
  id: number;
  file: File;
  format: InputFormat | null;
  status: ItemStatus;
  warnings: string[];
  output?: Blob;
  outName?: string;
  method?: string;
  error?: string;
  /** settingsKey() the output was produced with. */
  producedWith?: string;
  ms?: number;
}

export function outputName(inputName: string, ext: string): string {
  const dot = inputName.lastIndexOf('.');
  return `${dot > 0 ? inputName.slice(0, dot) : inputName}.${ext}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function savedPercent(before: number, after: number): number {
  return before ? (1 - after / before) * 100 : 0;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
