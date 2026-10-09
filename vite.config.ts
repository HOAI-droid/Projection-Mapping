import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, 'client');

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
    target: ['safari15', 'chrome90'],
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        control: resolve(root, 'control.html'),
        output: resolve(root, 'output.html'),
      },
    },
  },
});
