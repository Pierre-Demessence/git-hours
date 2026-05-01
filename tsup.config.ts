import { defineConfig } from 'tsup';

export default defineConfig({
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  dts: false,
  entry: ['src/index.ts'],
  format: ['esm'],
  minify: false,
  outDir: 'dist',
  target: 'node20',
});
