<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CodecPool } from '../lib/pool';
  import { formatBytes, type Item } from '../lib/items';

  let { item, pool, onclose }: { item: Item; pool: CodecPool; onclose: () => void } = $props();

  let split = $state(50);
  /** CSS pixels per image pixel; null fits the image to the viewport. */
  let zoom = $state<number | null>(null);
  let natural = $state({ width: 0, height: 0 });
  let viewWidth = $state(0);
  let viewHeight = $state(0);
  let scrollX = $state(0);
  let panning = $state(false);
  let viewport = $state<HTMLDivElement>();
  let stage = $state<HTMLDivElement>();
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

  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 32;
  const ZOOM_STEP = 1.25;

  const fitScale = $derived(natural.width && viewWidth ? Math.min(1, viewWidth / natural.width, viewHeight / natural.height) : 1);
  const scale = $derived(zoom ?? fitScale);
  /** Zoom where one image pixel covers one device pixel. */
  const actualScale = () => 1 / (window.devicePixelRatio || 1);
  const percent = $derived(Math.round((scale / actualScale()) * 100));

  // The slider sits at a fixed spot in the viewport (as % of its width) and the image pans under it.
  const stageWidth = $derived(natural.width * scale);
  const stageLeft = $derived(Math.max(0, (viewWidth - stageWidth) / 2));
  const clipRight = $derived(Math.min(stageWidth, Math.max(0, stageWidth - ((split / 100) * viewWidth + scrollX - stageLeft))));

  /** Zooms to `next`, keeping the image point under (x, y) in viewport coordinates fixed. */
  async function zoomTo(next: number, x = viewWidth / 2, y = viewHeight / 2) {
    if (!viewport || !stage) return;
    next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const ix = (viewport.scrollLeft + x - stage.offsetLeft) / scale;
    const iy = (viewport.scrollTop + y - stage.offsetTop) / scale;
    zoom = next;
    await tick();
    viewport.scrollLeft = ix * next + stage.offsetLeft - x;
    viewport.scrollTop = iy * next + stage.offsetTop - y;
    scrollX = viewport.scrollLeft;
  }

  function onscroll() {
    scrollX = viewport!.scrollLeft;
  }

  function onwheel(e: WheelEvent) {
    // Panning is by dragging, so the wheel (and trackpad pinch, sent as ctrl+wheel) zooms.
    e.preventDefault();
    const r = viewport!.getBoundingClientRect();
    const dy = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 33 : e.deltaY;
    zoomTo(scale * Math.pow(ZOOM_STEP, -dy / 100), e.clientX - r.left, e.clientY - r.top);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') split = Math.max(0, split - 5);
    else if (e.key === 'ArrowRight') split = Math.min(100, split + 5);
    else if (e.key === '+' || e.key === '=') zoomTo(scale * ZOOM_STEP);
    else if (e.key === '-') zoomTo(scale / ZOOM_STEP);
    else if (e.key === '0') zoom = null;
    else if (e.key === '1') zoomTo(actualScale());
  }

  function onload(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    natural = { width: img.naturalWidth, height: img.naturalHeight };
  }

  /** Pointer drag that hands `onmove` the pointer's offset from where it went down. */
  function drag(e: PointerEvent, onmove: (dx: number, dy: number) => void, onend?: () => void) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const { pointerId, clientX: x0, clientY: y0 } = e;
    el.setPointerCapture(pointerId);
    const move = (ev: PointerEvent) => ev.pointerId === pointerId && onmove(ev.clientX - x0, ev.clientY - y0);
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      onend?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function pan(e: PointerEvent) {
    const v = viewport!;
    if (e.button !== 0) return;
    const { scrollLeft, scrollTop } = v;
    panning = true;
    drag(
      e,
      (dx, dy) => {
        v.scrollLeft = scrollLeft - dx;
        v.scrollTop = scrollTop - dy;
      },
      () => (panning = false),
    );
  }

  function moveSlider(e: PointerEvent) {
    const start = split;
    drag(e, (dx) => (split = Math.min(100, Math.max(0, start + (dx / viewWidth) * 100))));
  }
