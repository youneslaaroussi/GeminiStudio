/**
 * Post-build: copy dist to app/public/scene and patch project.js so the
 * project is assigned to globalThis.__SCENE_PROJECT__ for the Next.js app.
 * (The motion-canvas vite plugin rewrites the project entry, so we inject
 * the assignment into the built file.)
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sceneRoot = join(__dirname, '..');
const distDir = join(sceneRoot, 'dist');
const appSceneDir = join(sceneRoot, '..', 'app', 'public', 'scene');
const projectPath = join(appSceneDir, 'src', 'project.js');

const PATCH =
  "if (typeof globalThis !== 'undefined' && 'window' in globalThis) { globalThis.__SCENE_PROJECT__ = project; }\n";

if (!existsSync(distDir)) {
  console.error('postbuild: dist/ not found. Run pnpm build first.');
  process.exit(1);
}

cpSync(distDir, appSceneDir, { recursive: true, force: true });
console.log('postbuild: copied dist to app/public/scene');

// Inject __SCENE_PROJECT__ so the app can read it after loading the script
let js = readFileSync(projectPath, 'utf8');
const exportRegex = /export \{\s*project as default\s*\};?/;
if (!exportRegex.test(js)) {
  console.warn('postbuild: could not find "export { project as default }" in project.js');
} else {
  js = js.replace(exportRegex, (m) => PATCH + m);
  writeFileSync(projectPath, js);
  console.log('postbuild: patched project.js (__SCENE_PROJECT__)');
}

console.log('  →', appSceneDir);
