"""Hoja 2: batea (cuba de glicerina) con resistencias, roscas y bastidor."""
import math

from dibujo import Hoja, Vista, fmt

# ---- datos del componente (mm) ----
R_EXT, ESP, LARGO = 323.0, 8.0, 900.0
R_INT = R_EXT - ESP
PEST = 30.0  # ancho del reborde plano hacia afuera
HEAT_D, HEAT_X = 55.0, 85.0
HEAT_Z = -(math.sqrt(R_INT**2 - HEAT_X**2)) + HEAT_D / 2 + 2.0  # eje de la resistencia bajo el borde (−273,8)
NIVEL = -32.0  # nivel de glicerina con 120 L, bajo el borde
HOLE_D = 57.0  # pasante de la resistencia en la tapa
RING_D, RING_E = 100.0, 12.0  # refuerzo anular soldado a la tapa
PCD_M8 = 80.0
DRAIN = (0.0, -293.0)  # media cupla G1 (x, z bajo el borde)
SENS = [(-170.0, -150.0), (170.0, -150.0)]  # medias cuplas G1/2 (tapa trasera)


def _perfil_frontal(v, con_drenaje, con_sensores):
    """Tapa vista de frente: contorno, resistencias, brida, roscas."""
    v.arc((0, 0), R_EXT, 180, 360)
    v.arc((0, 0), R_INT, 180, 360, "t")
    v.line((-R_EXT - PEST, 0), (R_EXT + PEST, 0))
    for sx in (-1, 1):
        v.poly([(sx * R_EXT, 0), (sx * (R_EXT + PEST), 0), (sx * (R_EXT + PEST), -ESP), (sx * R_EXT, -ESP)], "v", True)
    v.line((-R_INT + 1.5, NIVEL), (R_INT - 1.5, NIVEL), "c")
    v.text(R_INT * 0.28, NIVEL + 4, "nivel glicerina (120 L)", 2.4)
    for sx in (-1, 1):
        cx, cz = sx * HEAT_X, HEAT_Z
        v.circle((cx, cz), RING_D / 2, "v")
        v.circle((cx, cz), HOLE_D / 2, "v")
        v.circle((cx, cz), HEAT_D / 2, "h")
        v.circle((cx, cz), PCD_M8 / 2, "c")
        for k in range(4):
            a = math.radians(45 + 90 * k)
            px, pz = cx + PCD_M8 / 2 * math.cos(a), cz + PCD_M8 / 2 * math.sin(a)
            v.circle((px, pz), 3.4, "v")
            v.arc((px, pz), 4.0, 20, 290, "t")
        v.centro((cx, cz), RING_D / 2, 4)
    if con_drenaje:
        v.circle(DRAIN, 25.0, "v")
        v.circle(DRAIN, 15.15, "v")
        v.arc(DRAIN, 16.6, 20, 290, "t")
        v.centro(DRAIN, 25.0, 4)
    if con_sensores:
        for sx, sz in SENS:
            v.circle((sx, sz), 17.0, "v")
            v.circle((sx, sz), 9.3, "v")
            v.arc((sx, sz), 10.6, 20, 290, "t")
            v.centro((sx, sz), 17.0, 4)



NOTAS = [
    "1. Chapa de acero inoxidable AISI 304, e = 8 mm (alternativa SAE 1020 con pintura epoxi para 150 °C: VERIFICAR con el proveedor).",
    "2. Soldadura TIG continua y estanca en todo el contorno; sin salpicaduras ni rebabas. Ensayo de estanqueidad con agua, 24 h.",
    "3. Roscas gas cilíndricas BSPP (ISO 228). Medias cuplas soldadas por dentro y por fuera. Tapón con junta de cobre o grafito.",
    "4. Resistencias Ø55 tipo inmersión, junta de grafito entre brida y tapa; potencia a definir con el proveedor (~6 kW, VERIFICAR).",
    "5. Cotas marcadas con (*) son propuestas de diseño: confirmar antes de cortar chapa.",
]


def _ext(v, x0, x1, z):
    v.line((x0, z), (x1, z), "t")


