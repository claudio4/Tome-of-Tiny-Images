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

type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
const showDirectoryPicker = (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

/** Whether files can be written straight into a user-picked folder (File System Access API). */
export const canSaveToFolder =
  typeof showDirectoryPicker === 'function' &&
  typeof globalThis.FileSystemFileHandle === 'function' &&
  typeof FileSystemFileHandle.prototype.createWritable === 'function';

/**
 * Asks for a folder and writes the files into it, confirming before overwriting any.
 * Resolves false if the user cancels the picker or the overwrite prompt.
 */
export async function saveToFolder(files: { name: string; blob: Blob }[]): Promise<boolean> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await showDirectoryPicker!({ id: 'compressed-images', mode: 'readwrite' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    throw err;
  }
  const existing = await Promise.all(files.map((f) => dir.getFileHandle(f.name).then(() => true, () => false)));
  const clashes = existing.filter(Boolean).length;
  if (clashes && !confirm(`${clashes} of these files already exist in “${dir.name}”. Overwrite them?`)) return false;
  for (const f of files) {
    const writable = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
    await writable.write(f.blob);
    await writable.close();
  }
  return true;
}
