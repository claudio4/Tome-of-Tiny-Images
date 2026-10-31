<script lang="ts">
  import DropZone from './components/DropZone.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import FileList from './components/FileList.svelte';
  import CompareViewer from './components/CompareViewer.svelte';
  import { CodecPool } from './lib/pool';
  import { detectFormat, imageSize, isAnimated } from './lib/formats';
  import { loadSettings, saveSettings, settingsKey } from './lib/settings';
  import { canSaveToFolder, download, formatBytes, outputName, saveToFolder, savedPercent, type Item } from './lib/items';
  import { makeZip, uniqueNames } from './lib/zip';

  const pool = new CodecPool();
  let settings = $state(loadSettings());
  let items = $state<Item[]>([]);
  let comparing = $state<Item | null>(null);
  let zipping = $state(false);
  let nextId = 1;

  $effect(() => saveSettings($state.snapshot(settings)));

  const currentKey = $derived(settingsKey(settings));
  const done = $derived(items.filter((i) => i.status === 'done'));
  const pending = $derived(items.filter((i) => i.status === 'queued' || i.status === 'working').length);
  const stale = $derived(done.filter((i) => i.producedWith !== currentKey).length);
  const totalIn = $derived(done.reduce((s, i) => s + i.file.size, 0));
  const totalOut = $derived(done.reduce((s, i) => s + (i.output?.size ?? 0), 0));

  async function addFiles(files: File[]) {
    for (const file of files) {
      const item: Item = { id: nextId++, file, format: null, status: 'queued', warnings: [] };
      items.push(item);
      void process(items[items.length - 1]);
    }
  }

  async function process(item: Item) {
    item.status = 'queued';
    item.error = undefined;
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    item.format = detectFormat(bytes);
    if (!item.format) {
      item.status = 'unsupported';
      item.error = 'Not a PNG, JPEG, WebP or GIF image';
      return;
    }
    item.warnings = isAnimated(bytes, item.format) ? ['Animated: only the first frame is kept'] : [];
    const snapshot = $state.snapshot(settings);
    const key = settingsKey(snapshot);
    const started = performance.now();
    item.status = 'working';
    try {
      const size = imageSize(bytes, item.format);
      const megapixels = size ? (size.width * size.height) / 1e6 : 0;
      const res = await pool.run({ kind: 'encode', bytes, format: item.format, settings: snapshot }, [bytes.buffer], megapixels);
      item.output = new Blob([res.data as BlobPart], { type: res.mime });
      item.outName = outputName(item.file.name, res.ext);
      item.method = res.method;
      item.producedWith = key;
      item.ms = performance.now() - started;
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.error = err instanceof Error ? err.message : String(err);
    }
  }

  function recompressStale() {
    for (const item of items) if (item.status === 'done' && item.producedWith !== currentKey) void process(item);
  }

  function retry(item: Item) {
    void process(item);
  }

  function remove(item: Item) {
    items = items.filter((i) => i.id !== item.id);
  }

  function clearAll() {
    items = [];
  }

  let downloading = $state(false);

  async function downloadEach() {
    downloading = true;
    try {
      const names = uniqueNames(done.map((i) => i.outName!));
      const files = done.map((i, n) => ({ name: names[n], blob: i.output! }));
      // Writing into a picked folder avoids the browser's multiple-downloads prompt entirely.
      if (canSaveToFolder) {
        try {
          await saveToFolder(files);
        } catch (err) {
          alert(`Could not save to the folder: ${err}`);
        }
        return;
      }
      for (const [n, f] of files.entries()) {
        // Browsers drop clicks fired back to back; Chrome may ask once to allow multiple downloads.
        if (n) await new Promise((r) => setTimeout(r, 250));
        download(f.blob, f.name);
      }
    } finally {
      downloading = false;
    }
  }

  async function downloadAll() {
    zipping = true;
    try {
      const blob = await makeZip(done.map((i) => ({ name: i.outName!, blob: i.output! })));
      download(blob, 'compressed-images.zip');
    } finally {
      zipping = false;
    }
  }

  function onWindowDrop(e: DragEvent) {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void addFiles(files);
  }

  function onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) void addFiles(files);
  }
</script>

<svelte:window ondragover={(e) => e.preventDefault()} ondrop={onWindowDrop} onpaste={onPaste} />

<main>
  <header>
    <h1>Image Compressor</h1>
    <p class="tagline">JPEG XL &amp; AVIF, right in your browser. Nothing is uploaded.</p>
  </header>

  <SettingsPanel bind:settings />

  <DropZone compact={items.length > 0} onfiles={addFiles} />

  {#if items.length}
    <FileList {items} {currentKey} oncompare={(i) => (comparing = i)} onretry={retry} onremove={remove} />

    <footer class="summary">
      <div class="totals">
        {#if done.length}
          <strong>{formatBytes(totalIn)} → {formatBytes(totalOut)}</strong>
          <span class="saved">{savedPercent(totalIn, totalOut).toFixed(1)}% smaller</span>
        {/if}
        {#if pending}<span class="muted">{pending} in progress…</span>{/if}
      </div>
      <div class="actions">
        {#if stale}
          <button onclick={recompressStale}>Re-compress {stale} with current settings</button>
        {/if}
        <button onclick={clearAll}>Clear</button>
        <button disabled={!done.length || downloading} onclick={downloadEach}>
          {downloading ? 'Saving…' : canSaveToFolder ? `Save all (${done.length}) to folder…` : `Download all (${done.length})`}
        </button>
        <button class="primary" disabled={!done.length || zipping} onclick={downloadAll}>
          {zipping ? 'Zipping…' : `Download as ZIP`}
        </button>
      </div>
    </footer>
  {/if}
</main>

{#if comparing}
  <CompareViewer item={comparing} {pool} onclose={() => (comparing = null)} />
{/if}

<style>
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 16px 64px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  header h1 {
    margin: 0;
    font-size: 1.6rem;
    letter-spacing: -0.02em;
  }
  .tagline {
    margin: 4px 0 0;
    color: var(--muted);
  }
  .summary {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 -4px 16px rgb(0 0 0 / 0.06);
  }
  .totals {
    display: flex;
    gap: 12px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .saved {
    color: var(--good);
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
