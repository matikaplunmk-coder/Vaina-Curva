/**
 * Grabación de clips de la cámara: cada cuadro se rasteriza desde el SVG que se está viendo, se le
 * dibuja encima el overlay CCTV y el canvas alimenta un MediaRecorder que produce un .webm.
 */
import { CAM_LABEL } from './timecode'

export interface OverlayInfo {
  /** Timecode ya formateado del cuadro que se está mostrando */
  timecode: string
  fps: number
  /** Velocidad de reproducción mostrada en pantalla (p. ej. 0.25) */
  speed: number | 'step'
  /** Segundos hacia atrás respecto de "en vivo" cuando se está reviendo; null = en vivo */
  replayOffset: number | null
  scanlines: boolean
  postFx: boolean
}

export interface ClipSupport {
  video: boolean
  mime: string | null
}

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/** ¿Puede este navegador grabar video desde un canvas? */
export function clipSupport(): ClipSupport {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) {
    return { video: false, mime: null }
  }
  const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? null
  return { video: mime !== null, mime }
}

// ---------------------------------------------------------------- SVG → imagen

let cssCache: string | null = null

/** Hoja de estilos de la página (las clases de Tailwind del SVG) para incrustarla en cada cuadro. */
export function pageCss(): string {
  if (cssCache !== null) return cssCache
  let css = ''
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n'
    } catch {
      // hoja de otro origen: no se puede leer
    }
  }
  cssCache = css
  return css
}

/** Rasteriza un SVG del DOM a una imagen (con los estilos de la página incrustados). */
export async function svgToImage(svg: SVGSVGElement, width: number, height: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.removeAttribute('class')
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = pageCss()
  clone.insertBefore(style, clone.firstChild)
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    // la imagen ya está decodificada: se puede liberar la URL
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

// ---------------------------------------------------------------- overlay CCTV en canvas

let grainTile: HTMLCanvasElement | null = null

function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const img = g.createImageData(128, 128)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  grainTile = c
  return c
}