def hoja_batea_vistas(n, total):
    h = Hoja()
    h.marco("BATEA DE GLICERINA (1/2)", "Planta y vistas de tapas — cuba R323 × 900", n, total, "1:5", "AISI 304 e=8 (*)", NOTAS)

    # ---------------- planta ----------------
    pv = Vista(h, 100, 185, 0.2)
    pv.titulo(-353, 440, "PLANTA")
    pv.rect(-R_EXT - PEST, -LARGO / 2, R_EXT + PEST, LARGO / 2)
    pv.line((-R_EXT, -LARGO / 2), (-R_EXT, LARGO / 2), "v")
    pv.line((R_EXT, -LARGO / 2), (R_EXT, LARGO / 2), "v")
    pv.line((-R_INT, -LARGO / 2 + ESP), (-R_INT, LARGO / 2 - ESP), "h")
    pv.line((R_INT, -LARGO / 2 + ESP), (R_INT, LARGO / 2 - ESP), "h")
    for sy in (-1, 1):
        pv.line((-R_EXT - PEST, sy * (LARGO / 2 - ESP)), (R_EXT + PEST, sy * (LARGO / 2 - ESP)), "h")
    for sx in (-1, 1):
        x = sx * HEAT_X
        pv.rect(x - HEAT_D / 2, -LARGO / 2 - 20, x + HEAT_D / 2, LARGO / 2 + 20, "h")
    pv.line((0, -LARGO / 2 - 40), (0, LARGO / 2 + 40), "c")
    pv.dim_h(-R_EXT - PEST, R_EXT + PEST, -LARGO / 2, -8, "706 (*)")
    pv.dim_h(-R_EXT, R_EXT, -LARGO / 2, -16, "646")
    pv.dim_v(-LARGO / 2, LARGO / 2, R_EXT + PEST, 8, "900")
    pv.dim_h(-HEAT_X, HEAT_X, LARGO / 2 + 20, 4, "170")
    pv.llamada(R_EXT + PEST / 2, 300, "reborde plano e=8\nancho 30 (*)", 12, 10)
    pv.llamada(HEAT_X, 200, "2 resistencias Ø55\n(ver corte A-A, hoja 3)", -34, 16)

    # ---------------- vista frontal (tapa delantera) ----------------
    fv = Vista(h, 300, 268, 0.2)
    fv.titulo(-353, 28, "VISTA FRONTAL (tapa delantera)")
    _perfil_frontal(fv, True, False)
    fv.radio((0, 0), R_EXT, 225, "R323")
    xr = R_EXT + PEST
    _ext(fv, HEAT_X + RING_D / 2, xr, HEAT_Z)
    _ext(fv, 0, xr, DRAIN[1])
    fv.dim_v(0, HEAT_Z, xr, 8, "273,8")
    fv.dim_v(0, DRAIN[1], xr, 17, "293")
    fv.dim_h(-HEAT_X, HEAT_X, HEAT_Z - RING_D / 2, -4, "170")
    fv.llamada(HEAT_X + 20, HEAT_Z - 30, "4×M8 pasantes (brida)\nPCD 80 · Ø57 pasante", 28, -4)
    fv.llamada(0, DRAIN[1] - 25, "media cupla G1 (BSPP)\ntapón de descarga", -14, -4)

    # ---------------- vista posterior (tapa trasera) ----------------
    bv = Vista(h, 300, 175, 0.2)
    bv.titulo(-353, 28, "VISTA POSTERIOR (tapa trasera)")
    _perfil_frontal(bv, False, True)
    xl = -R_EXT - PEST
    _ext(bv, xl, SENS[0][0] - 17, SENS[0][1])
    _ext(bv, xl, 0, 0)
    bv.dim_v(0, SENS[0][1], xl, -8, "150")
    bv.dim_h(SENS[0][0], SENS[1][0], SENS[0][1], 6, "340")
    bv.llamada(SENS[1][0], SENS[1][1], "2× G1/2 (BSPP): termocupla\nde control / termostato", 14, 10)
    return h


