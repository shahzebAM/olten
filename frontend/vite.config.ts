import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'

// Keep PDF decoding resources on this origin, including development servers
// whose test/project root differs from the directory containing this config.
function localPdfAssets(): Plugin {
  const packageDirectory = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const assetDirectories = ['cmaps', 'standard_fonts', 'wasm'] as const
  const contentTypes: Record<string, string> = {
    '.wasm': 'application/wasm', '.js': 'text/javascript; charset=utf-8',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.bcmap': 'application/octet-stream',
  }
  let basePath = '/'

  return {
    name: 'vite-plugin-local-pdf-assets',
    configResolved(config) {
      basePath = new URL(config.base, 'http://vite.local/').pathname.replace(/\/?$/, '/')
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let requestPath: string
        try { requestPath = decodeURIComponent((request.url || '').split('?')[0]) }
        catch { response.statusCode = 400; response.end(); return }
        const prefix = `${basePath}pdfjs/`
        if (!requestPath.startsWith(prefix)) { next(); return }
        // Only flat package assets are public; reject traversal, nested paths,
        // Windows separators, and directory listings before touching the disk.
        const match = /^(cmaps|standard_fonts|wasm)\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(requestPath.slice(prefix.length))
        if (!match) { response.statusCode = 404; response.end(); return }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405; response.setHeader('Allow', 'GET, HEAD'); response.end(); return
        }
        void readFile(join(packageDirectory, match[1], match[2])).then(contents => {
          if (response.destroyed) return
          response.setHeader('Content-Type', contentTypes[extname(match[2])] || 'application/octet-stream')
          response.setHeader('Content-Length', contents.byteLength)
          response.setHeader('Cache-Control', 'public, max-age=3600')
          response.setHeader('X-Content-Type-Options', 'nosniff')
          response.end(request.method === 'HEAD' ? undefined : contents)
        }).catch(() => {
          if (!response.destroyed) { response.statusCode = 404; response.end() }
        })
      })
    },
    async generateBundle() {
      // Emit into Vite's output instead of copying to a hard-coded dist path.
      // Asset filenames remain relative to the configured production base.
      for (const directory of assetDirectories) {
        for (const entry of await readdir(join(packageDirectory, directory), { withFileTypes: true })) {
          if (!entry.isFile()) continue
          this.emitFile({
            type: 'asset', fileName: `pdfjs/${directory}/${entry.name}`,
            source: await readFile(join(packageDirectory, directory, entry.name)),
          })
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [react(),
    tailwindcss(),
    localPdfAssets(),
  ],
})
