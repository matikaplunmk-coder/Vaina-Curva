"""Hojas 1 (conjunto), 4 (carrusel), 5 (mesa) y 6 (tanque de agua)."""
import math

from dibujo import Hoja, Vista

# ---------------- datos compartidos con el modelo 3D (mm) ----------------
MOUNT_R, HUB_D, HUB_T = 270.0, 140.0, 16.0
SHAFT_D, SHAFT_LEN = 40.0, 1300.0
PLATE_Y, BEAR_Y = 380.0, 530.0
AXIS_Z = 953.0  # eje sobre el piso (borde de batea a 850 + 103)
TILT = 3.0
TABLE = (2350.0, 1000.0)
Z_TOP = 850.0
TANK = (800.0, 800.0, 780.0)
NHOLES = 102


def hoja_conjunto(n, total):
    h = Hoja()
    h.marco("CONJUNTO — DISPOSICIÓN GENERAL", "Batea + carrusel, mesa de conformado, tanque de agua y bomba (planta)", n, total, "1:20", "ver lista de piezas",
            ["1. Origen: eje del carrusel (x = 0, y = 0); eje del carrusel paralelo a Y; borde de la batea y tablero de la mesa a z = 850 mm sobre el piso.",
             "2. Carrusel con 3° de inclinación (lado delantero −Y más bajo, drena hacia el frente). Cargas y descargas por delante.",
             "3. Posiciones de bomba, canasto y banco según el modelo 3D; ajustar al layout real de la planta."])
    v = Vista(h, 92, 215, 0.05)  # 1:20, origen del modelo en (60, 205) del papel; x real en mm
    # batea
    v.rect(-353, -450, 353, 450)
    v.line((-323, -450), (-323, 450), "t")
    v.line((323, -450), (323, 450), "t")
    v.line((0, -520), (0, 520), "c")
    # mesa
    v.rect(500, -300, 2850, 700)
    # tanque (bajo la mesa, oculto)
    v.rect(1100, 100, 1900, 900, "h")
    # trayectoria del caño y bajada
    v.line((1980, 0), (1680, 0), "c")
    v.line((1480, 200), (1480, 496), "c")
    pts = [(1680 - 200 * math.sin(math.radians(a)), 200 - 200 * math.cos(math.radians(a))) for a in range(0, 91, 6)]
    for a, b in zip(pts, pts[1:]):
        v.line(a, b, "c")
    v.circle((1480, 496), 30, "v")
    # bomba bajo mesa (oculta) y caños
    v.rect(2200, 300, 2720, 520, "h")
    # armario PLC, canasto A, banco, canasto B, rack
    v.rect(300, -900, 900, -400)
    v.text(330, -640, "ARMARIO PLC", 2.6)
    v.rect(1850, -1550, 2450, -1050)
    v.text(1880, -1320, "CANASTO A", 2.6)
    v.rect(3100, -1300, 3700, -700)
    v.text(3180, -1000, "BANCO DE ATADO", 2.6)
    v.rect(3100, -2200, 3700, -1600)
    v.text(3180, -1900, "CANASTO B", 2.6)
    v.rect(-1200, -600, -600, 0)
    v.text(-1160, -300, "RACK", 2.6)
    v.text(-250, 40, "BATEA", 2.8)
    v.text(600, 560, "MESA", 3.0)
    v.text(600, 440, "(tanque 500 L debajo, bajada del codo en x = 1480)", 2.4)
    v.text(2300, 200, "bomba", 2.4)
    v.dim_h(-353, 353, 450, 6, "706")
    bx, by = 262, 270
    h.text((bx, by), "LISTA DE PIEZAS", 3.2)
    for i, t in enumerate(["1  Batea de glicerina R323×900 + 2 resistencias Ø55 ...... hojas 2-3",
                           "2  Carrusel: eje Ø40×1300, 2 platos, 12 aros ......... hoja 4",
                           "3  Pedestales UCP208 (2 u) ........................ hoja 4",
                           "4  Mesa de conformado 2350×1000 .................. hoja 5",
                           "5  Tanque de agua 500 L ......................... hoja 6",
                           "6  Matrices, pistones, mandril, bomba, PLC: no incluidos (a definir)"]):
        h.text((bx, by - 5.5 * (i + 1)), t, 2.5)
    v.dim_h(500, 2850, 700, 6, "2350")
    v.dim_v(-300, 700, 2850, 8, "1000")
    return h


