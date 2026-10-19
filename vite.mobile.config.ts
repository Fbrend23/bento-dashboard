import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The phone page, served by the bento agent. Relative base so it works at any path.
export default defineConfig({
  root: resolve('src/mobile'),
  base: './',
  plugins: [vue()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: { outDir: resolve('dist-mobile'), emptyOutDir: true, target: 'es2022' }
})
