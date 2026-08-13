import { createReadStream, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const CDN_SDK = 'https://static.alchemypay.org/ramp-pay/v1/pay.min.js'
const localSdk = resolve(__dirname, 'dist/pay.min.js')

export default defineConfig({
  root: resolve(__dirname, 'demo'),
  publicDir: false,
  plugins: [
    {
      name: 'local-ramp-pay-sdk',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== '/pay.min.js') {
            next()
            return
          }
          if (!existsSync(localSdk)) {
            res.statusCode = 404
            res.end('dist/pay.min.js missing; run npm run build')
            return
          }
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          createReadStream(localSdk).pipe(res)
        })
      },
      transformIndexHtml(html) {
        return html.replaceAll(CDN_SDK, '/pay.min.js')
      }
    }
  ],
  server: {
    port: 5173,
    open: '/index.html',
    fs: {
      allow: [resolve(__dirname)]
    }
  }
})
