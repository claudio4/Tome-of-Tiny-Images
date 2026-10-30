<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CodecPool } from '../lib/pool';
  import { formatBytes, type Item } from '../lib/items';

  let { item, pool, onclose }: { item: Item; pool: CodecPool; onclose: () => void } = $props();

  let split = $state(50);
  let actualSize = $state(false);
  let originalUrl = $state<string>();
  let outputUrl = $state<string>();
  let error = $state<string>();
  let dialog: HTMLDialogElement;

  async function toUrl(blob: Blob): Promise<string> {
    // Browsers without native JPEG XL support get a PNG decoded by our own wasm.
    if (blob.type !== 'image/jxl') return URL.createObjectURL(blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = await pool.runNext({ kind: 'decode-jxl', bytes }, [bytes.buffer]);
    const canvas = new OffscreenCanvas(img.width, img.height);
    canvas.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
    return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
  }

  $effect(() => {
    dialog.showModal();
    originalUrl = URL.createObjectURL(item.file);
    toUrl(item.output!).then(
      (url) => (outputUrl = url),
      (err) => (error = String(err)),
    );
  });

  onDestroy(() => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') split = Math.max(0, split - 5);
    if (e.key === 'ArrowRight') split = Math.min(100, split + 5);
  }

  function onpointer(e: PointerEvent) {
    if (e.type === 'pointermove' && e.buttons !== 1) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    split = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
  }
</script>

<dialog bind:this={dialog} onclose={onclose} {onkeydown}>
  <header>
    <div class="title">
      <strong>{item.file.name}</strong>
      <span class="muted">{item.method}</span>
    </div>
    <label class="check"><input type="checkbox" bind:checked={actualSize} /> 1:1 pixels</label>
    <button onclick={() => dialog.close()}>Close</button>
  </header>

  <div class="labels">
    <span>Original · {formatBytes(item.file.size)}</span>
    <span>{item.outName?.split('.').pop()?.toUpperCase()} · {formatBytes(item.output!.size)}</span>
  </div>

  <div class="viewport" class:actual={actualSize}>
    {#if error}
      <p class="err">Could not decode output: {error}</p>
    {:else if originalUrl && outputUrl}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="stage" onpointerdown={onpointer} onpointermove={onpointer}>
        <img src={outputUrl} alt="Compressed" draggable="false" />
        <img class="top" src={originalUrl} alt="Original" draggable="false" style:clip-path="inset(0 {100 - split}% 0 0)" />
        <div class="handle" style:left="{split}%"></div>
      </div>
    {:else}
      <span class="spinner"></span>
    {/if}
  </div>
  <p class="hint muted">Drag across the image, or use ← → keys.</p>
</dialog>

<style>
  dialog {
    width: min(1200px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.6);
  }
  header {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    white-space: nowrap;
  }
  .labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .viewport {
    flex: 1;
    min-height: 200px;
    overflow: auto;
    display: grid;
    place-items: center;
    background: repeating-conic-gradient(var(--checker) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
    border-radius: 6px;
  }
  .stage {
    position: relative;
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }
  .stage img {
    display: block;
    max-width: 100%;
    max-height: calc(100vh - 200px);
  }
  .actual .stage img {
    max-width: none;
    max-height: none;
  }
  .actual {
    place-items: start;
  }
  .stage .top {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: white;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
    pointer-events: none;
  }
  .hint {
    margin: 0;
    font-size: 0.8rem;
  }
  .err {
    color: var(--bad);
  }
  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