def hoja_carrusel(n, total):
    h = Hoja()
    h.marco("CARRUSEL — EJE, PLATOS Y APOYOS", "Eje Ø40 × 1300, 2 platos de 12 posiciones y 2 pedestales UCP208", n, total, "1:4 (platos) · 1:8 (conjunto)",
            "Eje SAE 1045 · platos AISI 304 e=10 (*)",
            ["1. Eje Ø40 h6 en asientos de rodamiento (h7 de la caja UCP208), rectificado Ra 1,6; chavetas 12×8 JS9 en los dos cubos.",
             "2. Platos de chapa e=10 (*): cubo Ø140 e=16, 12 rayos de planchuela 26×10, aro R270 (varilla Ø10) y 12 aros de retención de la vaina Ø40 + 1,5 (*).",
             "3. Pedestales con plano inclinado 3°: lado delantero (−Y) más bajo ≈ 55 mm que el trasero. VERIFICAR con el proyecto antes de cortar.",
             "4. Accionamiento (motorreductor, ~1 rpm / giro continuo) no incluido: definir con el proveedor y agregar chaveta/acople en el extremo trasero."])
    # ---- plato (vista axial) 1:4 ----
    pv = Vista(h, 110, 205, 0.25)
    h.text((24, 282), "PLATO — vista axial (1:4)", 3.4)
    R_RING = MOUNT_R
    pv.circle((0, 0), HUB_D / 2)
    pv.circle((0, 0), SHAFT_D / 2)
    pv.line((-6 + -R_RING - 40, 0), (R_RING + 40, 0), "c")
    pv.line((0, -R_RING - 40), (0, R_RING + 40), "c")
    pv.circle((0, 0), R_RING, "c")
    pv.circle((0, 0), R_RING + 5, "v")
    pv.circle((0, 0), R_RING - 5, "v")
    for k in range(12):
        a = math.radians(30 * k)
        ca, sa = math.cos(a), math.sin(a)
        # rayo: planchuela 26 de ancho de R70 a R248
        nx, ny = -sa * 13, ca * 13
        p = lambda r, s: (ca * r + nx * s, sa * r + ny * s)
        pv.poly([p(70, 1), p(248, 1), p(248, -1), p(70, -1)], "v", True)
        cx, cy = ca * R_RING, sa * R_RING
        pv.circle((cx, cy), 20)
        pv.circle((cx, cy), 26.5)
    pv.arc((0, 0), R_RING + 33, 20, 70, "t")
    pv.radio((0, 0), R_RING, 135, "R270 (aro de apoyo)")
    pv.dim_h(-R_RING, R_RING, -R_RING - 40, -6, "Ø540 (circunferencia de 12 posiciones)")
    pv.llamada(R_RING * math.cos(math.radians(30)), R_RING * math.sin(math.radians(30)), "12× aro Ø40+1,5 pasante\npaso 30°", 20, 16)

    # ---- conjunto lateral 1:8 ----
    cv = Vista(h, 305, 70, 0.125)
    h.text((236, 276), "CONJUNTO LATERAL (1:8) — inclinación 3° no representada", 3.2)
    # piso
    cv.line((-720, 0), (720, 0), "c")
    # eje (Ø40 × 1300) a z=953
    z0 = AXIS_Z
    cv.rect(-SHAFT_LEN / 2, z0 - 20, SHAFT_LEN / 2, z0 + 20)
    # platos y cubos
    for sy in (-1, 1):
        y = sy * PLATE_Y
        cv.rect(y - HUB_T / 2, z0 - HUB_D / 2, y + HUB_T / 2, z0 + HUB_D / 2)
        cv.line((y, z0 - MOUNT_R - 26), (y, z0 + MOUNT_R + 26), "v")
    # vaina (Ø40) de ejemplo entre platos, a R270
    cv.rect(-430, z0 + MOUNT_R - 20, 430, z0 + MOUNT_R + 20, "h")
    # pedestales UCP208
    for sy in (-1, 1):
        y = sy * BEAR_Y
        zc = z0 + sy * 27.7
        cv.rect(y - 25, zc - 62, y + 25, zc + 62)
        cv.circle((y, zc), 0.1, "t")
        cv.rect(y - 35, 0, y + 35, 18)
        cv.rect(y - 25, 18, y + 25, zc - 62)
    cv.dim_h(-SHAFT_LEN / 2, SHAFT_LEN / 2, z0 + 20, 70, "1300")
    cv.dim_h(-PLATE_Y, PLATE_Y, z0 - HUB_D / 2, -14, "760 (entre platos)")
    cv.dim_h(-BEAR_Y, BEAR_Y, 18, -8, "1060 (entre apoyos)")
    cv.dim_v(0, z0, SHAFT_LEN / 2 + 30, 6, "953 (eje s/piso)")
    cv.llamada(-BEAR_Y, z0 - 62, "UCP208 (Ø40)\n2× M16 a piso", -4, -24)
    cv.llamada(-PLATE_Y, z0 + MOUNT_R + 26, "plato e=10 (12 pos.)", -4, 10)

    # ---- cubo y chavetero ampliado 1:2 ----
    kv = Vista(h, 60, 76, 0.4)
    h.text((24, 108), "DETALLE — CUBO (1:2,5): Ø40 H7, chavetero 12×8, 2× M8 prisionero a 90°", 2.8)
    kv.circle((0, 0), HUB_D / 2)
    kv.circle((0, 0), SHAFT_D / 2 + 0.0)
    kv.rect(-6, SHAFT_D / 2 - 1, 6, SHAFT_D / 2 + 8, "v")
    kv.line((-HUB_D / 2 - 8, 0), (HUB_D / 2 + 8, 0), "c")
    kv.line((0, -HUB_D / 2 - 8), (0, HUB_D / 2 + 8), "c")
    kv.dim_h(-HUB_D / 2, HUB_D / 2, -HUB_D / 2, -6, "Ø140")
    kv.llamada(0, SHAFT_D / 2 + 8, "chavetero 12 JS9 × t2 3,3", 14, 8)
    kv.llamada(SHAFT_D / 2, 0, "Ø40 H7", 8, -16)
    return h


