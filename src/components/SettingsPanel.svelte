<script lang="ts">
  import { qualityToDistance } from '../codecs/jxl';
  import { DEFAULT_SETTINGS, type Settings } from '../lib/settings';

  let { settings = $bindable() }: { settings: Settings } = $props();
  let open = $state(false);

  const summary = $derived.by(() => {
    if (settings.format === 'jxl') {
      const j = settings.jxl;
      const pixels = j.lossless ? 'lossless' : `visually ${j.quality >= 90 ? 'lossless' : 'near-lossless'} (distance ${qualityToDistance(j.quality).toFixed(2)})`;
      if (j.jpegMode === 'reencode') return `All images are encoded ${pixels}.`;
      const jpegs = j.jpegMode === 'auto' && !j.lossless ? 'JPEGs are transcoded losslessly unless re-encoding is much smaller' : 'JPEGs are transcoded losslessly';
      return `${jpegs}; other images are ${pixels}.`;
    }
    const a = settings.avif;
    return a.lossless ? 'All images are encoded losslessly.' : `Quality ${a.quality}, ${a.chroma444 ? '4:4:4' : '4:2:0'} chroma.`;
  });

  const jpegModeHelp = {
    auto: 'Lossless, unless re-encoding at the chosen quality is at least 20% smaller (typical for high-quality JPEGs).',
    lossless: 'Bit-exact, ~20% smaller; the original JPEG can be restored.',
    reencode: 'Encodes the pixels at the chosen quality, like other images.',
  };

  function reset() {
    settings[settings.format] = structuredClone(DEFAULT_SETTINGS[settings.format]) as never;
  }
</script>

<section class="panel">
  <div class="row">
    <div class="segmented" role="radiogroup" aria-label="Output format">
      <label class:active={settings.format === 'jxl'}>
        <input type="radio" bind:group={settings.format} value="jxl" />JPEG XL
      </label>
      <label class:active={settings.format === 'avif'}>
        <input type="radio" bind:group={settings.format} value="avif" />AVIF
      </label>
    </div>
    <p class="summary">{summary}</p>
    <button class="link" onclick={() => (open = !open)} aria-expanded={open}>
      {open ? 'Hide' : 'Advanced'}
    </button>
  </div>

  {#if open}
    <div class="advanced">
      {#if settings.format === 'jxl'}
        <label class="select">
          <span>JPEG inputs</span>
          <select bind:value={settings.jxl.jpegMode}>
            <option value="auto">Automatic (recommended)</option>
            <option value="lossless">Always lossless transcode</option>
            <option value="reencode">Always re-encode</option>
          </select>
          <small>{jpegModeHelp[settings.jxl.jpegMode]}</small>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={settings.jxl.lossless} />
          <span>Lossless for other images</span>
        </label>
        <label class="slider" class:disabled={settings.jxl.lossless}>
          <span>Quality <output>{settings.jxl.quality} · d{qualityToDistance(settings.jxl.quality).toFixed(2)}</output></span>
          <input type="range" min="50" max="100" step="1" bind:value={settings.jxl.quality} disabled={settings.jxl.lossless} />
        </label>
        <label class="slider">
          <span>Effort <output>{settings.jxl.effort}</output> <small>higher = smaller, slower</small></span>
          <input type="range" min="1" max="9" step="1" bind:value={settings.jxl.effort} />
        </label>
      {:else}
        <label class="check">
          <input type="checkbox" bind:checked={settings.avif.lossless} />
          <span>Lossless</span>
        </label>
        <label class="check" class:disabled={settings.avif.lossless}>
          <input type="checkbox" bind:checked={settings.avif.chroma444} disabled={settings.avif.lossless} />
          <span>Full-resolution color (4:4:4) <small>Sharper colored edges for graphics &amp; text, larger files.</small></span>
        </label>
        <label class="slider" class:disabled={settings.avif.lossless}>
          <span>Quality <output>{settings.avif.quality}</output></span>
          <input type="range" min="1" max="100" step="1" bind:value={settings.avif.quality} disabled={settings.avif.lossless} />
        </label>
        <label class="slider">
          <span>Speed <output>{settings.avif.speed}</output> <small>lower = smaller, slower</small></span>
          <input type="range" min="0" max="10" step="1" bind:value={settings.avif.speed} />
        </label>
      {/if}
      <button class="link reset" onclick={reset}>Reset to defaults</button>
    </div>
  {/if}
</section>

<style>
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 16px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .summary {
    flex: 1;
    min-width: 200px;
    margin: 0;
    color: var(--muted);
    font-size: 0.92rem;
  }
  .segmented {
    display: inline-flex;
    padding: 3px;
    border-radius: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .segmented label {
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    color: var(--muted);
  }
  .segmented label.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
  }
  .segmented input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .segmented label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
  }
  .advanced {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px 24px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .check small,
  .slider small {
    display: block;
    color: var(--muted);
  }
  .slider small {
    display: inline;
  }
  .slider,
  .select {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .select small {
    color: var(--muted);
  }
  select {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  .slider input {
    width: 100%;
    accent-color: var(--accent);
  }
  output {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .disabled {
    opacity: 0.5;
  }
  .reset {
    justify-self: start;
  }
</style>
