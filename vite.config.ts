import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  worker: { format: 'es' },
  // jSquash loads its wasm via import.meta.url; pre-bundling breaks that.
  optimizeDeps: { exclude: ['@jsquash/avif'] },
  test: { environment: 'node' },
});
