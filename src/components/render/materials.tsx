/**
 * Materiales del Modo Render: degradados metálicos, cromo, sombras y el tubo de PEAD con volumen.
 * Todo son definiciones SVG estáticas (ids `rm-*`) y capas superpuestas: el color de cada caño sigue
 * saliendo de su temperatura, el sombreado sólo se le monta encima.
 */
import { shade } from './color'

/** Definiciones compartidas de todas las vistas en Modo Render. */
export function RenderDefs() {
  return (
    <defs>
      {/* Piso de planta */}
      <radialGradient id="rm-floor" cx="50%" cy="52%" r="78%">
        <stop offset="0%" stopColor="#1a2434" />
        <stop offset="60%" stopColor="#0d1420" />
        <stop offset="100%" stopColor="#05080d" />
      </radialGradient>

      {/* Sombreado de un caño visto de punta: borde oscuro, hueco interior, brillo especular */}
      <radialGradient id="rm-tube-rim" cx="50%" cy="50%" r="50%">
        <stop offset="68%" stopColor="#000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.42" />
      </radialGradient>
      <radialGradient id="rm-bore" cx="55%" cy="58%" r="58%">
        <stop offset="0%" stopColor="#000" stopOpacity="0.5" />
        <stop offset="70%" stopColor="#000" stopOpacity="0.24" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.08" />
      </radialGradient>
      <radialGradient id="rm-tube-spec" cx="34%" cy="28%" r="42%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="55%" stopColor="#fff" stopOpacity="0.25" />
        <stop offset="100%" stopColor="#fff" stopOpacity="0" />
      </radialGradient>

      {/* Sombreado cilíndrico para tubos horizontales (luz cenital): claro arriba, oscuro abajo */}
      <linearGradient id="rm-cyl-shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
        <stop offset="22%" stopColor="#fff" stopOpacity="0.16" />
        <stop offset="50%" stopColor="#000" stopOpacity="0" />
        <stop offset="78%" stopColor="#000" stopOpacity="0.32" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.6" />
      </linearGradient>

      {/* Metales */}
      <linearGradient id="rm-steel" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#a3b1c4" />
        <stop offset="28%" stopColor="#6b7c93" />
        <stop offset="58%" stopColor="#38465a" />
        <stop offset="82%" stopColor="#526078" />
        <stop offset="100%" stopColor="#1f2937" />
      </linearGradient>
      <linearGradient id="rm-alu" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f1f5f9" />
        <stop offset="24%" stopColor="#c3cedc" />
        <stop offset="55%" stopColor="#8a9bb0" />
        <stop offset="80%" stopColor="#cbd5e1" />
        <stop offset="100%" stopColor="#6b7b90" />
      </linearGradient>
      <linearGradient id="rm-cyl-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#64748b" />
        <stop offset="35%" stopColor="#334155" />
        <stop offset="70%" stopColor="#111827" />
        <stop offset="100%" stopColor="#1e293b" />
      </linearGradient>
      {/* Acero pulido visto de costado (vástago, cabezal): bandas de reflejo perpendiculares al eje */}
      <linearGradient id="rm-metal-h" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f8fafc" />
        <stop offset="18%" stopColor="#cbd5e1" />
        <stop offset="44%" stopColor="#64748b" />
        <stop offset="52%" stopColor="#0f172a" />
        <stop offset="62%" stopColor="#475569" />
        <stop offset="86%" stopColor="#94a3b8" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>
      {/* Cromo espejo (cono expansor, guía): horizonte oscuro entre cielo claro y suelo claro */}
      <linearGradient id="rm-chrome" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="12%" stopColor="#d5dde8" />
        <stop offset="30%" stopColor="#6b7a90" />
        <stop offset="47%" stopColor="#0b1220" />
        <stop offset="53%" stopColor="#1e293b" />
        <stop offset="70%" stopColor="#9aa8bb" />
        <stop offset="88%" stopColor="#f4f7fb" />
        <stop offset="100%" stopColor="#8b99ad" />
      </linearGradient>
      <linearGradient id="rm-brass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fde68a" />
        <stop offset="45%" stopColor="#d97706" />
        <stop offset="100%" stopColor="#78350f" />
      </linearGradient>
      <linearGradient id="rm-brass-off" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#d6b96a" />
        <stop offset="50%" stopColor="#8a5a14" />
        <stop offset="100%" stopColor="#4a2d0c" />
      </linearGradient>
      <radialGradient id="rm-bolt" cx="35%" cy="30%" r="70%">
        <stop offset="0%" stopColor="#f8fafc" />
        <stop offset="60%" stopColor="#64748b" />
        <stop offset="100%" stopColor="#1e293b" />
      </radialGradient>
      <radialGradient id="rm-disc" cx="38%" cy="32%" r="75%">
        <stop offset="0%" stopColor="#e2e8f0" />
        <stop offset="45%" stopColor="#64748b" />
        <stop offset="100%" stopColor="#0f172a" />
      </radialGradient>

      {/* Agua y vidrio */}
      <linearGradient id="rm-depth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.5" />
      </linearGradient>
      <linearGradient id="rm-glass" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
        <stop offset="18%" stopColor="#fff" stopOpacity="0.05" />
        <stop offset="80%" stopColor="#fff" stopOpacity="0.02" />
        <stop offset="100%" stopColor="#fff" stopOpacity="0.16" />
      </linearGradient>
      <linearGradient id="rm-water-cup" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#bae6fd" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#0369a1" stopOpacity="0.95" />
      </linearGradient>
      <linearGradient id="rm-bin-shade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
        <stop offset="50%" stopColor="#fff" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.4" />
      </linearGradient>

      {/* Sombras proyectadas y desenfoques */}
      <filter id="rm-shadow" x="-25%" y="-25%" width="160%" height="160%" colorInterpolationFilters="sRGB">
        <feDropShadow dx="3" dy="5" stdDeviation="3.2" floodColor="#000" floodOpacity="0.62" />
      </filter>
      <filter id="rm-shadow-soft" x="-30%" y="-30%" width="170%" height="170%" colorInterpolationFilters="sRGB">
        <feDropShadow dx="1.5" dy="2.5" stdDeviation="1.8" floodColor="#000" floodOpacity="0.5" />
      </filter>
      <filter id="rm-blur1" x="-10%" y="-40%" width="120%" height="180%">
        <feGaussianBlur stdDeviation="0.9" />
      </filter>
      <filter id="rm-steam" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3.2" />
      </filter>
    </defs>
  )
}

