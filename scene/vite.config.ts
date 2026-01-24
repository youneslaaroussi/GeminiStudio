import { defineConfig } from 'vite';
import mcp from '@motion-canvas/vite-plugin';

const motionCanvas = (typeof mcp === 'function' ? mcp : (mcp as { default: (opts?: { buildForEditor?: boolean }) => unknown[] }).default);

export default defineConfig({
  plugins: motionCanvas({ buildForEditor: false }),
  build: {
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
