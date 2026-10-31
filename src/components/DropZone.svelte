<script lang="ts">
  import { ACCEPT } from '../lib/formats';

  let { compact, onfiles }: { compact: boolean; onfiles: (files: File[]) => void } = $props();
  let input: HTMLInputElement;
  let over = $state(false);

  function pick() {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) onfiles(files);
  }
</script>

<button
  class="drop room"
  class:compact
  class:over
  onclick={() => input.click()}
  ondragenter={() => (over = true)}
  ondragleave={() => (over = false)}
  ondrop={() => (over = false)}
>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
  <span class="main">{compact ? 'Add more images' : 'Drop images here, or click to choose'}</span>
  {#if !compact}<span class="hint">PNG, JPEG, WebP or GIF. You can also paste.</span>{/if}
</button>
<input bind:this={input} type="file" accept={ACCEPT} multiple hidden onchange={pick} />

<style>
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 72px 16px;
    border-radius: 0;
    color: var(--text);
    cursor: pointer;
    transition:
      padding 0.4s ease,
      background-color 0.15s;
  }
  .drop:hover:not(:disabled),
  .drop.over {
    background-color: var(--room-hover);
    border-color: var(--wall);
  }
  .drop.compact {
    flex-direction: row;
    justify-content: center;
    padding: 12px 16px;
  }
  svg {
    width: 28px;
    height: 28px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .compact svg {
    width: 20px;
    height: 20px;
  }
  .main {
    font-family: var(--display);
    font-variation-settings: 'SOFT' 100;
    font-size: 1.3125rem;
    font-weight: 600;
  }
  .compact .main {
    font-family: inherit;
    font-size: 1rem;
  }
  .hint {
    color: var(--muted);
    font-size: 0.875rem;
  }
  @media (max-width: 640px) {
    .drop {
      padding: 48px 16px;
    }
  }
</style>