def hoja_mesa(n, total):
    h = Hoja()
    h.marco("MESA DE CONFORMADO", "Tablero 2350 × 1000 con retícula M10, orificio de desagote y bastidor", n, total, "1:10", "Chapa AISI 304 e=10 (*) · tubo 50×50×3 / 40×40×3 (*)",
            ["1. Tablero: chapa e=10 (*) (3D muestra 20 mm: VERIFICAR contra el SolidWorks del usuario). Plano, planitud 0,5 mm/m. Aristas rotas.",
             "2. Retícula de agujeros roscados M10 (agujero de macho Ø8,5 prof. 18) paso 100 × 100, para fijar matrices, pistones y soportes de mandril.",
             "3. Agujero Ø120 para la bajada del codo hacia el tanque (en el 3D es una ranura de 120×280): ubicado en la vertical del codo.",
             "4. Bastidor: 6 patas 50×50×3 y travesaños 40×40×3, soldados; pies regulables M16. Altura del plano de la mesa: 850 mm sobre el piso.",
             "5. Las matrices (semimatriz fija/móvil, mordaza) y los pistones se detallan por separado; la posición exacta de sus agujeros es PROPUESTA."])
    W, D = TABLE
    ox, oy, s = 40, 165, 0.1
    pv = Vista(h, ox, oy, s)
    h.text((24, 160), "PLANTA (1:10)  ·  origen: esquina delantera izquierda, y = 0 en el frente (lado del operario)", 3.0)
    pv.rect(0, 0, W, D)
    # patas (ocultas)
    for lx, ly in ((50, 50), (50, 950), (2300, 50), (2300, 950), (1550, 50), (1550, 950)):
        pv.rect(lx - 25, ly - 25, lx + 25, ly + 25, "h")
    # eje del caño (trayectoria): origen mesa u = X-500, v = Y+300
    pts = [(1480 - 0 - 0, 300)]
    pv.line((1480, 300), (1180, 300), "c")
    arc = [(1180 - 200 * math.sin(math.radians(a)), 300 + 200 - 200 * math.cos(math.radians(a)) - 0) for a in range(0, 91, 6)]
    for a, b in zip(arc, arc[1:]):
        pv.line(a, b, "c")
    pv.line((980, 500), (980, 746), "c")
    pv.text(1500, 280, "eje del caño Ø40 (curva R200)", 2.4)
    # orificio de desagote Ø120 en (980, 796)
    pv.circle((980, 796), 60)
    pv.centro((980, 796), 60, 3)
    # retícula M10 paso 100
    holes = []
    for i in range(7, 20):
        for j in range(1, 9):
            u, v = i * 100.0, j * 100.0
            if math.hypot(u - 980, v - 796) < 95:
                continue
            holes.append((u, v))
            pv.circle((u, v), 4.25, "t")
    pv.dim_h(0, W, D, 6, "2350")
    pv.dim_v(0, D, W, 6, "1000")
    pv.dim_h(0, 700, 0, -6, "700")
    pv.dim_h(700, 1900, 0, -6, "retícula M10: 12 × 100 = 1200")
    global NHOLES
    NHOLES = len(holes)
    pv.dim_v(0, 100, 700, -10, "100")
    pv.dim_v(100, 800, 1900, 6, "7 × 100 = 700")
    pv.dim_v(0, 796, 980, 14, "796")
    pv.dim_h(0, 980, 796, 7, "980")
    pv.llamada(980, 796 + 60, "Ø120 pasante\n(bajada del codo)", 12, 6)
    pv.llamada(1900, 800, f"{len(holes)} × M10\n(macho Ø8,5 × 18)", 8, 8)
    # ---- elevación ----
    ev = Vista(h, 285, 150, 0.05)
    h.text((285, 212), "ELEVACIÓN FRONTAL (1:20)", 3.0)
    ev.line((-100, 0), (W + 100, 0), "c")
    ev.rect(0, 840, W, 850)  # chapa e=10
    for lx in (50, 1550, 2300):
        ev.rect(lx - 25, 0, lx + 25, 840)
        ev.rect(lx - 25, 800, lx + 25, 840, "t")
    ev.rect(0, 800, W, 840, "h")
    ev.dim_v(0, 850, W, 6, "850")
    ev.dim_h(0, W, 850, 5, "2350")
    ev.dim_h(50, 1550, 0, -6, "1500")
    ev.dim_h(1550, 2300, 0, -6, "750")
    ev.llamada(1000, 845, "chapa e=10 (*)", 4, 14)
    ev.llamada(1550, 400, "pata 50×50×3 (6 u)", 8, 8)

    # ---- lista de agujeros y piezas ----
    tx, ty = 292, 262
    h.text((tx, ty), "TABLA DE AGUJEROS Y ROSCAS", 3.0)
    for i, t in enumerate([f"R  {NHOLES} × M10, macho Ø8,5 × 18 — retícula 13 × 8, paso 100×100",
                           "    (u = 700…1900, v = 100…800; sin los que interfieren con D)",
                           "D  1 × Ø120 pasante — (u = 980, v = 796)",
                           "P  6 × Ø18 pasante en travesaños para anclaje (ver bastidor)"]):
        h.text((tx, ty - 5.0 * (i + 1)), t, 2.5)
    return h


