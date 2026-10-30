<script lang="ts">
  import { download, formatBytes, savedPercent, type Item } from '../lib/items';

  let {
    items,
    currentKey,
    oncompare,
    onretry,
    onremove,
  }: {
    items: Item[];
    currentKey: string;
    oncompare: (i: Item) => void;
    onretry: (i: Item) => void;
    onremove: (i: Item) => void;
  } = $props();
</script>

<ul class="list">
  {#each items as item (item.id)}
    {@const saved = item.output ? savedPercent(item.file.size, item.output.size) : 0}
    <li class:error={item.status === 'error' || item.status === 'unsupported'}>
      <div class="name">
        <span class="filename" title={item.file.name}>{item.file.name}</span>
        <span class="meta">
          {#if item.format}<span class="badge">{item.format.toUpperCase()}</span>{/if}
          {formatBytes(item.file.size)}
          {#if item.method}· {item.method}{/if}
          {#if item.status === 'done' && item.producedWith !== currentKey}· <em>older settings</em>{/if}
        </span>
        {#each item.warnings as w}<span class="warn">{w}</span>{/each}
        {#if item.error}<span class="err">{item.error}</span>{/if}
      </div>

      <div class="result">
        {#if item.status === 'queued'}
          <span class="muted">Queued</span>
        {:else if item.status === 'working'}
          <span class="spinner" aria-label="Compressing"></span>
        {:else if item.status === 'done' && item.output}
          <span class="size">{formatBytes(item.output.size)}</span>
          <span class:good={saved > 0} class:bad={saved <= 0}>
            {saved > 0 ? `−${saved.toFixed(1)}%` : `+${(-saved).toFixed(1)}%`}
          </span>
        {/if}
      </div>

      <div class="buttons">
        {#if item.status === 'done' && item.output}
          <button onclick={() => oncompare(item)}>Compare</button>
          <button class="primary" onclick={() => download(item.output!, item.outName!)}>Download</button>
        {:else if item.status === 'error'}
          <button onclick={() => onretry(item)}>Retry</button>
        {/if}
        <button class="icon" aria-label="Remove {item.file.name}" onclick={() => onremove(item)}>✕</button>
      </div>
    </li>
  {/each}
</ul>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: center;
    padding: 10px 16px;
  }
  li + li {
    border-top: 1px solid var(--border);
  }
  .name {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  .filename {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .badge {
    display: inline-block;
    padding: 0 5px;
    margin-right: 4px;
    border-radius: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    font-size: 0.72rem;
    font-weight: 600;
  }
  .warn {
    color: var(--warn);
    font-size: 0.85rem;
  }
  .err {
    color: var(--bad);
    font-size: 0.85rem;
  }
  .result {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-variant-numeric: tabular-nums;
    justify-content: flex-end;
    min-width: 140px;
  }
  .size {
    font-weight: 600;
  }
  .good {
    color: var(--good);
    font-weight: 600;
  }
  .bad {
    color: var(--bad);
    font-weight: 600;
  }
  .buttons {
    display: flex;
    gap: 6px;
  }
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (max-width: 640px) {
    li {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .buttons {
      grid-column: 1 / -1;
      justify-content: flex-end;
    }
  }
</style>
