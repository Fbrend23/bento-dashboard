import { resolve } from 'path'
import { defineConfig } from 'vite'

// The agent as one file for node on bento: the project's own code is bundled, only node's
// built-in modules stay outside, so bento needs node and nothing else.
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: {
    ssr: resolve('src/agent/index.ts'),
    outDir: resolve('dist-agent'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'bento-agent.cjs' } }
  }
})
