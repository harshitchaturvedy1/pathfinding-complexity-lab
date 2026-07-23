import { defineConfig } from 'vite';
import { fileURLToPath, URL as NodeURL } from 'node:url';

const projectRoot = fileURLToPath(new NodeURL('./', import.meta.url));
const publicRoot  = fileURLToPath(new NodeURL('./public/',  import.meta.url));
const indexHtml   = fileURLToPath(new NodeURL('./public/index.html', import.meta.url));

export default defineConfig({
  root: publicRoot,
  publicDir: false,
  resolve: {
    // `/src/*` paths inside public/index.html map to project-root sources.
    // This keeps the HTML5 spec layout (public/index.html, favicon.svg/ico)
    // intact without exposing the rest of the repo at runtime.
    alias: {
      '/src': fileURLToPath(new NodeURL('./src/', import.meta.url)),
      '/favicon.svg': fileURLToPath(new NodeURL('./public/favicon.svg', import.meta.url)),
      '/favicon.ico': fileURLToPath(new NodeURL('./public/favicon.ico', import.meta.url))
    }
  },
  server: {
    port: 5173,
    open: false,
    fs: {
      // Allow serving sources from the project root even though Vite's
      // document root is `public/` (so /src/app.js resolves correctly).
      allow: [projectRoot]
    }
  },
  build: {
    outDir: fileURLToPath(new NodeURL('./dist/', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
    rollupOptions: {
      input: indexHtml
    }
  },
  test: {
    // Vitest always runs from project root regardless of Vite document root.
    root: projectRoot,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globals: false
  }
});
