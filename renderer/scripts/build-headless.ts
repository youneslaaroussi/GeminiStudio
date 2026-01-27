import { build } from 'esbuild';
import { mkdir, cp } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const headlessDir = resolve(scriptDir, '..', 'headless');
const headlessSrc = resolve(headlessDir, 'src', 'main.ts');
const headlessDist = resolve(headlessDir, 'dist');
const headlessHtml = resolve(headlessDir, 'index.html');

await mkdir(headlessDist, { recursive: true });

await build({
  entryPoints: [headlessSrc],
  outfile: resolve(headlessDist, 'main.js'),
  bundle: true,
  format: 'esm',
  sourcemap: true,
  platform: 'browser',
  target: ['es2022'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
});

await cp(headlessHtml, resolve(headlessDist, 'index.html'));

console.log('Headless bundle built at', headlessDist);
