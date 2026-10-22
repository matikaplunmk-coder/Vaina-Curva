// Compila el simulador en un único HTML autocontenido (JS y CSS en línea), para publicarlo como página web.
// Uso: node scripts/build-single.mjs [salida.html]
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? 'dist-single/index.html')
const result = await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [react(), tailwindcss()],
  build: { write: false, cssCodeSplit: false, assetsInlineLimit: Infinity, modulePreload: false, rolldownOptions: { output: { codeSplitting: false } } },
})
const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output)
const js = outputs.filter((o) => o.type === 'chunk').map((o) => o.code).join('\n')
const css = outputs.filter((o) => o.type === 'asset' && o.fileName.endsWith('.css')).map((o) => String(o.source)).join('\n')
const safeJs = js.replace(/<\/script/gi, '<\\/script')
const safeCss = css.replace(/<\/style/gi, '<\\/style')
const html = `<title>Celda Conduit PEAD</title>
<meta name="theme-color" content="#0b1220" />
<style>${safeCss}</style>
<div id="root"></div>
<script type="module">${safeJs}</script>
`
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
console.log(`${out} · ${(html.length / 1024).toFixed(0)} KB · ${outputs.filter((o) => o.type === 'chunk').length} chunk(s)`)