/** Dibuja sobre el canvas el mismo overlay que se ve en pantalla (REC, timecode, marcas, viñeta, scanlines). */
export function drawCctvOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, info: OverlayInfo, now: number, recording?: { seconds: number }) {
  const k = w / 960
  ctx.save()
  if (info.postFx) {
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.56)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(0,0,0,0.5)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, w, h)
    const pat = ctx.createPattern(grain(), 'repeat')
    if (pat) {
      ctx.globalAlpha = 0.06
      ctx.translate(-Math.random() * 128, -Math.random() * 128)
      ctx.fillStyle = pat
      ctx.fillRect(0, 0, w + 128, h + 128)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = 1
    }
  }
  if (info.scanlines) {
    ctx.fillStyle = 'rgba(0,0,0,0.14)'
    for (let y = 0; y < h; y += 3 * k) ctx.fillRect(0, y, w, Math.max(1, k))
  }

  const mono = `${Math.round(13 * k)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`
  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur = 3 * k
  ctx.textBaseline = 'top'

  // REC titilante + nombre de la cámara
  const blinkOn = Math.floor(now / 600) % 2 === 0
  if (blinkOn) {
    ctx.fillStyle = '#ff2a2a'
    ctx.shadowColor = 'rgba(255,42,42,0.8)'
    ctx.shadowBlur = 8 * k
    ctx.beginPath()
    ctx.arc(48 * k, 29 * k, 5.5 * k, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 3 * k
  }
  ctx.font = `bold ${Math.round(14 * k)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`
  ctx.fillStyle = '#ff5a5a'
  ctx.fillText('REC', 60 * k, 21 * k)
  ctx.font = mono
  ctx.fillStyle = '#f1f5f9'
  ctx.fillText(CAM_LABEL, 100 * k, 22 * k)
  let line = 44 * k
  if (info.replayOffset !== null) {
    ctx.fillStyle = '#fbbf24'
    ctx.fillText(`◀◀ REPLAY  -${info.replayOffset.toFixed(1)} s`, 42 * k, line)
    line += 18 * k
  }
  if (recording) {
    ctx.fillStyle = '#ff5a5a'
    ctx.fillText(`● GRABANDO CLIP ${String(Math.floor(recording.seconds / 60)).padStart(2, '0')}:${String(Math.floor(recording.seconds % 60)).padStart(2, '0')}`, 42 * k, line)
  }

  // timecode + FPS
  ctx.textAlign = 'right'
  ctx.fillStyle = '#f1f5f9'
  ctx.fillText(info.timecode, w - 42 * k, 22 * k)
  ctx.fillStyle = '#cbd5e1'
  ctx.fillText(`FPS ${info.fps}   ×${info.speed === 'step' ? 'paso' : info.speed}`, w - 42 * k, 42 * k)
  ctx.textAlign = 'left'

  // marcas de encuadre [ + ] en las esquinas y cruz central
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 2 * k
  const m = 10 * k
  const L = 26 * k
  const corner = (x: number, y: number, dx: number, dy: number) => {
    ctx.beginPath()
    ctx.moveTo(x + dx * L, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + dy * L)
    ctx.stroke()
    const px = x + dx * 12 * k
    const py = y + dy * 12 * k
    ctx.lineWidth = 1.2 * k
    ctx.beginPath()
    ctx.moveTo(px - 4 * k, py)
    ctx.lineTo(px + 4 * k, py)
    ctx.moveTo(px, py - 4 * k)
    ctx.lineTo(px, py + 4 * k)
    ctx.stroke()
    ctx.lineWidth = 2 * k
  }
  corner(m, m, 1, 1)
  corner(w - m, m, -1, 1)
  corner(m, h - m, 1, -1)
  corner(w - m, h - m, -1, -1)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = k
  ctx.beginPath()
  ctx.moveTo(w / 2 - 8 * k, h / 2)
  ctx.lineTo(w / 2 + 8 * k, h / 2)
  ctx.moveTo(w / 2, h / 2 - 8 * k)
  ctx.lineTo(w / 2, h / 2 + 8 * k)
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------- grabador

export interface ClipResult {
  url: string
  size: number
  mime: string
  ext: 'webm' | 'png'
  seconds: number
  name: string
}

export interface ClipOptions {
  getSvg: () => SVGSVGElement | null
  getOverlay: () => OverlayInfo
  width?: number
  height?: number
  fps?: number
  maxSeconds?: number
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')

async function paintFrame(ctx: CanvasRenderingContext2D, o: Required<Pick<ClipOptions, 'width' | 'height'>> & ClipOptions, recording?: { seconds: number }) {
  const svg = o.getSvg()
  // primero se rasteriza y recién después se pinta todo junto: si el canvas se limpiara antes de esperar
  // la imagen, captureStream podría muestrear un cuadro a medio pintar (negro)
  const img = svg ? await svgToImage(svg, o.width, o.height) : null
  ctx.fillStyle = '#05080d'
  ctx.fillRect(0, 0, o.width, o.height)
  if (img) ctx.drawImage(img, 0, 0, o.width, o.height)
  drawCctvOverlay(ctx, o.width, o.height, o.getOverlay(), performance.now(), recording)
}

/** Captura un cuadro suelto como PNG (alternativa cuando el navegador no puede grabar video). */
export async function captureFrame(opts: ClipOptions): Promise<ClipResult> {
  const width = opts.width ?? 1280
  const height = opts.height ?? 800
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  await paintFrame(ctx, { ...opts, width, height })
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('No se pudo generar la imagen.')
  return { url: URL.createObjectURL(blob), size: blob.size, mime: 'image/png', ext: 'png', seconds: 0, name: `cam01-${stamp()}.png` }
}

/**
 * Graba la cámara a un .webm. `start()` empieza; `stop()` (o el tope de segundos) termina y entrega
 * el archivo. El video dura lo que dura la grabación en tiempo real, aunque el ritmo de cuadros
 * dependa de la velocidad del navegador para rasterizar el SVG.
 */
export class ClipRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private active = false
  private startedAt = 0
  private loop: Promise<void> | null = null
  private done: Promise<ClipResult> | null = null
  private finish: ((r: ClipResult) => void) | null = null
  private fail: ((e: unknown) => void) | null = null
  private timer = 0
  private opts: Required<Pick<ClipOptions, 'width' | 'height' | 'fps' | 'maxSeconds'>> & ClipOptions

  constructor(opts: ClipOptions) {
    this.opts = { width: 1280, height: 800, fps: 24, maxSeconds: 12, ...opts }
  }

  get seconds() {
    return this.active ? (performance.now() - this.startedAt) / 1000 : 0
  }

  /** Se completa con el archivo cuando la grabación termina (por `stop()` o por el tope de segundos). */
  get result(): Promise<ClipResult> {
    if (!this.done) throw new Error('La grabación no empezó.')
    return this.done
  }

  async start(): Promise<void> {
    const support = clipSupport()
    if (!support.video || !support.mime) throw new Error('Este navegador no puede grabar video (MediaRecorder / captureStream).')
    const { width, height, fps } = this.opts
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    await paintFrame(ctx, this.opts) // primer cuadro antes de arrancar, para que el video no empiece en negro
    const stream = canvas.captureStream(fps)
    const rec = new MediaRecorder(stream, { mimeType: support.mime, videoBitsPerSecond: 4_000_000 })
    this.recorder = rec
    this.chunks = []
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data)
    }
    this.done = new Promise<ClipResult>((resolve, reject) => {
      this.finish = resolve
      this.fail = reject
    })
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(this.chunks, { type: 'video/webm' })
      if (blob.size === 0) this.fail?.(new Error('La grabación salió vacía.'))
      else
        this.finish?.({ url: URL.createObjectURL(blob), size: blob.size, mime: 'video/webm', ext: 'webm', seconds: (performance.now() - this.startedAt) / 1000, name: `cam01-${stamp()}.webm` })
    }
    rec.onerror = () => this.fail?.(new Error('Falló la grabación.'))
    this.active = true
    this.startedAt = performance.now()
    rec.start(250)
    this.loop = this.run(ctx)
    this.timer = window.setTimeout(() => void this.stop(), this.opts.maxSeconds * 1000)
    this.done.catch(() => undefined) // el que llama maneja el error; esto evita el aviso de promesa sin capturar
  }

  private async run(ctx: CanvasRenderingContext2D) {
    const frameMs = 1000 / this.opts.fps
    while (this.active) {
      const t0 = performance.now()
      try {
        await paintFrame(ctx, this.opts, { seconds: this.seconds })
      } catch {
        // un cuadro que falla no corta la grabación
      }
      // siempre se cede el hilo (mínimo 8 ms): si rasterizar tarda más que un cuadro, la página no debe congelarse
      const wait = Math.max(8, frameMs - (performance.now() - t0))
      await new Promise((r) => setTimeout(r, wait))
    }
  }

  async stop(): Promise<ClipResult | null> {
    if (!this.active || !this.recorder) return null
    this.active = false
    window.clearTimeout(this.timer)
    await this.loop
    if (this.recorder.state !== 'inactive') this.recorder.stop()
    return this.done
  }
}
