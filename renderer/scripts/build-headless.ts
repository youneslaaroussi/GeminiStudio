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

// Font configuration: variable fonts and regular fonts
const variableFonts = [
  { name: 'Inter Variable', key: 'inter', file: 'inter-latin-wght-normal.woff2' },
  { name: 'Open Sans Variable', key: 'open-sans', file: 'open-sans-latin-wght-normal.woff2' },
  { name: 'Montserrat Variable', key: 'montserrat', file: 'montserrat-latin-wght-normal.woff2' },
  { name: 'IBM Plex Sans Variable', key: 'ibm-plex-sans', file: 'ibm-plex-sans-latin-wght-normal.woff2' },
  { name: 'Public Sans Variable', key: 'public-sans', file: 'public-sans-latin-wght-normal.woff2' },
  { name: 'DM Sans Variable', key: 'dm-sans', file: 'dm-sans-latin-wght-normal.woff2' },
  { name: 'Noto Sans Variable', key: 'noto-sans', file: 'noto-sans-latin-wdth-wght-normal.woff2' },
  { name: 'Plus Jakarta Sans Variable', key: 'plus-jakarta-sans', file: 'plus-jakarta-sans-latin-wght-normal.woff2' },
  { name: 'Mulish Variable', key: 'mulish', file: 'mulish-latin-wght-normal.woff2' },
  { name: 'Nunito Sans Variable', key: 'nunito-sans', file: 'nunito-sans-latin-wght-normal.woff2' },
  { name: 'Nunito Variable', key: 'nunito', file: 'nunito-latin-wght-normal.woff2' },
  { name: 'Merriweather Variable', key: 'merriweather', file: 'merriweather-latin-wght-normal.woff2' },
  { name: 'Roboto Variable', key: 'roboto', file: 'roboto-latin-wght-normal.woff2' },
  { name: 'Work Sans Variable', key: 'work-sans', file: 'work-sans-latin-wght-normal.woff2' },
  { name: 'Space Grotesk Variable', key: 'space-grotesk', file: 'space-grotesk-latin-wght-normal.woff2' },
  { name: 'Manrope Variable', key: 'manrope', file: 'manrope-latin-wght-normal.woff2' },
  { name: 'Outfit Variable', key: 'outfit', file: 'outfit-latin-wght-normal.woff2' },
  { name: 'Raleway Variable', key: 'raleway', file: 'raleway-latin-wght-normal.woff2' },
  { name: 'Playfair Display Variable', key: 'playfair-display', file: 'playfair-display-latin-wght-normal.woff2' },
  { name: 'Crimson Pro Variable', key: 'crimson-pro', file: 'crimson-pro-latin-wght-normal.woff2' },
  { name: 'Literata Variable', key: 'literata', file: 'literata-latin-wght-normal.woff2' },
  { name: 'Vollkorn Variable', key: 'vollkorn', file: 'vollkorn-latin-wght-normal.woff2' },
  { name: 'Lora Variable', key: 'lora', file: 'lora-latin-wght-normal.woff2' },
  { name: 'JetBrains Mono Variable', key: 'jetbrains-mono', file: 'jetbrains-mono-latin-wght-normal.woff2' },
];

const regularFonts = [
  { name: 'Roboto', key: 'roboto', weights: [400, 500, 700] },
  { name: 'Montserrat', key: 'montserrat', weights: [400, 500, 700] },
  { name: 'Poppins', key: 'poppins', weights: [400, 500, 700] },
  { name: 'Playfair Display', key: 'playfair-display', weights: [400, 500, 700] },
  { name: 'Raleway', key: 'raleway', weights: [400, 500, 700] },
  { name: 'Lato', key: 'lato', weights: [400, 700] },
  { name: 'Ubuntu', key: 'ubuntu', weights: [400, 500, 700] },
  { name: 'Cabin', key: 'cabin', weights: [400, 500, 700] },
  { name: 'Rubik', key: 'rubik', weights: [400, 500, 700] },
  { name: 'Quicksand', key: 'quicksand', weights: [400, 500, 700] },
  { name: 'Comfortaa', key: 'comfortaa', weights: [400, 500, 700] },
  { name: 'Kalam', key: 'kalam', weights: [400, 700] },
  { name: 'Pacifico', key: 'pacifico', weights: [400] },
  { name: 'Bebas Neue', key: 'bebas-neue', weights: [400] },
  { name: 'Oswald', key: 'oswald', weights: [400, 500, 700] },
  { name: 'Anton', key: 'anton', weights: [400] },
  { name: 'Righteous', key: 'righteous', weights: [400] },
  { name: 'Lobster', key: 'lobster', weights: [400] },
  { name: 'Dancing Script', key: 'dancing-script', weights: [400, 500, 700] },
  { name: 'Barlow', key: 'barlow', weights: [400, 500, 700] },
  { name: 'Fira Sans', key: 'fira-sans', weights: [400, 500, 700] },
  { name: 'IBM Plex Sans', key: 'ibm-plex-sans', weights: [400, 500, 700] },
  { name: 'Source Sans Pro', key: 'source-sans-pro', weights: [400, 700] },
  { name: 'Noto Sans', key: 'noto-sans', weights: [400, 500, 700] },
  { name: 'Work Sans', key: 'work-sans', weights: [400, 500, 700] },
  { name: 'Space Grotesk', key: 'space-grotesk', weights: [400, 500, 700] },
  { name: 'Manrope', key: 'manrope', weights: [400, 500, 700] },
  { name: 'Outfit', key: 'outfit', weights: [400, 500, 700] },
  { name: 'DM Sans', key: 'dm-sans', weights: [400, 500, 700] },
  { name: 'Plus Jakarta Sans', key: 'plus-jakarta-sans', weights: [400, 500, 700] },
  { name: 'Mulish', key: 'mulish', weights: [400, 500, 700] },
  { name: 'Nunito', key: 'nunito', weights: [400, 500, 700] },
  { name: 'Nunito Sans', key: 'nunito-sans', weights: [400, 500, 700] },
  { name: 'Merriweather', key: 'merriweather', weights: [400, 500, 700] },
  { name: 'Public Sans', key: 'public-sans', weights: [400, 500, 700] },
  { name: 'Crimson Pro', key: 'crimson-pro', weights: [400, 500, 700] },
  { name: 'Literata', key: 'literata', weights: [400, 500, 700] },
  { name: 'Libre Baskerville', key: 'libre-baskerville', weights: [400, 500, 700] },
  { name: 'Spectral', key: 'spectral', weights: [400, 500, 700] },
  { name: 'Crimson Text', key: 'crimson-text', weights: [400, 700] },
  { name: 'Vollkorn', key: 'vollkorn', weights: [400, 500, 700] },
  { name: 'Lora', key: 'lora', weights: [400, 500, 700] },
  { name: 'Alegreya', key: 'alegreya', weights: [400, 500, 700] },
  { name: 'Cormorant', key: 'cormorant', weights: [400, 500, 700] },
  { name: 'PT Serif', key: 'pt-serif', weights: [400, 700] },
];

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