def hoja_batea_detalles(n, total):
    h = Hoja()
    h.marco("BATEA DE GLICERINA (2/2)", "Corte A-A y detalles de resistencia, drenaje y cuna", n, total, "1:5 (det. A 1:2, B 1:1)", "AISI 304 e=8 (*)")

    # ---------------- corte A-A (plano de una resistencia, x = 85) ----------------
    cv = Vista(h, 215, 262, 0.2)
    h.text((24, 276), "CORTE A-A (x = 85, eje de resistencia)", 3.4)
    ext_z = -math.sqrt(R_EXT**2 - HEAT_X**2)
    int_z = -math.sqrt(R_INT**2 - HEAT_X**2)
    L2 = LARGO / 2
    cv.fill([(-L2, 0), (-L2 + ESP, 0), (-L2 + ESP, ext_z), (-L2, ext_z)])
    cv.fill([(L2 - ESP, 0), (L2, 0), (L2, ext_z), (L2 - ESP, ext_z)])
    cv.fill([(-L2 + ESP, int_z), (L2 - ESP, int_z), (L2 - ESP, int_z - ESP), (-L2 + ESP, int_z - ESP)])
    cv.line((-L2, 0), (L2, 0))
    cv.line((-L2 + 2, NIVEL), (L2 - 2, NIVEL), "c")
    cv.text(-L2 + 14, NIVEL + 6, "nivel glicerina", 2.4)
    zc = HEAT_Z
    cv.rect(-L2 - 40, zc - HEAT_D / 2, L2 + 40, zc + HEAT_D / 2, "v")
    cv.rect(L2 + 40, zc - 16, L2 + 70, zc + 16, "v")
    cv.rect(-L2 - 70, zc - 16, -L2 - 40, zc + 16, "v")
    cv.line((-L2 - 80, zc), (L2 + 80, zc), "c")
    for sy in (-1, 1):
        y0, y1 = sy * L2, sy * (L2 + RING_E)
        cv.rect(min(y0, y1), zc - RING_D / 2, max(y0, y1), zc - HOLE_D / 2, "v")
        cv.rect(min(y0, y1), zc + HOLE_D / 2, max(y0, y1), zc + RING_D / 2, "v")
    cv.dim_h(-L2, L2, 0, 6, "900")
    cv.dim_h(-L2 + ESP, L2 - ESP, 0, 13, "884 (int.)")
    cv.dim_h(-L2 - 70, L2 + 70, zc - RING_D / 2, -6, "resistencia ≈ 1040 con bornes (*)")
    cv.dim_v(0, zc, L2 + 70, 8, "273,8")
    cv.dim_h(L2, L2 + RING_E, zc + RING_D / 2, 4, "12")
    cv.llamada(-L2 + ESP / 2, -150, "tapa e=8", -6, 8)
    cv.llamada(-L2 - 6, zc + 40, "anillo e=12 (ver det. A)", -4, 14)

    # ---------------- detalle A: brida de resistencia (1:2) ----------------
    dv = Vista(h, 70, 150, 0.5)
    h.text((24, 192), "DETALLE A — brida de resistencia (1:2)", 3.2)
    dv.circle((0, 0), RING_D / 2)
    dv.circle((0, 0), HOLE_D / 2)
    dv.circle((0, 0), PCD_M8 / 2, "c")
    for k in range(4):
        a = math.radians(45 + 90 * k)
        px, pz = PCD_M8 / 2 * math.cos(a), PCD_M8 / 2 * math.sin(a)
        dv.circle((px, pz), 3.4)
        dv.arc((px, pz), 4.0, 20, 290, "t")
    dv.centro((0, 0), RING_D / 2, 4)
    dv.dim_h(-RING_D / 2, RING_D / 2, -RING_D / 2, -6, "Ø100")
    dv.dim_v(-HOLE_D / 2, HOLE_D / 2, RING_D / 2, 8, "Ø57")
    dv.llamada(PCD_M8 / 2 * math.cos(math.radians(45)), PCD_M8 / 2 * math.sin(math.radians(45)), "4×M8 · PCD 80\n(pasante Ø6,8)", 6, 14)

    # ---------------- detalle B: media cupla G1 y tapón (1:1) ----------------
    ev = Vista(h, 145, 140, 1.0)
    h.text((118, 96), "DETALLE B — media cupla G1 y tapón (1:1)", 3.2)
    ev.rect(0, -25, 25, 25)
    ev.line((0, -15.15), (25, -15.15), "v")
    ev.line((0, 15.15), (25, 15.15), "v")
    ev.line((0, -16.6), (25, -16.6), "t")
    ev.line((0, 16.6), (25, 16.6), "t")
    ev.line((-12, 0), (75, 0), "c")
    ev.rect(-8, -25, 0, 25, "t")
    ev.text(-9, 28, "tapa e=8", 2.4)
    ev.rect(30, -18, 55, 18, "v")
    ev.poly([(55, -18), (55, 18), (66, 18), (66, -18)], "v", True)
    ev.line((55, 0), (66, 0), "t")
    ev.rect(25, -17, 30, 17, "t")
    ev.dim_v(-25, 25, 0, -8, "Ø50")
    ev.dim_v(-15.15, 15.15, 25, 8, "Ø30,3")
    ev.dim_h(0, 25, -25, -6, "25")
    ev.llamada(15, 25, "G1 BSPP (ISO 228)\nmedia cupla", 4, 12)
    ev.llamada(66, -10, "tapón G1, hex 36\njunta Cu 33×39×2", 8, -14)

    # ---------------- detalle C: cuna de apoyo (1:5) ----------------
    gv = Vista(h, 300, 235, 0.2)
    h.text((262, 186), "DETALLE C — cuna de apoyo (2 u, *)", 3.2)
    pts = [(x, -math.sqrt(R_EXT**2 - x**2)) for x in range(-70, 71, 10)]
    gv.poly(pts + [(70, -550), (-70, -550)], "v", True)
    gv.dim_h(-70, 70, -550, -6, "140")
    gv.dim_v(-550, pts[0][1], 70, 8, "≈237")
    gv.llamada(0, -330, "chapa e=8, perfil R323", -10, -8)

    # ---------------- tabla de roscas ----------------
    tx, ty = 24, 78
    h.text((tx, ty), "TABLA DE AGUJEROS Y ROSCAS", 3.0)
    filas = [
        "A  2 × Ø57 pasante + 4×M8 c/u — tapas delantera y trasera, x = ±85, z = −273,8 (eje bajo el borde)",
        "B  1 × G1 (BSPP) media cupla — tapa delantera, x = 0, z = −293 — descarga con tapón roscado",
        "C  2 × G1/2 (BSPP) medias cuplas — tapa trasera, x = ±170, z = −150 — sensores / termostato",
    ]
    for i, f in enumerate(filas):
        h.text((tx, ty - 5.0 * (i + 1)), f, 2.6)
    return h
