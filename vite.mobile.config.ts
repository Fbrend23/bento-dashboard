import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The phone page, served by the bento agent. Relative base so it works at any path.
export default defineConfig({
  root: resolve('src/mobile'),
  base: './',
  plugins: [vue()],
  // TrendChart is the desktop's own component, imported rather than copied.
  resolve: {
    alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') }
  },
  build: { outDir: resolve('dist-mobile'), emptyOutDir: true, target: 'es2022' }
})
