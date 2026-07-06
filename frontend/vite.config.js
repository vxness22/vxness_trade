import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** After each build, write dist/build-meta.json so production can be verified (commit + time). */
function buildMetaPlugin() {
  return {
    name: 'vxness-build-meta',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist')
      let commit = 'unknown'
      try {
        commit = execSync('git rev-parse --short HEAD', {
          encoding: 'utf8',
          cwd: path.resolve(__dirname, '..'),
        }).trim()
      } catch {
        /* not a git checkout or git missing */
      }
      try {
        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(
          path.join(outDir, 'build-meta.json'),
          JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 0) + '\n'
        )
      } catch {
        /* ignore */
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), buildMetaPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/website/src'),
    },
  },
})
