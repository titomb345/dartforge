import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

/** Redirect dev server root to index.web.html so it loads the web entry point. */
function webHtmlEntry(): Plugin {
  return {
    name: 'web-html-entry',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const urlPath = req.url?.split('?')[0];
        if (urlPath === '/' || urlPath === '/index.html') {
          req.url = '/index.web.html' + (req.url?.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [webHtmlEntry(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: path.resolve(__dirname, 'index.web.html'),
    },
  },
  server: {
    port: 3000,
  },
});
