# Simulador de celda · Curvas conduit PEAD

Simulador interactivo (Vite + React + TypeScript + Tailwind CSS + Recharts) de una celda de manufactura
para curvar caño conduit de PEAD **Ø40 mm × 2–3 mm × 860 mm** con **1 operario**:

carrusel de **16 posiciones** (10–18, paso 22,5° con 16) con la mitad inferior sumergida en una **batea semicilíndrica de
glicerina** (R 323 mm × L 900 mm, ~120 L a 132 °C; rango 120–135 °C). Consigna de retiro: 120 °C → **estación de
conformado en "L" vertical** (curva 90° R200, templado interno con agua: bomba 1 HP, ~2 bar, 60 L/min) → contenedor.

## Ejecutar

```bash
cd simulador-conduit
npm install
npm run dev        # abre http://localhost:5173
```

Otros scripts: `npm run build` (typecheck + build de producción), `npm run build:single [salida.html]` (un único HTML
autocontenido para publicarlo como página web), `npm run preview`, `npm test` (Vitest: motor, secuencia,
enclavamientos, balance y un test de interfaz en jsdom).

### Abrirlo desde el navegador (computadora o celular)

| Opción | Comando | Dónde se abre |
|---|---|---|
| Local | `npm run dev` | `http://localhost:5173` en la misma computadora |
| Red local | `npm run dev:lan` | `http://<IP-de-la-compu>:5173` desde el celular en el mismo Wi-Fi |
| URL pública temporal | `npm run dev` y, en otra terminal, `npm run tunnel` | la URL `https://….loca.lt` que imprime localtunnel (la primera vez pide la IP pública de la compu como contraseña: https://loca.lt/mytunnelpassword) |
| Archivo único | `npm run build:single` | abrir `dist-single/index.html` con doble clic, sin servidor |

`NO_OPEN=1 npm run dev` evita que Vite intente abrir el navegador (útil en servidores sin escritorio).

## Qué incluye

**Modelo y estados** (`src/sim/`)
- `engine.ts`: motor con paso fijo de 0,1 s. Máquina de estados del operario
  (descarga → toma → carga en matriz → carga de caño frío → espera), de la estación de conformado (10 pasos) y del
  carrusel (indexado de 2 s). Modo manual con forzado de salidas y retorno automático a reposo.
- `sequence.ts`: la estación en L como lógica pura: pasos, cilindros (matriz, mordaza, mandril), finales de carrera,
  enclavamientos del PLC y fuerza de la mordaza.
- `physics.ts`: modelos térmicos de primer orden T(t) = T∞ + (T₀ − T∞)·e^(−t/τ):
  - batea de glicerina: la fracción sumergida de cada caño depende de su ángulo y del nivel del líquido. Las resistencias
    ocupan el fondo, así que el carrusel no queda al ras: el parámetro **«Vainas en la glicerina a la vez»** (pestaña C ·
    Mecánica, 6–8, nominal **7,5**) cuenta vainas equivalentes (una a medias en la superficie vale 0,5; 8 = nivel en el eje)
    y baja el nivel de la glicerina por debajo del eje. Con 7–8 vainas el ciclo sigue siendo el de la prensa (22,9 s); por
    debajo de ~7,3 el carrusel pasa a ser el cuello de botella (6,5 vainas → 25,4 s). Reinicia la simulación;
    sumergido τ = 75 s (a 2,5 mm, escala con el espesor), al aire τ = 5000 s;
    la glicerina tiene su propio balance (resistencias de 6 kW con control proporcional, calor cedido a los caños, pérdidas);
  - arrastre: cada caño retirado se lleva ~3 ml de glicerina que terminan en el agua de lavado (dilución en el tanque);
  - lavado interno: τ = 4,5 s @ 2,5 mm y 60 L/min, escalado con e² y h^−0,35 (h por Dittus-Boelter);
  - traslado al aire y contacto con la matriz;
  - tanque: acumula m·cp·ΔT de cada caño y pierde calor según el sistema elegido (ninguno / intercambiador / chiller).
- `balance.ts`: estaciones del carrusel y balance de línea analítico: ciclo operario + prensa, permanencia mínima
  por posición que exige el carrusel (se recorre la trayectoria real carga → retiro), cuello de botella, capacidad,
  takt, ocupación teórica, tiempos por tramo (aire previo / glicerina / giro al retiro) y glicerina arrastrada por día.

**Estación de conformado en "L" vertical** — matriz bipartida de dos zapatas mecanizadas con canaleta semicilíndrica
R20 (media caña del Ø40) a lo largo del tramo horizontal, la curva 90° R200 y la salida vertical: la zapata fija
(exterior de la curva) y la móvil (interior), que abre ~90 mm a 45° con su cilindro neumático. En la entrada, el
mecanizado ensanchado de la campana y, justo detrás, los dos insertos dentados de la mordaza integrados en las zapatas.
El abocardado se dibuja completo: cilindro neumático, vástago, cabezal portaconos, cono expansor a 10°, guía cilíndrica
de centrado y tobera de inyección frontal. Salida vertical abierta con vaso colector de rebalse Ø90 y manguera de
drenaje por gravedad al tanque. Secuencia (tiempos nominales, todos configurables):

| Paso | Acción | Nominal | Salidas / condición de avance |
|---|---|---|---|
| 1 | Cierre de matriz y curvado 90° + asentamiento | 1400 + 200 ms | Y1 · espera B1 |
| 2 | Bloqueo de mordaza de fricción Ø40 | 400 ms | Y2 · espera B2 |
| 3 | Avance y aproximación del mandril | 1000 ms | Y3 |
| 4 | Asiento del cono y sellado estanco | 300 ms | espera B3 |
| 5 | Templado: llenado de la L y rebalse libre | 7000 ms | Y4 (sólo con B3 y B2) |
| 6 | Corte de agua, soplado de purga y drenaje | 1000 ms (soplado 500 ms) | Y4 off, Y5 |
| 7 | Retroceso del mandril con pulso de desmoldeo | 800 ms | Y3 off, pulso Y5 · espera B4 |
| 8 | Liberación de la mordaza (siempre después del 7) | 300 ms | Y2 off (sólo con B4) · espera B5 |
| 9 | Apertura de la matriz | 1500 ms | Y1 off (con B4 y B5) · espera B6 |
| 10 | Extracción de la pieza y carga del nuevo caño (operario) | ~9000 ms | — |

Máquina (pasos 1–9) = 13,9 s; ciclo = paso 10 + máx(pasos 1–9, carga en frío) = **22,9 s** → ~1258 pz en 8 h.
Entradas B1 matriz cerrada · B2 mordaza trabada · B3 cono asentado · B4 cono atrás · B5 mordaza abierta · B6 matriz
abierta. Salidas Y1 matriz · Y2 mordaza · Y3 mandril · Y4 bomba · Y5 electroválvula de aire. Los enclavamientos se
aplican también a los forzados manuales: no hay agua sin cono asentado ni se abre la mordaza con el cono adentro.

**Estaciones del carrusel**: los caños bajan por la izquierda y suben por la derecha.
- **RETIRO**: primera posición completamente emergida del lado que sube (67,5° con 16 posiciones, 60° con 12, 72° con 10). El caño se
  toma apenas se descubre del baño: no hay arco aéreo, sólo los 2 s del giro (≈ 0,04 °C de pérdida).
- **CARGA FRÍO**: en el cenit (0°) o, opcionalmente, en la última posición al aire del lado que baja (292,5° con 16).
- Con 16 posiciones y el líquido al ras del eje quedan 8 caños bajo el baño (7 completos + 2 a medias en 90° y 270°).
  Las posiciones entre el retiro y la carga viajan vacías.
- El carrusel gira solo cuando el retiro está vacío (caño ya tomado) y la carga completa.

**Enclavamiento de temperatura**: una vez afuera el caño no gana temperatura, así que el PLC retiene el giro hasta
cumplir (1) la permanencia mínima por posición calculada por el balance y (2) que el caño en la última posición
sumergida —el que va a llegar al RETIRO— tenga la consigna de conformado. No hace falta sobretemperatura: con
consigna 120 °C el caño se retira a 120 °C.

**Panel de control**: templado (paso 5), temperatura inicial del tanque, tiempo de operario (paso 10), capacidad del
carrusel, velocidad (1×, 5×, 10×, 30×, 60× o paso a paso por evento), enclavamiento, inyección temporizada o por sensor,
estación de carga y arranque en frío. El botón **Retirar operario** simula que el operario deja el puesto.

**Parámetros y calibración** (panel lateral, botón ⚙): resumen en vivo de ciclo, capacidad y margen contra el takt, y
cuatro pestañas — A · duración de cada uno de los 10 pasos · B · glicerina, objetivo, τ, caudal, agua del tanque y
otros, con el pronóstico de temperatura del tanque y de apertura al final de la jornada · C · posiciones, estación de retiro automática o forzada, presión y diámetro de la mordaza (fuerza y margen de
retención estimados), operación · D · presets de un clic (Nominal 23 s, Conservador 26 s, Verano crítico, Arranque en
frío), restablecer a nominal y exportar / importar JSON. La configuración se guarda en `localStorage` y se recupera al
recargar; el JSON importado se valida (claves desconocidas ignoradas, valores recortados a su rango).

**Lógica PLC**: la secuencia con el paso activo y su avance, LEDs de entradas y salidas en tiempo real, modo manual
(sólo entre ciclos) con botones de forzado y registro del último bloqueo de seguridad.

**Dashboard**: vista 2D animada (carrusel con color por temperatura; estación en L con matriz que curva, mordaza que
cierra, mandril que clava el cono, agua que llena la L y rebalsa al vaso, soplado de purga y retroceso; tanque con nivel
térmico), diagrama hombre-máquina, curva de enfriamiento en la prensa, calentamiento vs. residencia,
producción acumulada vs. meta de 500 pz/día, tasa horaria real y ocupación del operario vs. esperas.

**Alarmas**
- scrap crítico: caño en el carrusel por encima de 135 °C;
- advertencia "Riesgo de reblandecimiento superficial": caño > 128 °C con la línea detenida más de 90 s sin indexar
  (con la glicerina a 132 °C, un caño detenido en el baño converge hacia esa temperatura);
- caño retirado del carrusel por debajo de 115 °C (insuficientemente blando → scrap);
- apertura de matriz (paso 9) con el caño por encima de **80 °C** → scrap (sin rigidez para manipularlo, se deforma);
  entre 70 y 80 °C la pieza es OK pero se cuenta un aviso preventivo (rótulo ámbar);
- bloqueo de seguridad del PLC (intento de activar una salida que viola un enclavamiento).

## Modo render / cámara CCTV

En la cabecera, el selector **Vista técnica / ● Modo render** cambia la vista de la celda (se recuerda entre visitas).
La vista técnica esquemática no cambia; el modo render es sólo una capa visual sobre el mismo estado del simulador:
no toca los cálculos termodinámicos ni la máquina de estados.

- **Materiales**: caño de PEAD cilíndrico con brillo especular (el color sigue saliendo de su temperatura), matriz
  bipartida y mordaza metálicas con bisel y sombra proyectada, cono y vástago cromados, agua azul translúcida con
  profundidad, burbujas y ondas en el vaso de rebalse Ø90 y vapor donde el caño caliente toca el agua.
- **Overlay de cámara**: `● REC` titilante + `CAM 01 - PRENSA L & CARRUSEL`, timecode `AAAA-MM-DD HH:MM:SS.mmm` y FPS,
  marcas de encuadre `[ + ]`, viñeteado, grano y aberración cromática muy leves y scanlines (activables con su interruptor).
  El timecode es hora de planta simulada anclada al reloj del navegador al abrir la página.
- **Reproducción**: Play/Pausa, velocidades 0.25× / 0.5× / 1× / 2× y línea de tiempo para recorrer el ciclo cuadro por
  cuadro (◀❘ ❘▶ = 0,1 s). El simulador guarda los últimos 120 s en un buffer circular de copias livianas del estado
  (sólo mientras el modo render está activo) y las interpola; al arrastrar la línea de tiempo se ve el pasado con la
  etiqueta `REPLAY`, y `● En vivo` vuelve al presente.
- **Grabar clip**: dibuja la cámara (SVG + overlay) en un canvas de 1280×800 y lo graba con `MediaRecorder` a `.webm`
  (hasta 12 s). Si el navegador no soporta `MediaRecorder`, guarda el cuadro actual como PNG. Algunos visores
  embebidos bloquean las descargas: en ese caso usá «Ver» y clic derecho → Guardar video como…
  (la aberración cromática es un filtro CSS de pantalla y no se incluye en el clip).

## Escenarios para probar

| Escenario | Cómo | Qué se ve |
|---|---|---|
| Régimen nominal | preset *Nominal* (16 pos., 132 °C, 120 °C, τ 75 s, tanque pasivo de 500 L) | retención 20,7 s/posición; cuello de botella = máquina + operario (22,9 s), ~157 pz/h, ~1258 pz/8 h; el agua sube de 22 a ~41 °C y la apertura de ~42 a ~57 °C: todas OK |
| Con chiller | *Enfriamiento del tanque: chiller* (opcional) | el agua se mantiene en ~24 °C y la apertura en ~44 °C |
| Templado corto | paso 5 en 3000 ms | apertura ~71 °C: OK con aviso preventivo; por debajo de ~2,3 s la apertura pasa 80 °C → scrap |
| Verano crítico | preset *Verano crítico* | agua a 32 °C y ambiente 35 °C: la apertura arranca en ~50 °C y llega a ~63 °C al final de la jornada → Curva OK |
| Conservador | preset *Conservador* | templado 9 s, ciclo 26 s, apertura ~38 °C |
| Enclavamientos | Panel PLC → *Modo manual* → forzar Y4 sin cono | el motor rechaza la orden y registra el bloqueo |
| Carrusel como cuello de botella | 12 posiciones | 27,6 s/posición, ~130 pz/h, retiro justo a 120 °C |
| Línea detenida | *Retirar operario* | tras 90 s sin indexar, los caños > 128 °C disparan la advertencia de reblandecimiento |
| Carga antes del baño | *Estación de carga: lado que baja* | mismo ritmo; menos caños en el carrusel |
| Ritmo fijo sin enclavamiento | desmarcar *Enclavamiento* con 10 posiciones | caños retirados por debajo de 115 °C, alarma de caño frío |
| Acumulación térmica | *Enfriamiento del tanque: ninguno*, 60× | el tanque sube durante la jornada |
| Arranque en frío | marcar *Arranque en frío* | transitorio de llenado del carrusel |
| Dilución del agua | correr la jornada a 60× | glicerina acumulada en el tanque (≈1,5 L a 500 pz) |

> Los coeficientes son orientativos (modelo de parámetros concentrados) y sirven para análisis de sensibilidad;
> conviene calibrarlos con mediciones de planta.