def hoja_tanque(n, total):
    h = Hoja()
    h.marco("TANQUE DE AGUA 500 L", "Tanque rectangular 800 × 800 × 780 — recibe el desagote del abocardado y alimenta la bomba", n, total, "1:5", "AISI 304 e=3 soldado (*) o PE rotomoldeado",
            ["1. Capacidad útil ≈ 500 L (800 × 800 × 780). Si se compra PE rotomoldeado, ajustar roscas a las del fabricante: VERIFICAR.",
             "2. Roscas gas cilíndricas BSPP (ISO 228); medias cuplas soldadas (acero) o insertos termosoldados (PE).",
             "3. Tapa atornillada con 12×M8 y junta; boca Ø120 bajo la bajada del codo (embudo Ø50→Ø120 sobre la tapa).",
             "4. Cordones de refuerzo a 257 y 515 mm de altura. Cotas con (*) son propuestas."])
    A, B, Hh = TANK
    # ---- planta ----
    pv = Vista(h, 95, 215, 0.13)
    h.text((24, 282), "PLANTA (tapa) 1:7,7", 3.4)
    pv.rect(-A / 2, -B / 2, A / 2, B / 2)
    pv.rect(-A / 2 - 15, -B / 2 - 15, A / 2 + 15, B / 2 + 15, "t")
    pv.circle((-20, -4), 60)
    pv.circle((-20, -4), 25, "h")
    pv.centro((-20, -4), 60, 3)
    for k in range(12):  # 12 × M8 en la tapa (4 por lado, esquinas excluidas)
        pass
    pts = [(x, y) for x in (-300, -100, 100, 300) for y in (-370, 370)] + [(x, y) for y in (-100, 100) for x in (-370, 370)]
    for x, y in pts:
        pv.circle((x, y), 4.0, "t")
    pv.dim_h(-A / 2, A / 2, -B / 2, -8, "800")
    pv.dim_v(-B / 2, B / 2, A / 2, 8, "800")
    pv.llamada(-20, -4 + 60, "boca Ø120 (bajada del codo)", -6, 22)
    pv.llamada(300, 370, "12× M8 (tapa)", 10, 8)
    # ---- elevación lateral derecha (pared de bomba) ----
    ev = Vista(h, 300, 80, 0.2)
    h.text((226, 262), "ALZADO 1:5 (pared derecha: aspiración, descarga, rebose)", 3.2)
    ev.rect(-B / 2, 0, B / 2, Hh)
    ev.rect(-B / 2 - 15, Hh, B / 2 + 15, Hh + 30, "v")
    for z in (257, 515):
        ev.rect(-B / 2 - 6, z - 12, B / 2 + 6, z + 12, "t")
    # accesorios: aspiración a z=140 (y=-100 respecto del centro, local)
    ev.circle((-100, 140), 26)
    ev.circle((-100, 140), 20.5, "v")
    ev.centro((-100, 140), 26, 2)
    ev.circle((0, 25), 20, "v")
    ev.circle((0, 25), 15.15, "v")
    ev.centro((0, 25), 20, 2)
    ev.circle((250, 700), 26)
    ev.circle((250, 700), 20.5, "v")
    ev.dim_h(-B / 2, B / 2, 0, -8, "800")
    ev.dim_v(0, Hh, B / 2, 12, "780")
    ev.dim_v(0, 140, -B / 2, -8, "140")
    ev.dim_v(0, 700, -B / 2, -16, "700")
    ev.llamada(-100, 140, "G1-1/2 (BSPP) aspiración\na la bomba", -6, 28)
    ev.llamada(0, 25, "G1 (BSPP) descarga\ncon tapón roscado", 14, -22)
    ev.llamada(250, 700, "G1-1/2 (BSPP) rebose", 10, 12)
    ev.llamada(0, 257, "cordón de refuerzo", -30, -4)
    ev.llamada(0, 515, "cordón de refuerzo", 30, 4)

    # ---- tabla de roscas ----
    tx, ty = 24, 78
    h.text((tx, ty), "TABLA DE AGUJEROS Y ROSCAS", 3.0)
    for i, t in enumerate(["A  1 × Ø120 pasante en tapa — (x = −20, y = −4) respecto del centro",
                           "B  12 × M8 en tapa — junta de goma, perímetro",
                           "C  1 × G1-1/2 BSPP — pared derecha, z = 140, y = −100 (aspiración a la bomba)",
                           "D  1 × G1 BSPP — pared derecha, z = 25 (descarga) + tapón roscado G1, hex 36",
                           "E  1 × G1-1/2 BSPP — pared derecha, z = 700, y = +250 (rebose)"]):
        h.text((tx, ty - 5.0 * (i + 1)), t, 2.5)
    return h
