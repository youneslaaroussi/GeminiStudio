import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { variableFonts, regularFonts } from '../headless/font-config.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const headlessDir = resolve(rootDir, 'headless');
const headlessSrc = resolve(headlessDir, 'src', 'main.ts');
const headlessDist = resolve(headlessDir, 'dist');
const headlessHtml = resolve(headlessDir, 'index.html');
const nodeModules = resolve(rootDir, 'node_modules');

// Generate font files to copy
const fontFiles: Array<{ src: string; dest: string }> = [];

// Variable fonts
for (const font of variableFonts) {
  fontFiles.push({
    src: `@fontsource-variable/${font.key}/files/${font.file}`,
    dest: font.file,
  });
}

// Regular fonts
for (const font of regularFonts) {
  for (const weight of font.weights) {
    const fileKey = font.key.replace(/-/g, '-');
    fontFiles.push({
      src: `@fontsource/${font.key}/files/${font.key}-latin-${weight}-normal.woff2`,
      dest: `${font.key}-latin-${weight}-normal.woff2`,
    });
  }
}

// Generate fonts.css with @font-face declarations
const fontFaceDeclarations: string[] = [];

// Variable fonts
for (const font of variableFonts) {
  const cssName = font.name.replace(' Variable', '');
  fontFaceDeclarations.push(`/* ${font.name} */
@font-face {
  font-family: '${font.name}';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url(./${font.file}) format('woff2-variations');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* Also register without "Variable" suffix for compatibility (e.g. "JetBrains Mono") */
${cssName !== font.name ? `@font-face {
  font-family: '${cssName}';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url(./${font.file}) format('woff2-variations');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}` : ''}`);
}

// Regular fonts
for (const font of regularFonts) {
  const fontFaces: string[] = [];
  for (const weight of font.weights) {
    fontFaces.push(`@font-face {
  font-family: '${font.name}';
  font-style: normal;
  font-display: swap;
  font-weight: ${weight};
  src: url(./${font.key}-latin-${weight}-normal.woff2) format('woff2');
}`);
  }
  fontFaceDeclarations.push(`/* ${font.name} */
${fontFaces.join('\n')}`);
}

const fontsCSS = fontFaceDeclarations.join('\n\n');

// Generate font preload links (same pattern as app: link rel="preload" in head)
const preloadLines = fontFiles.map(
  (f) =>
    `    <link rel="preload" href="./${f.dest}" as="font" type="font/woff2" crossorigin="anonymous" />`,
);
const fontPreloadsBlock = `    <!-- Preload fonts for faster rendering (generated from variableFonts + regularFonts) -->
${preloadLines.join('\n')}`;

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

// Read template HTML and inject generated font preloads (Motion Canvas: fonts via @font-face in CSS + preload)
const htmlTemplate = await readFile(headlessHtml, 'utf-8');
const htmlWithPreloads = htmlTemplate.replace(
  '<!-- FONT_PRELOADS -->',
  fontPreloadsBlock,
);
await writeFile(resolve(headlessDist, 'index.html'), htmlWithPreloads);

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