/**
 * Caño de PEAD con volumen: silueta oscura, cuerpo del color de su temperatura, zona iluminada
 * desplazada hacia la luz (arriba a la izquierda) y una línea especular fina. Las capas de luz se
 * recortan con una máscara con la propia silueta, así no sobresalen en los extremos.
 */
export function Pipe3D({ d, color, width, maskId = 'rm-pipe-mask', region }: { d: string; color: string; width: number; maskId?: string; region: { x: number; y: number; w: number; h: number } }) {
  const o = (k: number) => `translate(${-k * width} ${-k * width})`
  return (
    <g>
      <mask id={maskId} maskUnits="userSpaceOnUse" x={region.x} y={region.y} width={region.w} height={region.h}>
        <path d={d} fill="none" stroke="#fff" strokeWidth={width} />
      </mask>
      <path d={d} fill="none" stroke={shade(color, -0.6)} strokeWidth={width} />
      <g mask={`url(#${maskId})`}>
        <path d={d} fill="none" stroke={shade(color, -0.22)} strokeWidth={width * 0.86} transform={o(0.04)} />
        <path d={d} fill="none" stroke={color} strokeWidth={width * 0.62} transform={o(0.1)} />
        <path d={d} fill="none" stroke={shade(color, 0.38)} strokeWidth={width * 0.3} transform={o(0.2)} />
        <path d={d} fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth={width * 0.11} transform={o(0.27)} filter="url(#rm-blur1)" />
      </g>
    </g>
  )
}
