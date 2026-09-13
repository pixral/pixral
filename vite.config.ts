import { defineConfig } from 'vite';

// base relativo: asi el build anda tanto en la raiz de un dominio
// como en un subdirectorio (por ejemplo GitHub Pages).
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
});
