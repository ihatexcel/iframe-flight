import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs', 'iife'],
  globalName: 'ArrowBridge',
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: false,
  treeshake: true,
  target: 'es2020',
  outDir: 'dist',
  // Bundle apache-arrow into every output format so the package is
  // self-contained — consumers need only one import.
  noExternal: ['apache-arrow'],
  outExtension({ format }) {
    if (format === 'iife') return { js: '.iife.js' };
    if (format === 'cjs') return { js: '.cjs' };
    return { js: '.js' };
  },
});
