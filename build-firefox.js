import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { build } from 'vite';

const root = process.cwd();
const alias = {
  '@': resolve(root, 'src'),
  '@/shared': resolve(root, 'src/shared'),
  '@/providers': resolve(root, 'src/providers'),
  '@/background': resolve(root, 'src/background'),
  '@/content': resolve(root, 'src/content'),
  '@/sidepanel': resolve(root, 'src/sidepanel'),
  '@/options': resolve(root, 'src/options'),
};
const define = { 'process.env.NODE_ENV': JSON.stringify('production') };

const FIREFOX_API_SHIM = `// Firefox compatibility
if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
  globalThis.chrome = globalThis.browser;
}
`;

const ensureDir = (path) => {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
};

const cleanDir = (path) => {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
};

const copyDirFiles = (sourceDir, targetDir, predicate = () => true) => {
  if (!existsSync(sourceDir)) {
    return;
  }

  ensureDir(targetDir);
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isFile() && predicate(entry.name)) {
      copyFileSync(resolve(sourceDir, entry.name), resolve(targetDir, entry.name));
    }
  }
};

const patchFirefoxJavaScript = (source) => {
  let patched = source
    .replace(
      /if \(!globalThis\.chrome\?\.runtime\?\.id\) throw new Error\("This script should only be loaded in a browser extension\."\);/g,
      'if (!(globalThis.chrome?.runtime?.id || globalThis.browser?.runtime?.id)) throw new Error("This script should only be loaded in a browser extension.");'
    )
    .replace(
      /if \(!globalThis\.chrome\?\.runtime\?\.id\) \{[\s\S]*?throw new Error\("This script should only be loaded in a browser extension\."\);[\s\S]*?\}/g,
      'if (!(globalThis.chrome?.runtime?.id || globalThis.browser?.runtime?.id)) {\n            throw new Error("This script should only be loaded in a browser extension.");\n          }'
    );

  if (patched.includes('globalThis.chrome') && !patched.trimStart().startsWith(FIREFOX_API_SHIM)) {
    patched = `${FIREFOX_API_SHIM}\n${patched}`;
  }

  return patched;
};

const copyPatchedJavaScript = (sourceFile, targetFile) => {
  ensureDir(resolve(targetFile, '..'));
  writeFileSync(targetFile, patchFirefoxJavaScript(readFileSync(sourceFile, 'utf8')));
};

const viteBase = {
  configFile: false,
  resolve: { alias },
  define,
};

const buildScriptEntry = async (name, input) => {
  const tempDir = `.tmp-firefox-${name.replace(/\//g, '-')}`;
  cleanDir(tempDir);

  try {
    await build({
      ...viteBase,
      build: {
        outDir: tempDir,
        emptyOutDir: true,
        rollupOptions: {
          input,
          output: {
            entryFileNames: `${name}.js`,
            format: 'iife',
          },
          external: [],
        },
        minify: false,
        target: 'es2020',
        commonjsOptions: {
          include: [/node_modules/],
          transformMixedEsModules: true,
        },
      },
    });

    copyPatchedJavaScript(resolve(tempDir, `${name}.js`), resolve(root, `dist/${name}.js`));
  } finally {
    cleanDir(tempDir);
  }
};

const buildHtmlEntry = async (name, input) => {
  const section = name.split('/')[0];
  const tempDir = `.tmp-firefox-${section}`;
  cleanDir(tempDir);

  try {
    await build({
      ...viteBase,
      plugins: [react()],
      build: {
        outDir: tempDir,
        emptyOutDir: true,
        rollupOptions: {
          input,
          output: {
            entryFileNames: `${name}.js`,
            chunkFileNames: '[name].js',
            assetFileNames: (assetInfo) => {
              const assetName = assetInfo.name || '';
              if (assetName.endsWith('.html')) return assetName.replace('src/', '');
              if (assetName.endsWith('.css')) return 'styles/[name][extname]';
              return 'assets/[name][extname]';
            },
            format: 'iife',
          },
        },
        minify: false,
        target: 'es2020',
      },
    });

    copyPatchedJavaScript(resolve(tempDir, `${name}.js`), resolve(root, `dist/${name}.js`));

    const htmlFile = resolve(tempDir, `src/${section}/index.html`);
    if (existsSync(htmlFile)) {
      const html = readFileSync(htmlFile, 'utf8')
        .replace(new RegExp(`src="/${name}\\.js"`, 'g'), 'src="./index.js"')
        .replace(/type="module"\s+crossorigin\s+/g, '')
        .replace(/type="module"\s+/g, '');
      ensureDir(resolve(root, `dist/${section}`));
      writeFileSync(resolve(root, `dist/${section}/index.html`), html);
    }

    copyDirFiles(resolve(tempDir, 'styles'), resolve(root, 'dist/styles'), (file) => file.endsWith('.css'));
    copyDirFiles(resolve(root, `src/${section}/styles`), resolve(root, `dist/${section}/styles`), (file) => file.endsWith('.css'));
  } finally {
    cleanDir(tempDir);
  }
};

const copyExtensionFiles = () => {
  copyFileSync('manifest-firefox.json', 'dist/manifest.json');
  copyDirFiles(resolve(root, 'icons'), resolve(root, 'dist/icons'), (file) => file.endsWith('.png'));

  const fontSource = resolve(root, 'src/assets/fonts');
  copyDirFiles(fontSource, resolve(root, 'dist/assets'), (file) => file.endsWith('.woff2'));
  copyDirFiles(fontSource, resolve(root, 'dist/assets/fonts'), (file) => file.endsWith('.woff2'));

  const sidepanelHtml = resolve(root, 'dist/sidepanel/index.html');
  if (existsSync(sidepanelHtml)) {
    writeFileSync(
      resolve(root, 'dist/sidepanel.html'),
      readFileSync(sidepanelHtml, 'utf8').replace(/src="\.\/index\.js"/g, 'src="./sidepanel/index.js"')
    );
  }
};

const assertRequiredFiles = () => {
  const required = [
    'dist/background/service-worker.js',
    'dist/content/content-script.js',
    'dist/options/index.js',
    'dist/sidepanel/index.js',
    'dist/options/index.html',
    'dist/sidepanel/index.html',
    'dist/sidepanel.html',
    'dist/manifest.json',
  ];
  const missing = required.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(`Missing Firefox build files: ${missing.join(', ')}`);
  }
};

async function buildFirefoxExtension() {
  cleanDir('dist');
  ensureDir('dist');

  await buildScriptEntry('background/service-worker', resolve(root, 'src/background/service-worker.ts'));
  await buildScriptEntry('content/content-script', resolve(root, 'src/content/content-script.ts'));
  await buildHtmlEntry('sidepanel/index', resolve(root, 'src/sidepanel/index.html'));
  await buildHtmlEntry('options/index', resolve(root, 'src/options/index.html'));

  copyExtensionFiles();
  assertRequiredFiles();
  console.log('Firefox extension built successfully.');
}

buildFirefoxExtension().catch((error) => {
  console.error(error);
  process.exit(1);
});
