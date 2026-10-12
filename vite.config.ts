/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// ローカル開発用：api/ 配下の関数（Web標準の Request → Response 形式）を Vite の開発サーバーで動かす。
// 本番では Vercel Functions が同じファイルを実行する。
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
          // /api/auth/... はすべて api/auth.ts が処理する（本番では vercel.json の rewrites が同じ役割）
          const name = url.pathname.startsWith('/api/auth/') ? 'auth' : url.pathname.slice('/api/'.length)
          if (!/^[a-z][a-z-]*$/.test(name)) {
            res.statusCode = 404
            return res.end()
          }
          const mod = await server.ssrLoadModule(`/api/${name}.ts`)
          const handler = mod[req.method ?? 'GET']
          if (typeof handler !== 'function') {
            res.statusCode = 405
            return res.end()
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value)
          }
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0
          const response: Response = await handler(
            new Request(url, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined }),
          )
          res.statusCode = response.status
          response.headers.forEach((value, key) => {
            if (key !== 'set-cookie') res.setHeader(key, value)
          })
          const cookies = response.headers.getSetCookie()
          if (cookies.length > 0) res.setHeader('set-cookie', cookies)
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          console.error('[dev-api]', error)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'サーバーでエラーが発生しました。' } }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // サーバー側の秘密情報（VITE_ 接頭辞なし）は process.env にだけ入れ、ブラウザ向けコードには渡さない。
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), devApi()],
    test: {
      include: ['tests/**/*.test.ts'],
    },
  }
})