</script>

<dialog bind:this={dialog} onclose={onclose} {onkeydown}>
  <header>
    <div class="title">
      <strong>{item.file.name}</strong>
      <span class="muted">{item.method}</span>
    </div>
    <div class="zoom" role="group" aria-label="Zoom">
      <button class="icon" onclick={() => zoomTo(scale / ZOOM_STEP)} disabled={scale <= MIN_ZOOM} aria-label="Zoom out">−</button>
      <span class="pct">{percent}%</span>
      <button class="icon" onclick={() => zoomTo(scale * ZOOM_STEP)} disabled={scale >= MAX_ZOOM} aria-label="Zoom in">+</button>
      <button class:active={zoom === null} onclick={() => (zoom = null)}>Fit</button>
      <button class:active={zoom === actualScale()} onclick={() => zoomTo(actualScale())}>1:1</button>
    </div>
    <button onclick={() => dialog.close()}>Close</button>
  </header>

  <div class="labels">
    <span>Original · {formatBytes(item.file.size)}</span>
    <span>{item.outName?.split('.').pop()?.toUpperCase()} · {formatBytes(item.output!.size)}</span>
  </div>

  <div class="frame" {onwheel}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="viewport"
      class:panning
      bind:this={viewport}
      bind:clientWidth={viewWidth}
      bind:clientHeight={viewHeight}
      {onscroll}
      onpointerdown={pan}
    >
      {#if error}
        <p class="err">Could not decode output: {error}</p>
      {:else if originalUrl && outputUrl}
        <div
          class="stage"
          class:pixelated={scale / actualScale() >= 2}
          bind:this={stage}
          style:width="{stageWidth}px"
          style:height="{natural.height * scale}px"
        >
          <img src={outputUrl} alt="Compressed" draggable="false" {onload} />
          <img src={originalUrl} alt="Original" draggable="false" style:clip-path="inset(0 {clipRight}px 0 0)" />
        </div>
      {:else}
        <span class="spinner"></span>
      {/if}
    </div>
    {#if originalUrl && outputUrl && !error}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="handle" style:left="{(split / 100) * viewWidth}px" onpointerdown={moveSlider}>
        <svg class="knob" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="16" />
          <path d="M13 11l-5 5 5 5M19 11l5 5-5 5" />
        </svg>
      </div>
    {/if}
  </div>
  <p class="hint muted">Drag to pan; drag the divider (or use ← →) to compare. Scroll or pinch to zoom, + − to step, 0 to fit, 1 for 1:1.</p>
</dialog>

<style>
  dialog {
    width: min(1200px, calc(100vw - 32px));
    height: calc(100vh - 32px);
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
  .zoom {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .zoom .pct {
    min-width: 4.5ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }
  .zoom .active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .frame {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
  }
  .viewport {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: auto;
    display: flex;
    background: repeating-conic-gradient(var(--checker) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
    border-radius: 6px;
    cursor: grab;
    touch-action: none;
    user-select: none;
    scrollbar-width: none;
  }
  .viewport::-webkit-scrollbar {
    display: none;
  }
  .viewport.panning {
    cursor: grabbing;
  }
  .stage {
    position: relative;
    flex: none;
    /* Centres while smaller than the viewport without clipping once larger. */
    margin: auto;
  }
  .stage img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .pixelated img {
    image-rendering: pixelated;
  }
  /* A wide transparent grab area around the visible 2px line. */
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 24px;
    margin-left: -12px;
    cursor: ew-resize;
    touch-action: none;
  }
  .handle::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 11px;
    width: 2px;
    background: white;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
  }
  .knob {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 32px;
    height: 32px;
    transform: translate(-50%, -50%);
    overflow: visible;
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.4));
  }
  .knob circle {
    fill: white;
  }
  .knob path {
    fill: none;
    stroke: #222;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .hint {
    margin: 0;
    font-size: 0.8rem;
  }
  .err {
    margin: auto;
    color: var(--bad);
  }
  .spinner {
    margin: auto;
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
