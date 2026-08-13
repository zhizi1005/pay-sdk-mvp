import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version)
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'RampPay',
      formats: ['iife'],
      fileName: () => 'pay.min.js'
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false
  },
  plugins: [
    {
      name: 'copy-pay-min-to-output',
      closeBundle() {
        const src = resolve(__dirname, 'dist/pay.min.js')
        const destDir = resolve(__dirname, 'output/ramp-pay/v1')
        mkdirSync(destDir, { recursive: true })
        copyFileSync(src, resolve(__dirname, 'output/pay.min.js'))
        copyFileSync(src, resolve(destDir, 'pay.min.js'))
      }
    }
  ]
})
