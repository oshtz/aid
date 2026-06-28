import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { build as viteBuild, defineConfig } from 'vite';

const alias = {
  '@': resolve(__dirname, 'src'),
  '@/shared': resolve(__dirname, 'src/shared'),
  '@/providers': resolve(__dirname, 'src/providers'),
  '@/background': resolve(__dirname, 'src/background'),
  '@/content': resolve(__dirname, 'src/content'),
  '@/sidepanel': resolve(__dirname, 'src/sidepanel'),
  '@/options': resolve(__dirname, 'src/options'),
};

const define = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
};

const logBuildStep = (message: string) => {
  process.stdout.write(`${message}\n`);
};

const ensureDirectory = (path: string) => {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
};

const copyHtmlEntry = (source: string, destination: string) => {
  if (!existsSync(source)) {
    return;
  }

  ensureDirectory(resolve(destination, '..'));
  copyFileSync(source, destination);
};

const copyContentUiFontAssets = () => {
  const sourceDir = resolve(__dirname, 'src/assets/fonts');
  const targetDir = resolve(__dirname, 'dist/assets/fonts');

  if (!existsSync(sourceDir)) {
    return;
  }

  ensureDirectory(targetDir);

  for (const file of readdirSync(sourceDir)) {
    if (file.endsWith('.woff2')) {
      copyFileSync(resolve(sourceDir, file), resolve(targetDir, file));
    }
  }
};

const buildStandaloneContentScript = async (
  name: string,
  input: string,
  globalName: string
) => {
  await viteBuild({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input,
        output: {
          entryFileNames: `${name}.js`,
          format: 'iife',
          name: globalName,
        },
        external: [],
      },
      target: 'es2020',
      minify: false,
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true,
      },
    },
    resolve: { alias },
    define,
  });
};

export default defineConfig(() => {
  logBuildStep('Building for Chrome');

  return {
    plugins: [
      react(),
      {
        name: 'copy-extension-files',
        async writeBundle() {
          copyFileSync('manifest.json', 'dist/manifest.json');

          ensureDirectory('dist/icons');

          const iconSizes = ['16', '32', '48', '128'];
          iconSizes.forEach((size) => {
            const sourceIcon = `icons/icon-${size}.png`;
            const destIcon = `dist/icons/icon-${size}.png`;

            if (existsSync(sourceIcon)) {
              copyFileSync(sourceIcon, destIcon);
            } else if (existsSync('icons/icon-16.png')) {
              copyFileSync('icons/icon-16.png', destIcon);
            }
          });

          copyContentUiFontAssets();

          copyHtmlEntry('dist/src/options/index.html', 'dist/options/index.html');
          copyHtmlEntry('dist/src/sidepanel/index.html', 'dist/sidepanel/index.html');

          if (existsSync('dist/src')) {
            rmSync('dist/src', { recursive: true, force: true });
          }

          await buildStandaloneContentScript(
            'content/content-script',
            resolve(__dirname, 'src/content/content-script.ts'),
            'AidContentScript'
          );
          logBuildStep('Content script rebuilt as standalone classic script');

          logBuildStep('Extension files copied to dist/');
          logBuildStep('Cleaned up unnecessary src/ directory');
        },
      },
    ],
    resolve: { alias },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
          'content/content-script': resolve(__dirname, 'src/content/content-script.ts'),
          'sidepanel/index': resolve(__dirname, 'src/sidepanel/index.html'),
          'options/index': resolve(__dirname, 'src/options/index.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (assetInfo: { name?: string }) => {
            const name = assetInfo.name || '';

            if (name.endsWith('.html')) {
              return name.replace('src/', '');
            }

            if (name.endsWith('.css')) {
              return 'styles/[name]-[hash][extname]';
            }

            return 'assets/[name]-[hash][extname]';
          },
          format: 'es',
          manualChunks(id: string) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'vendor';
            }

            return undefined;
          },
        },
      },
      target: 'es2022',
      minify: false,
    },
    define,
  };
});
