import { build } from 'esbuild';
import { mkdir, cp, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const headlessDir = resolve(rootDir, 'headless');
const headlessSrc = resolve(headlessDir, 'src', 'main.ts');
const headlessDist = resolve(headlessDir, 'dist');
const headlessHtml = resolve(headlessDir, 'index.html');
const nodeModules = resolve(rootDir, 'node_modules');

// Font files to copy from fontsource packages
const fontFiles = [
  // Inter Variable
  {
    src: '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
    dest: 'inter-latin-wght-normal.woff2',
  },
  // Roboto
  {
    src: '@fontsource/roboto/files/roboto-latin-400-normal.woff2',
    dest: 'roboto-latin-400-normal.woff2',
  },
  {
    src: '@fontsource/roboto/files/roboto-latin-500-normal.woff2',
    dest: 'roboto-latin-500-normal.woff2',
  },
  {
    src: '@fontsource/roboto/files/roboto-latin-700-normal.woff2',
    dest: 'roboto-latin-700-normal.woff2',
  },
  // Montserrat
  {
    src: '@fontsource/montserrat/files/montserrat-latin-400-normal.woff2',
    dest: 'montserrat-latin-400-normal.woff2',
  },
  {
    src: '@fontsource/montserrat/files/montserrat-latin-500-normal.woff2',
    dest: 'montserrat-latin-500-normal.woff2',
  },
  {
    src: '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2',
    dest: 'montserrat-latin-700-normal.woff2',
  },
  // Poppins
  {
    src: '@fontsource/poppins/files/poppins-latin-400-normal.woff2',
    dest: 'poppins-latin-400-normal.woff2',
  },
  {
    src: '@fontsource/poppins/files/poppins-latin-500-normal.woff2',
    dest: 'poppins-latin-500-normal.woff2',
  },
  {
    src: '@fontsource/poppins/files/poppins-latin-700-normal.woff2',
    dest: 'poppins-latin-700-normal.woff2',
  },
];

// Generate fonts.css with @font-face declarations
const fontsCSS = `/* Inter Variable */
@font-face {
  font-family: 'Inter Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url(./inter-latin-wght-normal.woff2) format('woff2-variations');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* Roboto */
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(./roboto-latin-400-normal.woff2) format('woff2');
}
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-display: swap;
  font-weight: 500;
  src: url(./roboto-latin-500-normal.woff2) format('woff2');
}
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-display: swap;
  font-weight: 700;
  src: url(./roboto-latin-700-normal.woff2) format('woff2');
}

/* Montserrat */
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(./montserrat-latin-400-normal.woff2) format('woff2');
}
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-display: swap;
  font-weight: 500;
  src: url(./montserrat-latin-500-normal.woff2) format('woff2');
}
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-display: swap;
  font-weight: 700;
  src: url(./montserrat-latin-700-normal.woff2) format('woff2');
}

/* Poppins */
@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(./poppins-latin-400-normal.woff2) format('woff2');
}
@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-display: swap;
  font-weight: 500;
  src: url(./poppins-latin-500-normal.woff2) format('woff2');
}
@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-display: swap;
  font-weight: 700;
  src: url(./poppins-latin-700-normal.woff2) format('woff2');
}
`;

await mkdir(headlessDist, { recursive: true });

// Build the main.js bundle
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

// Copy HTML
await cp(headlessHtml, resolve(headlessDist, 'index.html'));

// Write fonts.css
await writeFile(resolve(headlessDist, 'fonts.css'), fontsCSS);

// Copy font files
for (const font of fontFiles) {
  const srcPath = resolve(nodeModules, font.src);
  const destPath = resolve(headlessDist, font.dest);
  try {
    await cp(srcPath, destPath);
    console.log(`Copied font: ${font.dest}`);
  } catch (err) {
    console.warn(`Warning: Could not copy font ${font.src}:`, err);
  }
}

console.log('Headless bundle built at', headlessDist);
