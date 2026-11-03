#!/usr/bin/env python3
"""
generar_celda_realista_3d.py — Celda de conformado de curvas conduit PEAD Ø40 en 3D (Blender 4.x).

Versión "planta real" de la simulación web: se genera TODO por código (sin CAD ni assets externos).

  · Batea de glicerina a 120 °C con 2 resistencias Ø55 mm en el fondo. Las resistencias obligan a subir el
    carrusel: el eje queda por ENCIMA de la glicerina y sólo ~4 vainas (equivalentes) están sumergidas.
  · Carrusel de 12 posiciones (30°) con avance AUTOMÁTICO y una pequeña inclinación para que la glicerina
    drene al sacar la vaina. Cada vaina (pared 3,5 mm) permanece 100 s en el baño y sale a ~110 °C: la
    constante de tiempo y el intervalo de indexado se calculan para que eso se cumpla.
  · Estación de conformado en L, mandril abocardador, tanque de 500 L con electrobomba, cañerías.
  · Operario animado: saca la vaina del carrusel, la coloca en la matriz, acciona el PLC (cilindros
    neumáticos y bomba), carga un caño frío en el carrusel, retira la pieza y la deja en un canasto.
  · Cada 10 piezas: pausa de la línea, atado del paquete de 10 y reserva en otro canasto.
  · Cámara con zoom en cada operación, y al final una vista cenital y una perspectiva orbital.

Uso (con la interfaz de Blender abierta, o desde la terminal):

    blender --python generar_celda_realista_3d.py
    blender --background --python generar_celda_realista_3d.py -- --pieces 3 --save prueba.blend

Argumentos (después de `--`):
    --pieces N        piezas a animar (por defecto 12: incluye un paquete de 10)
    --step N          cada cuántos cuadros se muestrea la animación del operario (por defecto 3)
    --save RUTA.blend guarda la escena (por defecto celda_realista_3d.blend junto al script)
    --no-save         no guarda

Convenciones: 1 unidad = 1 m (cotas en mm pasadas por `mm()`); Z arriba; piso en z = 0.
El carrusel está en el origen con su eje a lo largo de Y; la estación en L a la derecha (+X).
"""
import argparse
import bisect
import math
import os
import sys
from math import cos, exp, pi, radians, sin, sqrt

import bpy
import bmesh  # noqa: E402  (debe importarse después de bpy)
from mathutils import Euler, Matrix, Vector

# ============================================================================================
# CONFIG
# ============================================================================================
MM = 0.001


def mm(v):
    """Milímetros → metros."""
    return v * MM


FPS = 30
N_PIECES = 12  # piezas a animar
PACK_EVERY = 10  # piezas por paquete atado
SAMPLE_STEP = 3  # cuadros entre muestras de la animación del operario

# --- Batea y glicerina ---
BATH_R, BATH_L, BATH_WALL = 323.0, 900.0, 8.0  # mm
BATH_LITERS = 120.0  # el nivel sale del volumen
BATH_TEMP = 120.0  # °C
HEATER_D = 55.0  # mm, resistencias blindadas (2)
HEATER_X = 85.0  # mm, separación lateral de cada una respecto del centro
Z_RIM = 0.85  # m, altura del borde de la batea sobre el piso

# --- Carrusel ---
SLOTS = 12
STEP_DEG = 360.0 / SLOTS  # 30°
MOUNT_R = 270.0  # mm
SHAFT_D = 40.0  # mm
PIPE_OD = 40.0  # mm
PIPE_LEN = 860.0  # mm
WALL_MM = 3.5  # mm de pared de la vaina
TILT_DEG = 3.0  # inclinación del eje (el extremo -Y queda más bajo: drena hacia ahí)
SUBMERGED_PODS = 4.0  # vainas equivalentes en glicerina (el eje se calcula para lograrlo)
DWELL_S = 100.0  # s totales de cada vaina en glicerina
TARGET_TEMP = 110.0  # °C que alcanza la vaina al salir
AMBIENT = 25.0
EMERGED_TAU = 5000.0
PLATE_Y = 380.0
BEARING_Y = 530.0
SHAFT_LEN = 1300.0

# --- Estación de conformado en L ---
STATION_O = Vector((1.95, 0.0, 1.00))  # eje del caño en la matriz (mundo)
BEND_R = 200.0
LEG_H = 300.0
GROOVE_R = 20.5
DIE_X = 90.0
DIE_BAND = 60.0
DIE_OPEN = 0.22  # m, recorrido de apertura de las mitades móviles
OPEN_DIR = Vector((-0.5, 0.0, -0.866))  # diagonal de apertura (abajo y hacia el operario)
CUP_D, CUP_H = 90.0, 150.0
MANDREL_STROKE = 100.0
CONE_HALF_ANGLE = 10.0
CONE_TIP_R = 16.0
CONE_LEN = 65.0
TANK_LITERS = 500.0
TANK_R = 0.40
TANK_XY = (2.80, 0.40)
DEMOLD_TEMP = 50.0

# --- Posiciones del operario (x, y, giro Z) — giro 0 = mira a +X, -π = mira a -X ---
ST_A = (0.55, 0.0, -pi)  # carrusel (retiro y carga)
ST_B = (1.45, -0.05, 0.0)  # prensa
ST_PLC = (1.35, -0.20, -pi / 2)  # tablero PLC
ST_RACK = (1.00, -1.07, -pi)  # rack de caños fríos
ST_BASKET_A = (1.00, 0.95, 0.0)  # canasto de piezas
ST_BENCH = (1.00, 1.75, 0.0)  # mesa de atado
ST_BASKET_B = (1.00, 2.50, 0.0)  # canasto de paquetes
WP_RACK = (1.00, -0.45)
WP_LANE = (1.00, 0.30)

# --- Tiempos de un ciclo (s, relativos al inicio del ciclo) ---
CYCLE_S = 25.0
REL = dict(
    index=(0.0, 1.5),  # indexado automático del carrusel
    reach=(1.5, 2.3),
    swap=2.3,  # la vaina sale del carrusel
    pick_end=3.5,
    carry_end=5.7,  # llegó a la prensa
    place_end=7.2,
    press=(7.3, 8.0),  # el operario toca START
    start=8.0,
    die_close=(8.0, 9.6),
    clamp=(9.6, 10.0),
    mandrel=(10.0, 11.3),
    water=(11.3, 18.3),
    purge=(18.3, 19.3),
    mback=(19.3, 20.1),
    copen=(20.1, 20.4),
    dopen=(20.4, 21.9),
    cup_up=(20.4, 21.4),
    cup_down=(22.8, 23.6),
    rack=(9.7, 10.7),
    carry_cold=(10.7, 12.7),
    load=(12.7, 14.0),
    extract=(22.0, 22.8),
    to_basket=(22.8, 24.2),
    drop=(24.2, 25.0),
)
PACK = dict(grab=1.0, carry=2.0, place=0.8, tie=3.7, lift=0.8, carry2=1.6, place2=1.0, walk=3.0)

# Escala de color del simulador 2D (tempColor)
COLOR_STOPS = [
    (20, (37, 99, 235)),
    (60, (56, 189, 248)),
    (95, (250, 204, 21)),
    (115, (251, 146, 60)),
    (125, (249, 115, 22)),
    (135, (220, 38, 38)),
    (140, (127, 29, 29)),
    (155, (28, 10, 10)),
]


# ============================================================================================
# Utilidades generales
# ============================================================================================


def clamp01(v):
    return max(0.0, min(1.0, v))


def smoothstep(u):
    u = clamp01(u)
    return u * u * (3 - 2 * u)


def F(t):
    """Segundos → número de cuadro."""
    return int(round(t * FPS)) + 1


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(rgb):
    return tuple(srgb_to_linear(c) for c in rgb)


def temp_rgb(t):
    """Color sRGB (0-1) a la temperatura t [°C]: la misma escala que tempColor() del simulador web."""
    stops = COLOR_STOPS
    if t <= stops[0][0]:
        c = stops[0][1]
    elif t >= stops[-1][0]:
        c = stops[-1][1]
    else:
        c = stops[-1][1]
        for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
            if t <= t1:
                f = (t - t0) / (t1 - t0)
                c = tuple(c0[i] + (c1[i] - c0[i]) * f for i in range(3))
                break
    return tuple(v / 255.0 for v in c)


def new_collection(name, parent=None):
    col = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(col)
    return col


def clear_scene():
    """Deja el archivo vacío sin recargar la configuración de fábrica."""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.actions, bpy.data.worlds):
        for item in list(coll):
            coll.remove(item)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


# ---------------------------------------------------------------- materiales (siempre por TIPO de nodo)


def find_node(nodes, node_type):
    """Primer nodo de un tipo interno (p. ej. 'BSDF_PRINCIPLED'). Nunca por nombre: cambia con el idioma de la interfaz."""
    return next((n for n in nodes if n.type == node_type), None)


def get_principled(mat):
    """Nodo Principled BSDF del material (lo crea y lo conecta a la salida si no existe)."""
    if not mat.use_nodes:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = find_node(nodes, "BSDF_PRINCIPLED")
    if bsdf is None:
        bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    out = find_node(nodes, "OUTPUT_MATERIAL")
    if out is None:
        out = nodes.new(type="ShaderNodeOutputMaterial")
    if not out.inputs[0].is_linked:  # entrada 0 = Surface
        mat.node_tree.links.new(bsdf.outputs[0], out.inputs[0])  # salida 0 = BSDF
    return bsdf


def get_input(node, names):
    """Socket de entrada por nombre o identificador (tolera variantes entre versiones 4.x). None si no existe."""
    for n in (names,) if isinstance(names, str) else names:
        for sock in node.inputs:
            if sock.name == n or sock.identifier == n:
                return sock
    return None


def _set(bsdf, names, value):
    sock = get_input(bsdf, names)
    if sock is None:
        return False
    sock.default_value = value
    return True


def make_material(name, color=(0.5, 0.5, 0.5), metallic=0.0, roughness=0.5, alpha=1.0, transmission=0.0, ior=None, emission=None, emission_strength=0.0, coat=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = get_principled(mat)
    _set(b, "Base Color", (*lin(color), 1.0))
    _set(b, "Metallic", metallic)
    _set(b, "Roughness", roughness)
    _set(b, "Alpha", alpha)
    if transmission:
        _set(b, ("Transmission Weight", "Transmission"), transmission)
    if ior is not None:
        _set(b, "IOR", ior)
    if coat:
        _set(b, ("Coat Weight", "Clearcoat"), coat)
    if emission is not None:
        _set(b, ("Emission Color", "Emission"), (*lin(emission), 1.0))
        _set(b, "Emission Strength", emission_strength)
    if alpha < 1.0:
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(mat, attr, val)
            except (AttributeError, TypeError):
                pass
    return mat


def emission_strength(t):
    return 0.35 + 1.6 * clamp01((t - 40.0) / 90.0)


def temp_material(name, t):
    r, g, b = temp_rgb(t)
    return make_material(name, color=(r, g, b), roughness=0.38, emission=(r, g, b), emission_strength=emission_strength(t), coat=0.3)


def set_tube_temp(mat, t, frame=None):
    """Colorea el material según la temperatura (y la keyframea si se da el cuadro)."""
    r, g, b = temp_rgb(t)
    bsdf = get_principled(mat)
    rgba = (*lin((r, g, b)), 1.0)
    for sock, val in (
        (get_input(bsdf, "Base Color"), rgba),
        (get_input(bsdf, ("Emission Color", "Emission")), rgba),
        (get_input(bsdf, "Emission Strength"), emission_strength(t)),
    ):
        if sock is None:
            continue
        sock.default_value = val
        if frame is not None:
            sock.keyframe_insert("default_value", frame=frame)


def set_glow(mat, strength, frame):
    """Intensidad de emisión de un material (luces del PLC) keyframeada."""
    sock = get_input(get_principled(mat), "Emission Strength")
    if sock is not None:
        sock.default_value = strength
        sock.keyframe_insert("default_value", frame=frame)


# ---------------------------------------------------------------- geometría con bmesh

_PARENT = [None]


def use_parent(p):
    """Padre automático de todo lo que se cree con finish()/make_pipe()/make_empty() a partir de ahora."""
    _PARENT[0] = p


def rot_to(direction):
    """Matriz 4×4 que lleva +Z a `direction`."""
    return Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()


def add_cyl(bm, r, depth, center=(0, 0, 0), direction=(0, 0, 1), segs=48, r2=None, caps=True):
    """Cilindro/cono; r en el extremo −dirección y r2 en el extremo +dirección."""
    m = Matrix.Translation(Vector(center)) @ rot_to(direction)
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth, matrix=m)


def add_box(bm, size, center=(0, 0, 0)):
    m = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def add_sphere(bm, r, center=(0, 0, 0), segs=16, rings=10):
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r, matrix=Matrix.Translation(Vector(center)))


def add_torus(bm, R, r, center=(0, 0, 0), direction=(0, 0, 1), segs=48, rsegs=12):
    m = Matrix.Translation(Vector(center)) @ rot_to(direction)
    verts = []
    for i in range(segs):
        u = 2 * pi * i / segs
        row = []
        for j in range(rsegs):
            v = 2 * pi * j / rsegs
            p = Vector(((R + r * cos(v)) * cos(u), (R + r * cos(v)) * sin(u), r * sin(v)))
            row.append(bm.verts.new(m @ p))
        verts.append(row)
    for i in range(segs):
        for j in range(rsegs):
            a, b = verts[i][j], verts[(i + 1) % segs][j]
            c, d = verts[(i + 1) % segs][(j + 1) % rsegs], verts[i][(j + 1) % rsegs]
            bm.faces.new((a, b, c, d))


def prism(bm, pts_xz, y0, y1):
    """Prisma cerrado: polígono en XZ extruido de y0 a y1."""
    a = [bm.verts.new((x, y0, z)) for x, z in pts_xz]
    b = [bm.verts.new((x, y1, z)) for x, z in pts_xz]
    n = len(pts_xz)
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))


def finish(name, bm, mat, col, smooth=True, edge_split=True, bevel=0.0):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    if mat is not None:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if _PARENT[0] is not None:
        ob.parent = _PARENT[0]
    if edge_split:
        mod = ob.modifiers.new("EdgeSplit", "EDGE_SPLIT")
        mod.split_angle = radians(38)
    if bevel:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    return ob


def make_empty(name, col, loc=(0, 0, 0), kind="PLAIN_AXES", size=0.1, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.empty_display_size = size
    e.location = loc
    col.objects.link(e)
    if parent is not None:
        e.parent = parent
    return e


def fillet_polyline(pts, radius, segs=6):
    pts = [Vector(p) for p in pts]
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        d1, d2 = (a - b), (c - b)
        l1, l2 = d1.length, d2.length
        if l1 < 1e-9 or l2 < 1e-9:
            continue
        d1.normalize()
        d2.normalize()
        ang = d1.angle(d2)
        if ang < 1e-3 or abs(ang - pi) < 1e-3:
            out.append(b)
            continue
        t = min(radius / math.tan(ang / 2), l1 / 2, l2 / 2)
        s, e = b + d1 * t, b + d2 * t
        for k in range(segs + 1):
            u = k / segs
            out.append((1 - u) ** 2 * s + 2 * u * (1 - u) * b + u**2 * e)
    out.append(pts[-1])
    return out


def make_pipe(name, pts, radius, mat, col, fillet=0.06):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    pts = fillet_polyline(pts, fillet)
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, v in zip(sp.points, pts):
        p.co = (v.x, v.y, v.z, 1.0)
    ob = bpy.data.objects.new(name, cu)
    cu.materials.append(mat)
    col.objects.link(ob)
    if _PARENT[0] is not None:
        ob.parent = _PARENT[0]
    return ob


def make_text(name, text, col, mat, size=0.05):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = text
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    col.objects.link(ob)
    return ob


def key_obj(ob, f, pos, euler):
    ob.location = pos
    ob.rotation_euler = euler
    ob.keyframe_insert("location", frame=f)
    ob.keyframe_insert("rotation_euler", frame=f)


def key_loc(ob, f, loc):
    ob.location = loc
    ob.keyframe_insert("location", frame=f)


def set_vis(ob, f, visible):
    ob.hide_viewport = not visible
    ob.hide_render = not visible
    ob.keyframe_insert("hide_viewport", frame=f)
    ob.keyframe_insert("hide_render", frame=f)


# ============================================================================================
# Geometría derivada y modelo térmico
# ============================================================================================


class Geo:
    """Resultados de calcular nivel de glicerina, altura del eje, intervalo de avance y constante térmica."""


GEO = Geo()


def level_for_volume(liters):
    """Profundidad del nivel de glicerina bajo el plano del borde [m] para `liters` en la batea semicilíndrica."""
    ri = mm(BATH_R - BATH_WALL)
    length = mm(BATH_L - 2 * BATH_WALL)
    target = liters / 1000.0 / length

    def area(h):  # segmento circular bajo una cuerda a profundidad h del centro
        return ri * ri * math.acos(h / ri) - h * sqrt(ri * ri - h * h)

    lo, hi = 0.0, ri * 0.999
    for _ in range(60):
        mid = (lo + hi) / 2
        if area(mid) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def submerged_fraction(z_center, level_z):
    """Fracción sumergida de un caño con el centro a z_center y la superficie a level_z (ambos respecto del borde)."""
    return clamp01((level_z - z_center) / mm(PIPE_OD) + 0.5)


def slot_fraction(theta_deg, axis_a, level_z):
    return submerged_fraction(axis_a + mm(MOUNT_R) * cos(radians(theta_deg)), level_z)


def total_fraction(axis_a, level_z):
    return sum(slot_fraction(k * STEP_DEG, axis_a, level_z) for k in range(SLOTS))


def solve_axis_height(pods, level_z):
    """Altura del eje sobre el borde [m] para que haya `pods` vainas equivalentes sumergidas."""
    lo, hi = -0.40, 0.60
    for _ in range(60):
        mid = (lo + hi) / 2
        if total_fraction(mid, level_z) > pods:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def carousel_step(T, f, dt, bath_t, amb, tau_l):
    """Un paso térmico de un caño con fracción sumergida f (igual que carouselStep() del simulador)."""
    g_l, g_a = f / tau_l, (1 - f) / EMERGED_TAU
    g = g_l + g_a
    t_inf = (g_l * bath_t + g_a * amb) / g
    return t_inf + (T - t_inf) * exp(-dt * g)


def calibrate_tau(path_f, dt):
    """τ [s] para que un caño de AMBIENT llegue a TARGET_TEMP tras recorrer las fracciones `path_f` (dt c/u)."""

    def t_pick(tau):
        T = AMBIENT
        for f in path_f:
            T = carousel_step(T, f, dt, BATH_TEMP, AMBIENT, tau)
        return T

    lo, hi = 5.0, 600.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if t_pick(mid) > TARGET_TEMP:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def derive_geometry():
    G = GEO
    G.level_h = level_for_volume(BATH_LITERS)  # profundidad bajo el borde
    G.level_z = -G.level_h
    G.axis_a = solve_axis_height(SUBMERGED_PODS, G.level_z)  # eje sobre el borde
    G.tilt = radians(TILT_DEG)
    # estación de RETIRO: primera posición completamente emergida en el lado que sube
    G.pick_k = 1
    for k in range(1, SLOTS):
        if k * STEP_DEG < 180 and slot_fraction(k * STEP_DEG, G.axis_a, G.level_z) < 1e-9:
            G.pick_k = k
    G.pick_angle = G.pick_k * STEP_DEG
    G.pick_j = (-G.pick_k) % SLOTS  # pasos desde la carga (cenit) hasta el retiro
    G.path_f = [slot_fraction((-j * STEP_DEG) % 360.0, G.axis_a, G.level_z) for j in range(1, G.pick_j)]
    G.n_eff = sum(G.path_f)
    G.interval = DWELL_S / G.n_eff  # s entre indexados para que cada vaina pase DWELL_S sumergida
    G.cycle = max(G.interval, CYCLE_S)
    G.tau = calibrate_tau(G.path_f, G.cycle)
    S = [AMBIENT]
    for f in G.path_f:
        S.append(carousel_step(S[-1], f, G.cycle, BATH_TEMP, AMBIENT, G.tau))
    G.S = S  # S[j] = temperatura al terminar la residencia en la posición j
    heater_top = -mm(BATH_R - BATH_WALL) + mm(HEATER_D)
    lowest_bottom = G.axis_a - mm(MOUNT_R) - mm(PIPE_OD) / 2 - 0.43 * sin(G.tilt)
    G.heater_clearance = lowest_bottom - heater_top


def slot_world(m, n_idx):
    """Posición mundial del centro del tubo de la ranura m tras n_idx indexados (sin animar nada)."""
    ang = radians(m * STEP_DEG)
    v = Vector((mm(MOUNT_R) * sin(ang), 0.0, mm(MOUNT_R) * cos(ang)))
    v = Matrix.Rotation(-radians(STEP_DEG) * n_idx, 3, "Y") @ v
    v = Matrix.Rotation(GEO.tilt, 3, "X") @ v
    return Vector((0.0, 0.0, Z_RIM + GEO.axis_a)) + v


# ============================================================================================
# 1. Batea y carrusel
# ============================================================================================


def build_bath_and_carousel(root):
    col = new_collection("01_Batea_Carrusel", root)
    G = GEO
    bath_ref = make_empty("Batea_Ref", col, (0, 0, Z_RIM), size=0.15)
    use_parent(bath_ref)
    R, L = mm(BATH_R), mm(BATH_L)
    mats = {
        "steel": make_material("Acero_Batea", (0.62, 0.64, 0.68), metallic=1.0, roughness=0.34),
        "steel_dark": make_material("Acero_Oscuro", (0.18, 0.2, 0.24), metallic=1.0, roughness=0.5),
        "inox": make_material("Inox_Eje", (0.85, 0.87, 0.9), metallic=1.0, roughness=0.18),
        "frame": make_material("Bastidor_Azul", (0.08, 0.2, 0.42), metallic=0.3, roughness=0.45),
        "heater": make_material("Resistencia_Blindada", (0.55, 0.57, 0.6), metallic=1.0, roughness=0.3, emission=(1.0, 0.3, 0.05), emission_strength=0.6),
        "terminal": make_material("Borne_Cerámico", (0.85, 0.82, 0.72), roughness=0.6),
        "bearing": make_material("Rodamiento", (0.05, 0.05, 0.06), metallic=1.0, roughness=0.35),
        "glycerin": make_material("Glicerina", (0.95, 0.5, 0.06), roughness=0.02, alpha=0.55, transmission=1.0, ior=1.47),
    }
    out = {"mats": mats, "col": col, "ref": bath_ref}

    # --- Cuba semicilíndrica con tapas y reborde ---
    n = 64
    arc = [(R * sin(radians(-90 + 180 * i / n)), -R * cos(radians(-90 + 180 * i / n))) for i in range(n + 1)]
    bm = bmesh.new()
    prism(bm, arc, -L / 2, L / 2)
    top = [f for f in bm.faces if len(f.verts) == 4 and all(abs(v.co.z) < 1e-6 for v in f.verts)]
    bmesh.ops.delete(bm, geom=top, context="FACES")  # borde superior abierto
    batea = finish("Batea_R323", bm, mats["steel"], col, edge_split=False)
    mod = batea.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = mm(BATH_WALL)
    mod.offset = 0
    for sx in (-1, 1):
        b2 = bmesh.new()
        add_box(b2, (mm(34), L + mm(16), mm(8)), (sx * (R + mm(13)), 0, mm(2)))
        finish(f"Reborde_{'D' if sx > 0 else 'I'}", b2, mats["steel"], col, smooth=False, bevel=mm(2))

    # --- Glicerina (120 L): su nivel queda BAJO el borde y muy por debajo del eje del carrusel ---
    ri = R - mm(BATH_WALL)
    a0 = math.acos(G.level_h / ri)
    gl = [(ri * sin(-a0 + 2 * a0 * i / n), -ri * cos(-a0 + 2 * a0 * i / n)) for i in range(n + 1)]
    bm = bmesh.new()
    prism(bm, gl, -L / 2 + mm(BATH_WALL), L / 2 - mm(BATH_WALL))
    out["glycerin"] = finish("Glicerina_120L", bm, mats["glycerin"], col, edge_split=False)

    # --- 2 resistencias blindadas Ø55 apoyadas en el fondo, a lo largo ---
    rh = mm(HEATER_D / 2)
    for k, sx in enumerate((-1, 1)):
        x = sx * mm(HEATER_X)
        z = -sqrt(ri * ri - x * x) + rh + mm(2)
        bm = bmesh.new()
        add_cyl(bm, rh, mm(840), (x, 0, z), (0, 1, 0), 40)
        finish(f"Resistencia_D55_{k + 1}", bm, mats["heater"], col)
        bm = bmesh.new()
        for sy in (-1, 1):
            add_cyl(bm, mm(16), mm(34), (x, sy * mm(437), z), (0, 1, 0), 24)
        finish(f"Borne_Resistencia_{k + 1}", bm, mats["terminal"], col)

    # --- Bastidor de la batea ---
    top_leg = -sqrt(R * R - mm(300) ** 2) + mm(10)
    bm = bmesh.new()
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box(bm, (mm(60), mm(60), top_leg + Z_RIM), (sx * mm(300), sy * mm(380), (top_leg - Z_RIM) / 2))
    for sy in (-1, 1):
        add_box(bm, (mm(660), mm(50), mm(50)), (0, sy * mm(380), -Z_RIM + mm(300)))
        add_box(bm, (mm(140), mm(50), -R - (-Z_RIM + mm(300))), (0, sy * mm(380), (-R - Z_RIM + mm(300)) / 2 - mm(10)))
    for sx in (-1, 1):
        add_box(bm, (mm(50), mm(800), mm(50)), (sx * mm(300), 0, -Z_RIM + mm(300)))
    finish("Bastidor_Batea", bm, mats["frame"], col, smooth=False, bevel=mm(2))

    # --- Soportes con rodamientos: la altura sigue al eje inclinado ---
    tanx = math.tan(G.tilt)
    for sy in (-1, 1):
        y = sy * mm(BEARING_Y)
        zc = G.axis_a + y * tanx
        ax = Vector((0, cos(G.tilt), sin(G.tilt)))
        bm = bmesh.new()
        add_box(bm, (mm(180), mm(70), mm(18)), (0, y, -Z_RIM + mm(9)))
        add_box(bm, (mm(110), mm(50), zc - mm(62) + Z_RIM - mm(18)), (0, y, (-Z_RIM + mm(18) + zc - mm(62)) / 2))
        add_cyl(bm, mm(62), mm(50), (0, y, zc), ax, 48)
        for sx in (-1, 1):
            add_cyl(bm, mm(9), mm(30), (sx * mm(70), y, -Z_RIM + mm(18)), (0, 0, 1), 16)
        finish(f"Soporte_Rodamiento_{'+' if sy > 0 else '-'}", bm, mats["frame"], col, smooth=False, bevel=mm(2))
        bm = bmesh.new()
        add_torus(bm, mm(33), mm(12), (0, y + sy * mm(28), zc), ax, 48, 12)
        add_cyl(bm, mm(34), mm(54), (0, y, zc), ax, 48)
        finish(f"Rodamiento_{'+' if sy > 0 else '-'}", bm, mats["bearing"], col)

    # --- Conjunto del carrusel, INCLINADO: el extremo −Y queda más bajo y drena hacia la batea ---
    axis = make_empty("Carrusel_Eje_Inclinado", col, (0, 0, G.axis_a), kind="ARROWS", size=0.2, parent=bath_ref)
    axis.rotation_euler = (G.tilt, 0, 0)
    use_parent(axis)
    bm = bmesh.new()
    add_cyl(bm, mm(SHAFT_D / 2), mm(SHAFT_LEN), (0, 0, 0), (0, 1, 0), 40)
    finish("Eje_Carrusel_D40", bm, mats["inox"], col)
    rotor = make_empty("Carrusel_Rotor", col, kind="CIRCLE", size=0.2, parent=axis)
    out["rotor"] = rotor
    use_parent(rotor)
    for sy in (-1, 1):
        y = sy * mm(PLATE_Y)
        bm = bmesh.new()
        add_cyl(bm, mm(70), mm(16), (0, y, 0), (0, 1, 0), 48)
        add_torus(bm, mm(MOUNT_R), mm(5), (0, y, 0), (0, 1, 0), 96, 8)
        for i in range(SLOTS):
            a = radians(i * STEP_DEG)
            dx, dz = sin(a), cos(a)
            mid = mm(MOUNT_R - 70) / 2 + mm(70)
            m = Matrix.Translation((dx * mid, y, dz * mid)) @ Matrix.Rotation(-a, 4, "Y")
            bmesh.ops.create_cube(bm, size=1.0, matrix=m @ Matrix.Diagonal((mm(26), mm(10), mm(MOUNT_R - 70 - 22), 1.0)))
            add_torus(bm, mm(PIPE_OD / 2 + 6.5), mm(6.5), (dx * mm(MOUNT_R), y, dz * mm(MOUNT_R)), (0, 1, 0), 32, 10)
        finish(f"Plato_{'+' if sy > 0 else '-'}", bm, mats["steel_dark"], col, bevel=mm(1.5))

    tubes = []
    for m in range(SLOTS):
        a = radians(m * STEP_DEG)
        bm = bmesh.new()
        add_cyl(bm, mm(PIPE_OD / 2), mm(PIPE_LEN), (0, 0, 0), (0, 1, 0), 40)
        mat = temp_material(f"Tubo_PEAD_{m:02d}", AMBIENT)
        ob = finish(f"Tubo_{m:02d}", bm, mat, col)
        ob.location = (mm(MOUNT_R) * sin(a), 0, mm(MOUNT_R) * cos(a))
        tubes.append(ob)
    out["tubes"] = tubes
    use_parent(None)
    return out


# ============================================================================================
# 2. Estación de conformado en L
# ============================================================================================

TUBE_Y0 = -mm(PIPE_LEN) / 2  # y local del extremo de entrada (campana)
LEG = mm(LEG_H)
BR = mm(BEND_R)
Y_TIP0 = TUBE_Y0 - mm(50)  # punta del cono con el mandril atrás


def tube_path(s, beta):
    """(y, z, rumbo) del eje del caño en la coordenada material s con el codo curvado a la fracción beta."""
    phi_max = beta * pi / 2
    if s <= LEG:
        return TUBE_Y0 + s, 0.0, 0.0
    arc = BR * phi_max
    if s <= LEG + arc:
        phi = (s - LEG) / BR
        return TUBE_Y0 + LEG + BR * sin(phi), BR * (1 - cos(phi)), phi
    ye, ze = TUBE_Y0 + LEG + BR * sin(phi_max), BR * (1 - cos(phi_max))
    d = s - LEG - arc
    return ye + d * cos(phi_max), ze + d * sin(phi_max), phi_max


def sweep_band(name, s0, s1, x_sign, mat, col):
    """Mitad de matriz: banda barrida a lo largo de la L final con canal semicilíndrico sobre la cara x=0."""
    half, t, gr = mm(DIE_BAND), mm(DIE_X), mm(GROOVE_R)
    prof = [(-half, 0.0), (-gr, 0.0)]
    for k in range(1, 12):
        al = pi - pi * k / 12
        prof.append((gr * cos(al), gr * sin(al)))
    prof += [(gr, 0.0), (half, 0.0), (half, t), (-half, t)]
    ss = [s0] + [s for s in (LEG, LEG + BR * pi / 2) if s0 < s < s1] + [s1]
    samples = []
    for a, b in zip(ss, ss[1:]):
        k = 32 if abs((b - a) - BR * pi / 2) < 1e-6 else max(2, int((b - a) / mm(25)))
        samples += [a + (b - a) * i / k for i in range(k)]
    samples.append(s1)
    bm = bmesh.new()
    rings = []
    for s in samples:
        y, z, phi = tube_path(s, 1.0)
        ny, nz = -sin(phi), cos(phi)
        rings.append([bm.verts.new((x_sign * px, y + ny * pn, z + nz * pn)) for pn, px in prof])
    m = len(prof)
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(m):
            bm.faces.new((r0[i], r0[(i + 1) % m], r1[(i + 1) % m], r1[i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return finish(name, bm, mat, col)


def build_actuator(name, anchor, u, rod_len, t0, t1, mats, col, post_y, floor_z, parent):
    """Cilindro neumático diagonal: vástago solidario a la mitad móvil (se anima) y cuerpo fijo a un poste."""
    bm = bmesh.new()
    add_cyl(bm, mm(12), rod_len, anchor + u * (rod_len / 2), u, 24)
    add_box(bm, (mm(60), mm(20), mm(60)), anchor + u * 0.01)
    rod = finish(f"Vastago_{name}", bm, mats["chrome"], col)
    bm = bmesh.new()
    add_cyl(bm, mm(36), t1 - t0, anchor + u * ((t0 + t1) / 2), u, 32)
    for t in (t0, t1):
        add_cyl(bm, mm(42), mm(24), anchor + u * t, u, 32)
    finish(f"Cilindro_{name}", bm, mats["cyl"], col)
    p = anchor + u * ((t0 + t1) / 2)
    bm = bmesh.new()
    add_box(bm, (mm(50), abs(post_y - p.y) + mm(50), mm(50)), (p.x, (post_y + p.y) / 2, p.z))
    add_box(bm, (mm(60), mm(60), p.z - floor_z), (p.x, post_y, (p.z + floor_z) / 2))
    add_box(bm, (mm(240), mm(240), mm(16)), (p.x, post_y, floor_z + mm(8)))
    finish(f"Soporte_{name}", bm, mats["frame"], col, smooth=False, bevel=mm(2))
    return rod


def build_station(root):
    col = new_collection("02_Estacion_L", root)
    O = STATION_O
    st = make_empty("Estacion_L", col, tuple(O), kind="ARROWS", size=0.15)
    use_parent(st)
    fl = -O.z  # piso en coordenadas locales
    mats = {
        "die": make_material("Matriz_Acero_Mecanizado", (0.5, 0.53, 0.58), metallic=1.0, roughness=0.28),
        "die_move": make_material("Matriz_Movil", (0.42, 0.46, 0.52), metallic=1.0, roughness=0.3),
        "brass": make_material("Bronce_Mordaza", (0.8, 0.55, 0.16), metallic=1.0, roughness=0.3),
        "chrome": make_material("Cromo_Pulido", (0.95, 0.96, 0.98), metallic=1.0, roughness=0.06),
        "cone": make_material("Cono_Expansor", (0.9, 0.92, 0.95), metallic=1.0, roughness=0.08),
        "cyl": make_material("Cilindro_Neumatico", (0.12, 0.13, 0.16), metallic=0.8, roughness=0.38),
        "frame": make_material("Bastidor_Estacion", (0.08, 0.2, 0.42), metallic=0.3, roughness=0.45),
        "glass": make_material("Vaso_Acrilico", (0.85, 0.92, 1.0), roughness=0.05, alpha=0.25, transmission=1.0, ior=1.49),
        "water": make_material("Agua_Templado", (0.1, 0.45, 0.95), roughness=0.02, alpha=0.6, transmission=1.0, ior=1.33),
        "blue": make_material("Anodizado_Azul", (0.1, 0.35, 0.8), metallic=0.8, roughness=0.3),
        "pipe": make_material("Caneria_Inox", (0.78, 0.8, 0.84), metallic=1.0, roughness=0.25),
        "hose": make_material("Manguera_Negra", (0.03, 0.03, 0.04), roughness=0.55),
    }
    out = {"root": st, "col": col, "mats": mats}

    # --- Matriz fija en escuadra (x ≥ 0) y matriz móvil curva complementaria (x ≤ 0) ---
    out["fixed"] = sweep_band("Matriz_Fija_L_R200", mm(200), mm(720), +1, mats["die"], col)
    out["moving"] = sweep_band("Matriz_Movil_Curva", mm(200), mm(700), -1, mats["die_move"], col)
    # --- Mordaza de sujeción en la entrada recta (mitad fija + mitad móvil, con insertos de bronce) ---
    sweep_band("Mordaza_Fija", mm(30), mm(180), +1, mats["brass"], col)
    out["clamp"] = sweep_band("Mordaza_Movil", mm(30), mm(180), -1, mats["brass"], col)

    u = OPEN_DIR.normalized()
    ay, az = TUBE_Y0 + LEG + BR * sin(pi / 4), BR * (1 - cos(pi / 4))
    out["die_rod"] = build_actuator("Matriz_Diagonal", Vector((-mm(DIE_X), ay, az)), u, 0.32, 0.30, 0.60, mats, col, +0.52, fl, st)
    cy_clamp = TUBE_Y0 + mm(105)
    out["clamp_rod"] = build_actuator("Mordaza_Diagonal", Vector((-mm(DIE_X), cy_clamp, 0.0)), u, 0.30, 0.28, 0.54, mats, col, -0.52, fl, st)
    out["open_vec"] = u * DIE_OPEN
    out["u"] = u

    # --- Bancada detrás de las mitades fijas ---
    bm = bmesh.new()
    wall_top = mm(360)
    add_box(bm, (mm(20), mm(780), wall_top - fl), (mm(DIE_X) + mm(10), mm(-120), (wall_top + fl) / 2))
    add_box(bm, (mm(300), mm(1500), mm(20)), (mm(80), mm(-380), fl + mm(10)))
    for y in (-0.60, -0.15, 0.20):
        add_box(bm, (mm(140), mm(16), wall_top - fl - mm(60)), (mm(DIE_X) - mm(50), y, (wall_top + fl) / 2 - mm(30)))
    finish("Bancada_Estacion", bm, mats["frame"], col, smooth=False, bevel=mm(2))

    # --- Vaso superior de rebalse Ø90 × 150: sube un poco para liberar la pieza ---
    cy = TUBE_Y0 + LEG + BR  # y del tramo vertical
    cz0 = mm(395)
    cup_grp = make_empty("Vaso_Grupo", col, (0, 0, 0), size=0.05, parent=st)
    use_parent(cup_grp)
    n = 48
    ro, ri_ = mm(CUP_D / 2), mm(CUP_D / 2 - 3)
    walls = bmesh.new()
    rings = []
    for z in (cz0, cz0 + mm(CUP_H)):
        rings.append(
            (
                [walls.verts.new((ri_ * cos(2 * pi * i / n), cy + ri_ * sin(2 * pi * i / n), z)) for i in range(n)],
                [walls.verts.new((ro * cos(2 * pi * i / n), cy + ro * sin(2 * pi * i / n), z)) for i in range(n)],
            )
        )
    (ia, oa), (ib, ob_) = rings
    for i in range(n):
        j = (i + 1) % n
        walls.faces.new((oa[i], oa[j], ob_[j], ob_[i]))
        walls.faces.new((ia[j], ia[i], ib[i], ib[j]))
        walls.faces.new((ib[i], ib[j], ob_[j], ob_[i]))
        walls.faces.new((ia[i], ia[j], oa[j], oa[i]))
    finish("Vaso_Rebalse_D90", walls, mats["glass"], col, edge_split=False)
    sy_ = cy + mm(85)  # salida lateral fuera de la banda de la matriz
    bm = bmesh.new()
    add_cyl(bm, ro, mm(6), (0, cy, cz0 + mm(3)), (0, 0, 1), 48)
    add_cyl(bm, mm(12), sy_ - cy, (0, (cy + sy_) / 2, cz0 - mm(20)), (0, 1, 0), 24)  # codo lateral
    add_cyl(bm, mm(12), mm(180), (0, sy_, cz0 - mm(110)), (0, 0, 1), 24)  # niple que baja
    finish("Vaso_Fondo_y_Niple", bm, mats["pipe"], col)
    water_h = mm(100)
    bm = bmesh.new()
    add_cyl(bm, ri_ - mm(1), water_h, (0, 0, water_h / 2), (0, 0, 1), 48)  # origen en la base
    water = finish("Agua_Vaso", bm, mats["water"], col, edge_split=False)
    water.location = (0, cy, cz0 + mm(6))
    out["water"] = water
    out["cup"] = cup_grp
    use_parent(st)
    bm = bmesh.new()  # tubo fijo (recibe el niple) y su escuadra a la bancada
    add_cyl(bm, mm(17), mm(180), (0, sy_, cz0 - mm(150)), (0, 0, 1), 24)
    add_box(bm, (mm(110), mm(14), mm(14)), (mm(55), sy_, cz0 - mm(110)))
    finish("Tubo_Fijo_Drenaje", bm, mats["pipe"], col)
    out["drain_bottom"] = Vector((0, sy_, cz0 - mm(240)))

    # --- Mandril abocardador: cilindro de avance, vástago, cono de 10° y tobera interior ---
    bm = bmesh.new()
    add_cyl(bm, mm(48), mm(240), (0, -mm(1000), 0), (0, 1, 0), 48)
    add_cyl(bm, mm(55), mm(26), (0, -mm(1115), 0), (0, 1, 0), 48)
    add_cyl(bm, mm(55), mm(26), (0, -mm(887), 0), (0, 1, 0), 48)
    for sy in (-1, 1):
        add_cyl(bm, mm(10), mm(300), (sy * mm(60), -mm(1000), mm(60)), (0, 1, 0), 16)
    add_box(bm, (mm(90), mm(240), -fl - mm(60)), (0, -mm(1000), (fl - mm(60)) / 2 - mm(30)))
    add_box(bm, (mm(180), mm(300), mm(20)), (0, -mm(1000), fl + mm(10)))
    finish("Cilindro_Mandril", bm, mats["cyl"], col, bevel=mm(1))
    grp = make_empty("Mandril_Grupo", col, (0, 0, 0), size=0.05, parent=st)
    use_parent(grp)
    r_base = mm(CONE_TIP_R) + mm(CONE_LEN) * math.tan(radians(CONE_HALF_ANGLE))
    y_base0 = Y_TIP0 - mm(CONE_LEN)
    bm = bmesh.new()
    add_cyl(bm, mm(12.5), y_base0 + 1.0, (0, (y_base0 - 1.0) / 2, 0), (0, 1, 0), 32)
    finish("Vastago_Mandril", bm, mats["chrome"], col)
    bm = bmesh.new()
    add_cyl(bm, r_base, mm(CONE_LEN), (0, Y_TIP0 - mm(CONE_LEN) / 2, 0), (0, 1, 0), 48, r2=mm(CONE_TIP_R))  # base ancha atrás
    finish("Cono_10deg", bm, mats["cone"], col)
    bm = bmesh.new()
    add_cyl(bm, mm(7), mm(70), (0, Y_TIP0 + mm(29), 0), (0, 1, 0), 24)
    add_cyl(bm, mm(8.5), mm(4), (0, Y_TIP0 + mm(60), 0), (0, 1, 0), 24)
    for k in range(4):
        a = k * pi / 2
        add_cyl(bm, mm(2.2), mm(10), (mm(6.3) * cos(a), Y_TIP0 + mm(50), mm(6.3) * sin(a)), (cos(a), 0, sin(a)), 8)
    finish("Tobera_Inyeccion", bm, mats["blue"], col)
    use_parent(st)
    bm = bmesh.new()
    add_torus(bm, mm(26), mm(10), (0, TUBE_Y0 - mm(170), 0), (0, 1, 0), 32, 10)
    add_box(bm, (mm(30), mm(30), -fl - mm(40)), (0, TUBE_Y0 - mm(170), (fl - mm(40)) / 2 - mm(20)))
    finish("Guia_Vastago", bm, mats["pipe"], col, bevel=mm(1))
    out["mandrel"] = grp
    out["mandrel_inlet"] = Vector((0, -mm(1128), 0))

    # --- Perfil circular Ø40 para el bisel de la curva del caño ---
    prof = bpy.data.curves.new("Perfil_Caño_D40", "CURVE")
    prof.dimensions = "2D"
    k = 0.5523
    r = mm(PIPE_OD / 2)
    sp = prof.splines.new("BEZIER")
    sp.bezier_points.add(3)
    for i, (px, py, hx, hy) in enumerate([(r, 0, 0, k * r), (0, r, -k * r, 0), (-r, 0, 0, -k * r), (0, -r, k * r, 0)]):
        bp = sp.bezier_points[i]
        bp.co = (px, py, 0)
        bp.handle_left_type = bp.handle_right_type = "FREE"
        bp.handle_left = (px - hx, py - hy, 0)
        bp.handle_right = (px + hx, py + hy, 0)
    sp.use_cyclic_u = True
    prof.resolution_u = 12
    pob = bpy.data.objects.new("Perfil_Caño_D40", prof)
    col.objects.link(pob)
    pob.hide_render = True
    try:  # oculto en la vista pero NO desactivado: un objeto de bisel desactivado dejaría de moldear la curva
        pob.hide_set(True)
    except (RuntimeError, AttributeError):
        pass
    out["profile"] = pob
    use_parent(None)
    return out


def tube_sample_params():
    """Coordenadas material s de los puntos de control: más densos en la campana y en el arco."""
    ss = set()
    L = mm(PIPE_LEN)
    for i in range(0, 7):
        ss.add(round(i * 0.01, 6))  # cada 10 mm los primeros 60 mm (campana)
    s = 0.06
    while s < L:
        step = 0.02 if (LEG - 0.03 <= s <= LEG + BR * pi / 2 + 0.03) else 0.04
        ss.add(round(s, 6))
        s += step
    ss.add(round(L, 6))
    for s in (LEG, LEG + BR * pi / 2):
        ss.add(round(s, 6))
    return sorted(x for x in ss if x <= L + 1e-9)


def make_tube_curve(station, name, mat):
    """Curva Bézier con Bevel Object Ø40; el radio de cada punto de control modela la campana."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_mode = "OBJECT"
    cu.bevel_object = station["profile"]
    cu.use_fill_caps = True
    cu.twist_mode = "MINIMUM"
    cu.resolution_u = 6
    ss = tube_sample_params()
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(ss) - 1)
    for bp in sp.bezier_points:
        bp.handle_left_type = bp.handle_right_type = "FREE"
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    station["col"].objects.link(ob)
    return ob, sp, ss


def pose_tube(sp, ss, beta):
    """Pone los puntos de control del caño para la fracción de curvado beta (radio 1)."""
    n = len(ss)
    for i, bp in enumerate(sp.bezier_points):
        s = ss[i]
        y, z, phi = tube_path(s, beta)
        t = Vector((0.0, cos(phi), sin(phi)))
        dl = (s - ss[i - 1]) / 3 if i > 0 else (ss[1] - ss[0]) / 3
        dr = (ss[i + 1] - s) / 3 if i < n - 1 else dl
        c = Vector((0.0, y, z))
        bp.co = c
        bp.handle_left = c - t * dl
        bp.handle_right = c + t * dr
        bp.radius = 1.0


def bell_factor(s, y_tip):
    """Factor de radio de la campana en s con la punta del cono en y_tip (semiángulo de 10°)."""
    behind = (y_tip - TUBE_Y0) - s
    if behind <= 0:
        return 1.0
    return max(1.0, (mm(CONE_TIP_R) + behind * math.tan(radians(CONE_HALF_ANGLE))) / mm(PIPE_OD / 2))


def key_tube(sp, f, with_radius=True):
    for bp in sp.bezier_points:
        bp.keyframe_insert("co", frame=f)
        bp.keyframe_insert("handle_left", frame=f)
        bp.keyframe_insert("handle_right", frame=f)
        if with_radius:
            bp.keyframe_insert("radius", frame=f)


# ============================================================================================
# 3. Tanque, electrobomba, cañerías, PLC, canastos y mesa de atado
# ============================================================================================


def build_tank_pump_pipes(root, station):
    col = new_collection("03_Tanque_Bomba_Canerias", root)
    use_parent(None)
    O = STATION_O
    m = station["mats"]
    steel = make_material("Acero_Tanque", (0.72, 0.74, 0.78), metallic=1.0, roughness=0.32)
    paint = make_material("Pintura_Bomba", (0.05, 0.28, 0.55), metallic=0.4, roughness=0.4)
    cast = make_material("Fundicion_Bomba", (0.2, 0.22, 0.25), metallic=0.9, roughness=0.5)
    height = (TANK_LITERS / 1000.0) / (pi * TANK_R**2)
    tx, ty = TANK_XY
    base = 0.10
    bm = bmesh.new()
    add_cyl(bm, TANK_R, height, (tx, ty, base + height / 2), (0, 0, 1), 96)
    add_torus(bm, TANK_R, mm(14), (tx, ty, base + height), (0, 0, 1), 96, 12)
    add_torus(bm, TANK_R, mm(14), (tx, ty, base), (0, 0, 1), 96, 12)
    for k in range(3):
        add_torus(bm, TANK_R, mm(8), (tx, ty, base + height * (k + 1) / 4), (0, 0, 1), 96, 8)
    add_cyl(bm, mm(110), mm(40), (tx - 0.12, ty - 0.12, base + height + mm(20)), (0, 0, 1), 40)
    finish("Tanque_500L", bm, steel, col)
    bm = bmesh.new()
    for k in range(4):
        a = radians(45 + 90 * k)
        add_box(bm, (mm(70), mm(70), base), (tx + (TANK_R - 0.07) * cos(a), ty + (TANK_R - 0.07) * sin(a), base / 2))
    finish("Patas_Tanque", bm, m["frame"], col, smooth=False, bevel=mm(2))
    top_z = base + height

    # --- electrobomba centrífuga en la base del tanque (lado −Y) ---
    py = ty - TANK_R - 0.26
    pz = mm(110)
    bm = bmesh.new()
    add_cyl(bm, mm(88), mm(250), (tx, py - 0.13, pz), (0, 1, 0), 48)
    for k in range(10):
        add_cyl(bm, mm(94), mm(5), (tx, py - 0.22 + k * 0.025, pz), (0, 1, 0), 48)
    add_box(bm, (mm(90), mm(100), mm(70)), (tx, py - 0.1, pz + mm(120)))
    add_cyl(bm, mm(80), mm(30), (tx, py - 0.275, pz), (0, 1, 0), 40)
    finish("Electrobomba_Motor", bm, paint, col, bevel=mm(1))
    bm = bmesh.new()
    add_cyl(bm, mm(105), mm(80), (tx, py + 0.04, pz), (0, 1, 0), 48)
    add_cyl(bm, mm(26), mm(110), (tx, py + 0.14, pz), (0, 1, 0), 32)
    add_cyl(bm, mm(22), mm(120), (tx, py + 0.04, pz + mm(150)), (0, 0, 1), 32)
    add_cyl(bm, mm(36), mm(14), (tx, py + 0.20, pz), (0, 1, 0), 32)
    add_cyl(bm, mm(32), mm(14), (tx, py + 0.04, pz + mm(212)), (0, 0, 1), 32)
    add_box(bm, (mm(220), mm(520), mm(20)), (tx, py - 0.1, mm(10)))
    finish("Electrobomba_Voluta", bm, cast, col, bevel=mm(1))
    # ventilador/acople visible que gira mientras la bomba trabaja
    bm = bmesh.new()
    add_cyl(bm, mm(30), mm(20), (0, 0, 0), (0, 1, 0), 24)
    for k in range(6):
        a = k * pi / 3
        mtx = Matrix.Translation((mm(55) * cos(a), 0, mm(55) * sin(a))) @ Matrix.Rotation(-a, 4, "Y")
        bmesh.ops.create_cube(bm, size=1.0, matrix=mtx @ Matrix.Diagonal((mm(60), mm(6), mm(18), 1.0)))
    fan = finish("Ventilador_Bomba", bm, m["blue"], col, smooth=False)
    fan.location = (tx, py - 0.31, pz)
    inlet = Vector((tx, py + 0.20, pz))
    outlet = Vector((tx, py + 0.04, pz + mm(220)))

    # --- cañerías: aspiración, impulsión al mandril y retorno del rebalse ---
    tank_out = Vector((tx, ty - TANK_R, pz))
    make_pipe("Caneria_Aspiracion", [tank_out, inlet], mm(23), m["pipe"], col, fillet=0.04)
    inlet_m = O + station["mandrel_inlet"]
    route = [outlet, Vector((tx, outlet.y, 0.45)), Vector((tx, inlet_m.y - 0.14, 0.45)), Vector((inlet_m.x, inlet_m.y - 0.14, 0.45)), Vector((inlet_m.x, inlet_m.y - 0.14, inlet_m.z)), inlet_m]
    make_pipe("Caneria_Impulsion_Mandril", route, mm(16), m["pipe"], col, fillet=0.07)
    d0 = O + station["drain_bottom"]
    hose = [d0, d0 + Vector((0, 0, -0.04)), Vector((d0.x, 0.52, d0.z - 0.04)), Vector((tx, 0.52, d0.z - 0.04)), Vector((tx, 0.52, top_z + 0.04)), Vector((tx, ty, top_z + 0.04)), Vector((tx, ty, top_z - 0.12))]
    make_pipe("Manguera_Rebalse", hose, mm(13), m["hose"], col, fillet=0.08)
    return {"col": col, "fan": fan}


def build_plc(root, station):
    """Tablero PLC con luces de salidas (Y1 matriz, Y2 mordaza, Y3 mandril, Y4 purga, K1 bomba) y botón START."""
    col = new_collection("06_PLC", root)
    use_parent(None)
    cab_mat = make_material("Tablero_Gris", (0.55, 0.57, 0.6), metallic=0.4, roughness=0.5)
    cx, cy_front = 1.35, -0.52
    cz = 1.25
    bm = bmesh.new()
    add_box(bm, (0.30, 0.26, 0.50), (cx, cy_front - 0.13, cz))
    add_box(bm, (0.20, 0.20, cz - 0.25), (cx, cy_front - 0.13, (cz - 0.25) / 2))
    add_box(bm, (0.30, 0.20, 0.08), (cx, cy_front - 0.13, cz + 0.29))  # isla de válvulas
    finish("Tablero_PLC", bm, cab_mat, col, smooth=False, bevel=mm(3))
    lights = {}
    spec = [("AUTO", (0.1, 0.9, 0.2)), ("Y1_MATRIZ", (1.0, 0.7, 0.1)), ("Y2_MORDAZA", (1.0, 0.7, 0.1)), ("Y3_MANDRIL", (1.0, 0.7, 0.1)), ("Y4_PURGA", (0.3, 0.7, 1.0)), ("K1_BOMBA", (0.3, 0.7, 1.0))]
    for i, (nm, rgb) in enumerate(spec):
        mat = make_material(f"Luz_{nm}", (0.1, 0.1, 0.1), emission=rgb, emission_strength=0.0)
        bm = bmesh.new()
        x = cx - 0.105 + (i % 3) * 0.105
        z = cz + 0.15 - (i // 3) * 0.07
        add_cyl(bm, mm(14), mm(10), (x, cy_front + 0.003, z), (0, 1, 0), 24)
        finish(f"Luz_{nm}", bm, mat, col)
        lights[nm] = mat
    bm = bmesh.new()
    add_cyl(bm, mm(20), mm(14), (0, 0, 0), (0, 1, 0), 24)
    start_mat = make_material("Boton_START", (0.1, 0.7, 0.2), roughness=0.4, emission=(0.1, 0.9, 0.2), emission_strength=0.6)
    btn = finish("Boton_START", bm, start_mat, col)
    btn.location = (cx - 0.07, cy_front + 0.003, cz - 0.04)
    bm = bmesh.new()
    add_cyl(bm, mm(20), mm(14), (cx + 0.02, cy_front + 0.003, cz - 0.04), (0, 1, 0), 24)
    add_cyl(bm, mm(26), mm(18), (cx + 0.09, cy_front + 0.003, cz - 0.04), (0, 1, 0), 24)
    finish("Botones_STOP_y_Emergencia", bm, make_material("Rojo_Pulsador", (0.8, 0.05, 0.05), roughness=0.4), col)
    # mangueras de aire de la isla de válvulas a los tres cilindros neumáticos
    air = make_material("Manguera_Aire", (0.1, 0.35, 0.9), roughness=0.5)
    O = STATION_O
    u = station["u"]
    die_rear = O + Vector((-mm(DIE_X), TUBE_Y0 + LEG + BR * sin(pi / 4), BR * (1 - cos(pi / 4)))) + u * 0.60
    clamp_rear = O + Vector((-mm(DIE_X), TUBE_Y0 + mm(105), 0.0)) + u * 0.54
    mand = O + Vector((0, -mm(1000), mm(55)))
    top = Vector((cx, cy_front - 0.13, cz + 0.34))
    make_pipe("Aire_Y1", [top, top + Vector((0, 0, 0.35)), Vector((die_rear.x, top.y + 0.1, top.z + 0.35)), Vector((die_rear.x, die_rear.y, top.z + 0.35)), die_rear], mm(4), air, col, fillet=0.08)
    make_pipe("Aire_Y2", [top, top + Vector((0, 0, 0.45)), Vector((clamp_rear.x, top.y, top.z + 0.45)), Vector((clamp_rear.x, clamp_rear.y, top.z + 0.45)), clamp_rear], mm(4), air, col, fillet=0.08)
    make_pipe("Aire_Y3", [top, top + Vector((0, 0, 0.55)), Vector((mand.x, top.y, top.z + 0.55)), Vector((mand.x, mand.y, top.z + 0.55)), mand + Vector((0, 0, 0.05))], mm(4), air, col, fillet=0.08)
    return {"lights": lights, "button": btn, "button_pos": Vector(btn.location), "front": Vector((cx - 0.07, cy_front, cz - 0.04))}


# ---- canastos, rack de caños fríos y mesa de atado ----
BASKET_A = (1.45, 0.95)  # centro (x, y) del canasto de piezas
BENCH_C = (1.45, 1.75)
BASKET_B = (1.45, 2.50)
STACK_DZ = 0.042  # separación vertical entre piezas apiladas
BASKET_Z = 0.55  # altura del piso de los canastos
BENCH_Z = 0.90


def build_wire_basket(name, center, size, z0, mat, col):
    cx, cy = center
    sx, sy, sz = size
    t = 0.008
    bm = bmesh.new()
    for i in range(0, int(sx / 0.1) + 1):  # fondo
        add_box(bm, (t, sy, t), (cx - sx / 2 + i * sx / max(1, int(sx / 0.1)), cy, z0))
    for j in range(0, int(sy / 0.1) + 1):
        add_box(bm, (sx, t, t), (cx, cy - sy / 2 + j * sy / max(1, int(sy / 0.1)), z0))
    for zz in (z0 + sz / 2, z0 + sz):  # aros
        add_box(bm, (sx, t, t), (cx, cy - sy / 2, zz))
        add_box(bm, (sx, t, t), (cx, cy + sy / 2, zz))
        add_box(bm, (t, sy, t), (cx - sx / 2, cy, zz))
        add_box(bm, (t, sy, t), (cx + sx / 2, cy, zz))
    for i in range(0, int(sx / 0.1) + 1):  # verticales de las paredes largas
        x = cx - sx / 2 + i * sx / max(1, int(sx / 0.1))
        for yy in (cy - sy / 2, cy + sy / 2):
            add_box(bm, (t, t, sz), (x, yy, z0 + sz / 2))
    for j in range(0, int(sy / 0.1) + 1):
        y = cy - sy / 2 + j * sy / max(1, int(sy / 0.1))
        for xx in (cx - sx / 2, cx + sx / 2):
            add_box(bm, (t, t, sz), (xx, y, z0 + sz / 2))
    finish(name, bm, mat, col, smooth=False, edge_split=False)
    bm = bmesh.new()
    for ex in (-1, 1):
        for ey in (-1, 1):
            add_box(bm, (0.05, 0.05, z0), (cx + ex * (sx / 2 - 0.03), cy + ey * (sy / 2 - 0.03), z0 / 2))
    add_box(bm, (sx, sy, 0.03), (cx, cy, z0 - 0.015))
    finish(name + "_Base", bm, make_material(name + "_Pintura", (0.08, 0.2, 0.42), metallic=0.3, roughness=0.45), col, smooth=False, bevel=mm(2))


def build_logistics(root, station):
    """Canasto de piezas, mesa de atado, canasto de paquetes y rack de caños fríos."""
    col = new_collection("07_Logistica", root)
    use_parent(None)
    wire = make_material("Alambre_Zincado", (0.7, 0.72, 0.75), metallic=1.0, roughness=0.35)
    build_wire_basket("Canasto_A_Piezas", BASKET_A, (0.60, 0.62, 0.50), BASKET_Z, wire, col)
    build_wire_basket("Canasto_B_Paquetes", BASKET_B, (0.60, 0.62, 0.50), BASKET_Z, wire, col)
    paint = make_material("Mesa_Pintura", (0.08, 0.2, 0.42), metallic=0.3, roughness=0.45)
    top = make_material("Mesa_Tablero", (0.55, 0.45, 0.32), roughness=0.7)
    bm = bmesh.new()
    add_box(bm, (0.70, 0.70, 0.04), (BENCH_C[0], BENCH_C[1], BENCH_Z - 0.02))
    finish("Mesa_Atado_Tablero", bm, top, col, smooth=False, bevel=mm(2))
    bm = bmesh.new()
    for ex in (-1, 1):
        for ey in (-1, 1):
            add_box(bm, (0.05, 0.05, BENCH_Z - 0.04), (BENCH_C[0] + ex * 0.32, BENCH_C[1] + ey * 0.32, (BENCH_Z - 0.04) / 2))
    finish("Mesa_Atado_Patas", bm, paint, col, smooth=False)
    # rack de caños fríos: estante con 6 caños azules a lo largo de Y
    bm = bmesh.new()
    rx, ry = 0.57, -1.07
    for ex in (-1, 1):
        for ey in (-1, 1):
            add_box(bm, (0.05, 0.05, 0.95), (rx + ex * 0.15, ry + ey * 0.40, 0.475))
    for z in (0.50, 0.90):
        add_box(bm, (0.36, 0.90, 0.03), (rx, ry, z))
    finish("Rack_Canos_Frios", bm, paint, col, smooth=False, bevel=mm(2))
    cold = temp_material("Cano_Frio_Rack", AMBIENT)
    bm = bmesh.new()
    for i in range(3):
        add_cyl(bm, mm(20), mm(860), (rx - 0.09 + i * 0.09, ry, 0.945), (0, 1, 0), 24)
    for i in range(2):
        add_cyl(bm, mm(20), mm(860), (rx - 0.045 + i * 0.09, ry, 0.985), (0, 1, 0), 24)
    finish("Canos_Frios_en_Rack", bm, cold, col)
    return {"col": col, "cold_mat": cold}


def strap_mesh(name, y_local, clear, mat, col):
    """Zuncho en el sistema local de las piezas: anillo rectangular alrededor de la pila (en x local) a lo largo del tramo recto."""
    t = 0.006
    x_min, x_max = -(9 * STACK_DZ + 0.02 + clear), 0.02 + clear
    z_h = 0.02 + clear
    bm = bmesh.new()
    add_box(bm, (x_max - x_min + t, 0.014, t), ((x_max + x_min) / 2, y_local, z_h))
    add_box(bm, (x_max - x_min + t, 0.014, t), ((x_max + x_min) / 2, y_local, -z_h))
    add_box(bm, (t, 0.014, 2 * z_h), (x_max, y_local, 0))
    add_box(bm, (t, 0.014, 2 * z_h), (x_min, y_local, 0))
    return finish(name, bm, mat, col, smooth=False, edge_split=False)


# ============================================================================================
# 4. Operario (humanoide procedural articulado)
# ============================================================================================

L1, L2 = 0.30, 0.27  # brazo y antebrazo
HIP_Z = 0.90
SPINE_Z = 0.95
SH_L = Vector((0.0, 0.21, 0.52))  # hombros en el sistema de la columna
SH_R = Vector((0.0, -0.21, 0.52))


class Operator:
    pass


def build_operator(root):
    col = new_collection("05_Operario", root)
    use_parent(None)
    mats = {
        "overall": make_material("Op_Mameluco", (0.06, 0.22, 0.5), roughness=0.7),
        "skin": make_material("Op_Piel", (0.85, 0.62, 0.48), roughness=0.6),
        "hat": make_material("Op_Casco", (0.95, 0.8, 0.05), roughness=0.4),
        "glove": make_material("Op_Guante", (0.9, 0.35, 0.05), roughness=0.6),
        "boot": make_material("Op_Botas", (0.05, 0.05, 0.05), roughness=0.5),
    }
    op = Operator()
    op.root = make_empty("Operario_Raiz", col, (ST_A[0], ST_A[1], 0.0), size=0.2)
    use_parent(op.root)
    bm = bmesh.new()
    add_box(bm, (0.26, 0.40, 0.18), (0, 0, 0.93))
    finish("Op_Pelvis", bm, mats["overall"], col, smooth=False, bevel=mm(8))
    op.spine = make_empty("Op_Columna", col, (0, 0, SPINE_Z), size=0.05, parent=op.root)
    use_parent(op.spine)
    bm = bmesh.new()
    add_box(bm, (0.24, 0.44, 0.56), (0, 0, 0.30))
    finish("Op_Torso", bm, mats["overall"], col, smooth=False, bevel=mm(10))
    bm = bmesh.new()
    add_cyl(bm, 0.05, 0.08, (0, 0, 0.62), (0, 0, 1), 16)
    add_sphere(bm, 0.11, (0.0, 0, 0.74), 20, 12)
    finish("Op_Cabeza", bm, mats["skin"], col)
    bm = bmesh.new()
    add_cyl(bm, 0.125, 0.09, (0, 0, 0.80), (0, 0, 1), 24)
    add_cyl(bm, 0.17, 0.012, (0.02, 0, 0.765), (0, 0, 1), 24)
    finish("Op_Casco", bm, mats["hat"], col)

    def arm(side, nm):
        sh = make_empty(f"Op_Hombro_{nm}", col, (0.0, 0.21 * side, 0.52), size=0.03, parent=op.spine)
        sh.rotation_mode = "QUATERNION"
        use_parent(sh)
        bm = bmesh.new()
        add_sphere(bm, 0.055, (0, 0, 0), 12, 8)
        add_cyl(bm, 0.045, L1, (0, 0, L1 / 2), (0, 0, 1), 16)
        finish(f"Op_Brazo_{nm}", bm, mats["overall"], col)
        el = make_empty(f"Op_Codo_{nm}", col, (0, 0, L1), size=0.03, parent=sh)
        el.rotation_mode = "QUATERNION"
        use_parent(el)
        bm = bmesh.new()
        add_sphere(bm, 0.045, (0, 0, 0), 12, 8)
        add_cyl(bm, 0.038, L2, (0, 0, L2 / 2), (0, 0, 1), 16)
        finish(f"Op_Antebrazo_{nm}", bm, mats["overall"], col)
        bm = bmesh.new()
        add_sphere(bm, 0.052, (0, 0, L2), 12, 8)
        finish(f"Op_Mano_{nm}", bm, mats["glove"], col)
        return sh, el

    op.sh_l, op.el_l = arm(+1, "L")
    op.sh_r, op.el_r = arm(-1, "R")

    def leg(side, nm):
        hip = make_empty(f"Op_Cadera_{nm}", col, (0, 0.10 * side, HIP_Z), size=0.04, parent=op.root)
        use_parent(hip)
        bm = bmesh.new()
        add_cyl(bm, 0.075, 0.45, (0, 0, -0.225), (0, 0, 1), 16)
        finish(f"Op_Muslo_{nm}", bm, mats["overall"], col)
        knee = make_empty(f"Op_Rodilla_{nm}", col, (0, 0, -0.45), size=0.04, parent=hip)
        use_parent(knee)
        bm = bmesh.new()
        add_cyl(bm, 0.06, 0.45, (0, 0, -0.225), (0, 0, 1), 16)
        finish(f"Op_Pierna_{nm}", bm, mats["overall"], col)
        bm = bmesh.new()
        add_box(bm, (0.26, 0.11, 0.07), (0.07, 0, -0.415))
        finish(f"Op_Bota_{nm}", bm, mats["boot"], col, smooth=False, bevel=mm(6))
        return hip, knee

    op.hip_l, op.knee_l = leg(+1, "L")
    op.hip_r, op.knee_r = leg(-1, "R")
    use_parent(None)
    return op


def arm_ik(sh, tgt, side):
    """IK de dos huesos en el sistema de la columna. Devuelve (q_hombro, q_codo_local); la mano se queda corta si no alcanza."""
    v = tgt - sh
    d = v.length
    dmax = (L1 + L2) * 0.999
    if d > dmax:
        v = v * (dmax / d)
        d = dmax
    if d < 0.08:
        v = (v.normalized() if d > 1e-6 else Vector((1.0, 0.0, 0.0))) * 0.08
        d = 0.08
    vh = v / d
    ca = max(-1.0, min(1.0, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))
    a = math.acos(ca)
    pole = Vector((0.0, 0.5 * side, -1.0))
    pp = pole - vh * pole.dot(vh)
    if pp.length < 1e-6:
        pp = Vector((0.0, 0.0, -1.0))
    pp.normalize()
    elbow = sh + (vh * cos(a) + pp * sin(a)) * L1
    d1 = (elbow - sh).normalized()
    d2 = ((sh + v) - elbow).normalized()
    q1 = Vector((0, 0, 1)).rotation_difference(d1)
    q2 = Vector((0, 0, 1)).rotation_difference(q1.inverted() @ d2)
    return q1, q2


def solve_arms(root_xy, yaw, tl, tr):
    """Inclina la columna hacia adelante lo necesario para alcanzar ambos blancos y resuelve los dos brazos."""
    inv = Matrix.Rotation(-yaw, 3, "Z")
    base = Vector((root_xy[0], root_xy[1], 0.0))
    ll, lr = inv @ (tl - base), inv @ (tr - base)
    hip = Vector((0.0, 0.0, SPINE_Z))
    chosen = None
    for k in range(10):
        beta = 0.1 * k
        ri = Matrix.Rotation(-beta, 3, "Y")
        sl, sr = ri @ (ll - hip), ri @ (lr - hip)
        chosen = (beta, sl, sr)
        if (sl - SH_L).length <= 0.97 * (L1 + L2) and (sr - SH_R).length <= 0.97 * (L1 + L2):
            break
    beta, sl, sr = chosen
    return beta, arm_ik(SH_L, sl, +1), arm_ik(SH_R, sr, -1)


def key_operator(op, f, plan, state):
    t = (f - 1) / FPS
    x, y, yaw = plan.root.at(t)
    tl, tr = plan.hand_l.at(t), plan.hand_r.at(t)
    # caminata: la fase avanza con la distancia recorrida
    dt = (f - state["f"]) / FPS if state["f"] is not None else 0.0
    dist = math.hypot(x - state["x"], y - state["y"]) if state["f"] is not None else 0.0
    speed = dist / dt if dt > 1e-6 else 0.0
    amp = clamp01((speed - 0.1) / 0.4)
    state["phase"] += 2 * pi * dist / 0.8
    state["x"], state["y"], state["f"] = x, y, f
    sw = 0.45 * amp * sin(state["phase"])
    kn_l = 0.7 * amp * max(0.0, sin(state["phase"] + pi / 2))
    kn_r = 0.7 * amp * max(0.0, -sin(state["phase"] + pi / 2))
    op.root.location = (x, y, 0.0)
    op.root.rotation_euler = (0.0, 0.0, yaw)
    op.hip_l.rotation_euler = (0.0, -sw, 0.0)
    op.hip_r.rotation_euler = (0.0, sw, 0.0)
    op.knee_l.rotation_euler = (0.0, kn_l, 0.0)
    op.knee_r.rotation_euler = (0.0, kn_r, 0.0)
    beta, (q1l, q2l), (q1r, q2r) = solve_arms((x, y), yaw, tl, tr)
    op.spine.rotation_euler = (0.0, beta, 0.0)
    op.sh_l.rotation_quaternion = q1l
    op.el_l.rotation_quaternion = q2l
    op.sh_r.rotation_quaternion = q1r
    op.el_r.rotation_quaternion = q2r
    for ob, path in (
        (op.root, "location"),
        (op.root, "rotation_euler"),
        (op.hip_l, "rotation_euler"),
        (op.hip_r, "rotation_euler"),
        (op.knee_l, "rotation_euler"),
        (op.knee_r, "rotation_euler"),
        (op.spine, "rotation_euler"),
        (op.sh_l, "rotation_quaternion"),
        (op.el_l, "rotation_quaternion"),
        (op.sh_r, "rotation_quaternion"),
        (op.el_r, "rotation_quaternion"),
    ):
        ob.keyframe_insert(path, frame=f)


# ============================================================================================
# 5. Guion: pistas de tiempo (operario, manos, objetos) y ciclos
# ============================================================================================


class Track:
    """Valor por tramos: cada tramo (t0, t1, fn(u, t)); fuera de un tramo se mantiene el último valor."""

    def __init__(self):
        self.segs = []
        self._t0 = []

    def add(self, t0, t1, fn):
        self.segs.append((t0, t1, fn))

    def finalize(self):
        self.segs.sort(key=lambda s: s[0])
        self._t0 = [s[0] for s in self.segs]

    def at(self, t):
        i = bisect.bisect_right(self._t0, t) - 1
        if i < 0:
            i = 0
        t0, t1, fn = self.segs[i]
        return fn(clamp01((t - t0) / max(1e-6, t1 - t0)), t)


class Cycle:
    pass


def lerp3(a, b, k):
    return tuple(a[i] + (b[i] - a[i]) * k for i in range(3))


def root_seg(track, t0, t1, p0, p1):
    track.add(t0, t1, lambda u, t, p0=p0, p1=p1: lerp3(p0, p1, smoothstep(u)))


def root_hold(track, t, p):
    track.add(t, t + 0.01, lambda u, t_, p=p: p)


# ---- anclas para manos y poses de objetos ----
def A_world(x, y, z):
    v = Vector((x, y, z))
    return lambda t: v


def A_root(plan, dx, dy, dz):
    def f(t):
        x, y, yaw = plan.root.at(t)
        return Vector((x, y, 0.0)) + Matrix.Rotation(yaw, 3, "Z") @ Vector((dx, dy, dz))

    return f


def A_idle(plan, side):
    return A_root(plan, 0.12, 0.21 * side, 0.95)


def A_grip(plan, pair_fn, side):
    """Punto de agarre (de dos) más cercano al lado izquierdo/derecho del operario en el instante t."""

    def f(t):
        pa, pb = pair_fn(t)
        x, y, yaw = plan.root.at(t)
        left = Vector((-sin(yaw), cos(yaw), 0.0))
        base = Vector((x, y, 0.0))
        a_left = (pa - base).dot(left) >= (pb - base).dot(left)
        if side > 0:
            return pa if a_left else pb
        return pb if a_left else pa

    return f


def pair_from_pose(track, la, lb):
    """Agarres en coordenadas locales la/lb de un objeto con pista de pose (pos, euler)."""

    def f(t):
        pos, eul = track.at(t)
        M = Euler(eul, "XYZ").to_matrix()
        return pos + M @ Vector(la), pos + M @ Vector(lb)

    return f


def hand_follow(track, t0, t1, anchor):
    track.add(t0, t1, lambda u, t, a=anchor: a(t))


def hand_move(track, t0, t1, a, b):
    track.add(t0, t1, lambda u, t, a=a, b=b: a(t).lerp(b(t), smoothstep(u)))


def P_const(pos, eul):
    p = Vector(pos)
    return lambda t: (p, eul)


def P_root(plan, off, tilt=0.0):
    def f(t):
        x, y, yaw = plan.root.at(t)
        return Vector((x, y, 0.0)) + Matrix.Rotation(yaw, 3, "Z") @ Vector(off), (tilt, 0.0, yaw)

    return f


def pose_seg(track, t0, t1, pa, pb):
    def fn(u, t, pa=pa, pb=pb):
        a, b = pa(t), pb(t)
        k = smoothstep(u)
        return a[0].lerp(b[0], k), lerp3(a[1], b[1], k)

    track.add(t0, t1, fn)


def pose_follow(track, t0, t1, p):
    track.add(t0, t1, lambda u, t, p=p: p(t))


def const_track(pos, eul):
    tr = Track()
    tr.add(0.0, 1.0, lambda u, t, p=Vector(pos), e=eul: (p, e))
    tr.finalize()
    return tr


CARRY = (0.22, 0.0, 1.10)  # caño cargado delante del vientre (sistema del operario)
GRIP_TUBE = ((-0.06, 0.25, 0.0), (-0.06, -0.25, 0.0))
GRIP_PIECE = ((-0.06, -0.16, 0.0), (-0.06, -0.38, 0.0))
PIECE_CARRY = (0.34, 0.28, 1.00)


def stack_origin(base_xy, z0, k):
    """Origen (centro del caño en y=0) de la pieza k apilada, apoyada en un canasto o mesa."""
    return Vector((base_xy[0] - 0.21, base_xy[1] + 0.18, z0 + 0.03 + k * STACK_DZ))


def build_plan(n_pieces):
    G = GEO
    P = Plan()
    P.root, P.hand_l, P.hand_r = Track(), Track(), Track()
    P.hot, P.cold = Track(), Track()
    P.pieces = [Track() for _ in range(n_pieces)]
    P.cycles = []
    P.bundles = []
    root_hold(P.root, 0.0, ST_A)
    hand_follow(P.hand_l, 0.0, 0.01, A_idle(P, +1))
    hand_follow(P.hand_r, 0.0, 0.01, A_idle(P, -1))

    T = INTRO_S
    prev_pack = False
    for c in range(n_pieces):
        pack = ((c + 1) % PACK_EVERY == 0)
        cy = Cycle()
        cy.c, cy.T, cy.pack = c, T, pack
        cy.L = G.cycle
        rel = {k: ((T + v[0], T + v[1]) if isinstance(v, tuple) else T + v) for k, v in REL.items()}
        cy.t = rel
        m_pick = (c + 1 - G.pick_j) % SLOTS
        m_load = (c + 1) % SLOTS
        cy.m_pick, cy.m_load = m_pick, m_load

        # ---------- operario: recorrido del ciclo ----------
        if c > 0 and not prev_pack:
            root_seg(P.root, T, T + 0.7, ST_BASKET_A, (WP_LANE[0], WP_LANE[1], 0.0))
            root_seg(P.root, T + 0.7, T + 1.5, (WP_LANE[0], WP_LANE[1], 0.0), ST_A)
        root_seg(P.root, T + 3.5, T + 5.7, ST_A, ST_B)
        root_seg(P.root, T + 7.2, T + 7.6, ST_B, ST_PLC)
        root_seg(P.root, T + 8.0, T + 8.6, ST_PLC, (WP_RACK[0], WP_RACK[1], -pi))
        root_seg(P.root, T + 8.6, T + 9.7, (WP_RACK[0], WP_RACK[1], -pi), ST_RACK)
        root_seg(P.root, T + 10.7, T + 11.3, ST_RACK, (WP_RACK[0], WP_RACK[1], -pi))
        root_seg(P.root, T + 11.3, T + 12.7, (WP_RACK[0], WP_RACK[1], -pi), ST_A)
        root_seg(P.root, T + 14.2, T + 15.9, ST_A, ST_B)
        root_seg(P.root, T + 22.8, T + 23.5, ST_B, (WP_LANE[0], WP_LANE[1], 0.0))
        root_seg(P.root, T + 23.5, T + 24.2, (WP_LANE[0], WP_LANE[1], 0.0), ST_BASKET_A)

        # ---------- caño caliente: sale del carrusel, va a la matriz ----------
        slot_pos = slot_world(m_pick, c + 1)
        slot_pose = P_const(slot_pos, (G.tilt, 0.0, 0.0))
        pick_track = Track()
        pick_track.add(0.0, 1.0, lambda u, t, p=slot_pos, e=(G.tilt, 0.0, 0.0): (p, e))
        pick_track.finalize()
        cy.slot_pos = slot_pos
        pose_seg(P.hot, rel["swap"], rel["pick_end"], slot_pose, P_root(P, CARRY))
        pose_follow(P.hot, rel["pick_end"], rel["carry_end"], P_root(P, CARRY))
        pose_seg(P.hot, rel["carry_end"], rel["place_end"], P_root(P, CARRY), P_const(tuple(STATION_O), (0.0, 0.0, 0.0)))
        # manos: alcanzar la vaina, seguirla, soltarla y tocar START
        hand_move(P.hand_l, rel["reach"][0], rel["reach"][1], A_idle(P, +1), A_grip(P, pair_from_pose(pick_track, *GRIP_TUBE), +1))
        hand_move(P.hand_r, rel["reach"][0], rel["reach"][1], A_idle(P, -1), A_grip(P, pair_from_pose(pick_track, *GRIP_TUBE), -1))
        gl = A_grip(P, pair_from_pose(P.hot, *GRIP_TUBE), +1)
        gr = A_grip(P, pair_from_pose(P.hot, *GRIP_TUBE), -1)
        hand_follow(P.hand_l, rel["swap"], rel["place_end"], gl)
        hand_follow(P.hand_r, rel["swap"], rel["place_end"], gr)
        btn = A_world(*STATION_BTN_FRONT)
        hand_move(P.hand_l, rel["place_end"], rel["place_end"] + 0.6, gl, A_idle(P, +1))
        hand_move(P.hand_r, rel["press"][0], rel["press"][0] + 0.5, gr, btn)
        hand_follow(P.hand_r, rel["press"][0] + 0.5, rel["start"], btn)
        hand_move(P.hand_r, rel["start"], rel["start"] + 0.5, btn, A_idle(P, -1))

        # ---------- carga de un caño frío en el carrusel (durante el ciclo de la máquina) ----------
        cold_rack = P_const((0.57, -1.07, 0.95), (0.0, 0.0, 0.0))
        cold_track = Track()
        cold_track.add(0.0, 1.0, lambda u, t, p=Vector((0.57, -1.07, 0.95)): (p, (0.0, 0.0, 0.0)))
        cold_track.finalize()
        load_pos = slot_world(m_load, c + 1)
        t_r0, t_r1 = rel["rack"]
        hand_move(P.hand_l, t_r0, t_r0 + 0.5, A_idle(P, +1), A_grip(P, pair_from_pose(cold_track, *GRIP_TUBE), +1))
        hand_move(P.hand_r, t_r0, t_r0 + 0.5, A_idle(P, -1), A_grip(P, pair_from_pose(cold_track, *GRIP_TUBE), -1))
        pose_seg(P.cold, t_r0 + 0.5, t_r1, cold_rack, P_root(P, CARRY))
        pose_follow(P.cold, t_r1, rel["carry_cold"][1], P_root(P, CARRY))
        pose_seg(P.cold, rel["load"][0], rel["load"][1], P_root(P, CARRY), P_const(tuple(load_pos), (G.tilt, 0.0, 0.0)))
        cgl = A_grip(P, pair_from_pose(P.cold, *GRIP_TUBE), +1)
        cgr = A_grip(P, pair_from_pose(P.cold, *GRIP_TUBE), -1)
        hand_follow(P.hand_l, t_r0 + 0.5, rel["load"][1], cgl)
        hand_follow(P.hand_r, t_r0 + 0.5, rel["load"][1], cgr)
        hand_move(P.hand_l, rel["load"][1], rel["load"][1] + 0.5, cgl, A_idle(P, +1))
        hand_move(P.hand_r, rel["load"][1], rel["load"][1] + 0.5, cgr, A_idle(P, -1))

        # ---------- pieza formada: se retira de la matriz y va al canasto ----------
        die_pose = const_track(tuple(STATION_O), (0.0, 0.0, 0.0))
        t_e0, t_e1 = rel["extract"]
        hand_move(P.hand_l, t_e0 - 0.7, t_e0, A_idle(P, +1), A_grip(P, pair_from_pose(die_pose, *GRIP_PIECE), +1))
        hand_move(P.hand_r, t_e0 - 0.7, t_e0, A_idle(P, -1), A_grip(P, pair_from_pose(die_pose, *GRIP_PIECE), -1))
        pk = P.pieces[c]
        pose_seg(pk, t_e0, t_e1, P_const(tuple(STATION_O), (0.0, 0.0, 0.0)), P_root(P, PIECE_CARRY))
        pose_follow(pk, rel["to_basket"][0], rel["to_basket"][1], P_root(P, PIECE_CARRY))
        stack_k = c % PACK_EVERY
        a_org = stack_origin(BASKET_A, BASKET_Z, stack_k)
        pose_seg(pk, rel["drop"][0], rel["drop"][1], P_root(P, PIECE_CARRY), P_const(tuple(a_org), (0.0, pi / 2, 0.0)))
        pgl = A_grip(P, pair_from_pose(pk, *GRIP_PIECE), +1)
        pgr = A_grip(P, pair_from_pose(pk, *GRIP_PIECE), -1)
        hand_follow(P.hand_l, t_e0, rel["drop"][1] - 0.2, pgl)
        hand_follow(P.hand_r, t_e0, rel["drop"][1] - 0.2, pgr)
        hand_move(P.hand_l, rel["drop"][1] - 0.2, rel["drop"][1] + 0.3, pgl, A_idle(P, +1))
        hand_move(P.hand_r, rel["drop"][1] - 0.2, rel["drop"][1] + 0.3, pgr, A_idle(P, -1))
        cy.stack_origin = a_org

        end = T + CYCLE_S
        if pack:
            end = add_pack(P, cy, end, c)
            cy.L = end - T
        else:
            cy.L = max(G.cycle, CYCLE_S)
            end = T + cy.L
        P.cycles.append(cy)
        T = end
        prev_pack = pack
    P.t_end = T
    for tr in [P.root, P.hand_l, P.hand_r, P.hot, P.cold] + P.pieces:
        tr.finalize()
    for b in P.bundles:
        b["track"].finalize()
    return P


STATION_BTN_FRONT = (1.28, -0.54, 1.21)  # posición mundial del botón START (se ajusta en main con el tablero real)


def add_pack(P, cy, t_d, c):
    """Pausa de la línea: el operario ata el paquete de 10 y lo reserva en el canasto de paquetes. Devuelve el inicio del próximo ciclo."""
    pk = PACK
    p_idx = len(P.bundles)
    first = c - (PACK_EVERY - 1)
    g0 = t_d
    g1 = g0 + pk["grab"]
    c1 = g1 + pk["carry"]
    p1 = c1 + pk["place"]
    tie_end = p1 + 2 * pk["tie"]
    l1 = tie_end + pk["lift"]
    q1 = l1 + pk["carry2"]
    q2 = q1 + pk["place2"]
    b_org = stack_origin(BASKET_A, BASKET_Z, 0)
    bench_org = stack_origin(BENCH_C, BENCH_Z, 0)
    bb_org = stack_origin(BASKET_B, BASKET_Z, 0) + Vector((0, 0, p_idx * 0.45))
    bundle = Track()
    BUN_CARRY = (0.30, 0.18, 0.95)
    pose_seg(bundle, g0, g1, P_const(tuple(b_org), (0.0, 0.0, 0.0)), P_root(P, BUN_CARRY))
    pose_follow(bundle, g1, c1, P_root(P, BUN_CARRY))
    pose_seg(bundle, c1, p1, P_root(P, BUN_CARRY), P_const(tuple(bench_org), (0.0, 0.0, 0.0)))
    pose_follow(bundle, p1, tie_end, P_const(tuple(bench_org), (0.0, 0.0, 0.0)))
    pose_seg(bundle, tie_end, l1, P_const(tuple(bench_org), (0.0, 0.0, 0.0)), P_root(P, BUN_CARRY))
    pose_follow(bundle, l1, q1, P_root(P, BUN_CARRY))
    pose_seg(bundle, q1, q2, P_root(P, BUN_CARRY), P_const(tuple(bb_org), (0.0, 0.0, 0.0)))
    pose_follow(bundle, q2, q2 + 0.01, P_const(tuple(bb_org), (0.0, 0.0, 0.0)))
    P.bundles.append({"track": bundle, "g0": g0, "tie": (p1, tie_end), "end": q2, "first": first, "org": bb_org})
    cy.bundle = P.bundles[-1]

    def bundle_piece_pose(i):
        def f(u, t):
            pos, eul = bundle.at(t)
            return pos + Vector((0, 0, i * STACK_DZ)), (0.0, pi / 2, eul[2])

        return f

    for i in range(PACK_EVERY):
        P.pieces[first + i].add(g0, q2, bundle_piece_pose(i))
        P.pieces[first + i].add(q2, q2 + 0.01, lambda u, t, p=bb_org + Vector((0, 0, i * STACK_DZ)): (p, (0.0, pi / 2, 0.0)))

    # --- recorrido y manos ---
    root_hold(P.root, g0, ST_BASKET_A)
    root_seg(P.root, g1, c1, ST_BASKET_A, ST_BENCH)
    root_seg(P.root, l1, q1, ST_BENCH, ST_BASKET_B)
    root_seg(P.root, q2, q2 + 2.2, ST_BASKET_B, (WP_LANE[0], WP_LANE[1], 0.0))
    root_seg(P.root, q2 + 2.2, q2 + pk["walk"], (WP_LANE[0], WP_LANE[1], 0.0), ST_A)

    def bundle_pair(t):
        pos, eul = bundle.at(t)
        R = Matrix.Rotation(eul[2], 3, "Z")
        return pos + R @ Vector((-0.07, -0.34, 0.20)), pos + R @ Vector((-0.07, -0.12, 0.20))

    bl, br = A_grip(P, bundle_pair, +1), A_grip(P, bundle_pair, -1)
    hand_move(P.hand_l, g0, g0 + 0.5, A_idle(P, +1), bl)
    hand_move(P.hand_r, g0, g0 + 0.5, A_idle(P, -1), br)
    hand_follow(P.hand_l, g0 + 0.5, q2, bl)
    hand_follow(P.hand_r, g0 + 0.5, q2, br)
    # atado: las manos giran alrededor del paquete mientras se colocan dos zunchos
    t_a0 = p1

    def tie_hand(side):
        def f(t):
            pos, eul = bundle.at(t)
            ph = (t - t_a0) * 5.0
            return pos + Vector((-0.10 + 0.05 * cos(ph + side * pi / 2), -0.22 + 0.10 * side * sin(ph), 0.20 + 0.04 * sin(ph * 0.5)))

        return f

    hand_follow(P.hand_l, p1, tie_end, tie_hand(+1))
    hand_follow(P.hand_r, p1, tie_end, tie_hand(-1))
    hand_follow(P.hand_l, tie_end, q2, bl)
    hand_follow(P.hand_r, tie_end, q2, br)
    hand_move(P.hand_l, q2, q2 + 0.5, bl, A_idle(P, +1))
    hand_move(P.hand_r, q2, q2 + 0.5, br, A_idle(P, -1))
    cy.pack_t = dict(g0=g0, g1=g1, c1=c1, p1=p1, tie_end=tie_end, l1=l1, q1=q1, q2=q2)
    return q2 + pk["walk"] - REL["index"][1]


class Plan:
    pass


INTRO_S = 10.0


# ============================================================================================
# 6. Animación de la celda
# ============================================================================================


def thermal_plan(plan):
    """Temperaturas de cada vaina por ciclo (usa la duración real de cada intervalo, incluidas las pausas de atado)."""
    G = GEO
    temp = {}
    for m in range(SLOTS):
        j = (-m) % SLOTS
        temp[m] = G.S[j] if j <= G.pick_j - 1 else AMBIENT
    for cy in plan.cycles:
        info = {}
        for m in range(SLOTS):
            j = (cy.c + 1 - m) % SLOTS
            if j == 0:
                temp[m] = AMBIENT
                info[m] = (j, AMBIENT, AMBIENT)
            elif 1 <= j <= G.pick_j - 1:
                f = slot_fraction((-j * STEP_DEG) % 360.0, G.axis_a, G.level_z)
                t0 = temp[m]
                t1 = carousel_step(t0, f, cy.L, BATH_TEMP, AMBIENT, G.tau)
                info[m] = (j, t0, t1)
                temp[m] = t1
            elif j == G.pick_j:
                info[m] = (j, temp[m], temp[m])
                cy.pick_temp = temp[m]
            else:
                info[m] = (j, AMBIENT, AMBIENT)
        cy.slot_info = info


def animate_carousel(plan, bath):
    G = GEO
    rotor, tubes = bath["rotor"], bath["tubes"]
    mats = [t.data.materials[0] for t in tubes]
    rotor.rotation_euler = (0, 0, 0)
    rotor.keyframe_insert("rotation_euler", frame=1)
    for m in range(SLOTS):
        j = (-m) % SLOTS
        vis = j <= G.pick_j - 1
        set_vis(tubes[m], 1, vis)
        set_tube_temp(mats[m], G.S[j] if vis else AMBIENT, frame=1)
    for cy in plan.cycles:
        a, b = F(cy.t["index"][0]), F(cy.t["index"][1])
        phi0 = -radians(STEP_DEG) * cy.c
        rotor.rotation_euler = (0, phi0, 0)
        rotor.keyframe_insert("rotation_euler", frame=a)
        rotor.rotation_euler = (0, phi0 - radians(STEP_DEG), 0)
        rotor.keyframe_insert("rotation_euler", frame=b)
        f_a, f_b = F(cy.T), F(cy.T + cy.L)
        for m in range(SLOTS):
            j, t0, t1 = cy.slot_info[m]
            if j == 0:
                set_vis(tubes[m], f_a, False)
                set_vis(tubes[m], F(cy.t["load"][1]), True)
                set_tube_temp(mats[m], AMBIENT, frame=f_a)
                set_tube_temp(mats[m], AMBIENT, frame=f_b)
            elif 1 <= j <= G.pick_j - 1:
                set_tube_temp(mats[m], t0, frame=f_a)
                set_tube_temp(mats[m], t1, frame=f_b)
            elif j == G.pick_j:
                set_tube_temp(mats[m], t0, frame=f_a)
                set_vis(tubes[m], F(cy.t["swap"]), False)
    last = plan.cycles[-1]
    rotor.rotation_euler = (0, -radians(STEP_DEG) * len(plan.cycles), 0)
    rotor.keyframe_insert("rotation_euler", frame=F(last.T + last.L))


def animate_machine(plan, station, bath, tank, plc):
    """Matrices, mordaza, mandril, vaso, agua, luces del PLC, bomba y la curva Bézier del caño."""
    st = station
    open_vec = st["open_vec"]
    lights = plc["lights"]
    # estado inicial
    for ob in (st["moving"], st["die_rod"], st["clamp"], st["clamp_rod"]):
        key_loc(ob, 1, open_vec)
    key_loc(st["mandrel"], 1, (0, 0, 0))
    key_loc(st["cup"], 1, (0, 0, 0))
    st["water"].scale = (1, 1, 0.001)
    st["water"].keyframe_insert("scale", frame=1)
    for mat in lights.values():
        set_glow(mat, 0.0, 1)
    plc["button"].keyframe_insert("location", frame=1)
    tank["fan"].rotation_euler = (0, 0, 0)
    tank["fan"].keyframe_insert("rotation_euler", frame=1)

    hot_mat = temp_material("Cano_Conformado_Caliente", GEO.S[-1])
    hot_ob, hot_sp, ss = make_tube_curve(st, "Cano_Conformado", hot_mat)
    set_vis(hot_ob, 1, False)
    y_tip_final = Y_TIP0 + mm(MANDREL_STROKE)
    stroke = mm(MANDREL_STROKE)
    pieces = []
    for k in range(len(plan.pieces)):
        pm = temp_material(f"Material_Pieza_{k + 1:02d}", DEMOLD_TEMP)
        pob, psp, _ = make_tube_curve(st, f"Pieza_{k + 1:02d}", pm)
        pose_tube(psp, ss, 1.0)
        for i, bp in enumerate(psp.bezier_points):
            bp.radius = bell_factor(ss[i], y_tip_final)
        set_vis(pob, 1, False)
        pieces.append(pob)

    for cy in plan.cycles:
        t = cy.t
        c = cy.c
        # --- visibilidad del caño caliente y de la pieza ---
        set_vis(hot_ob, F(t["swap"]) - 1, False)
        set_vis(hot_ob, F(t["swap"]), True)
        set_vis(hot_ob, F(t["extract"][0]), False)
        set_vis(pieces[c], F(t["extract"][0]) - 1, False)
        set_vis(pieces[c], F(t["extract"][0]), True)
        # --- forma y color del caño caliente ---
        pose_tube(hot_sp, ss, 0.0)
        key_tube(hot_sp, F(t["swap"]))
        key_tube(hot_sp, F(t["place_end"]))
        T_pick = getattr(cy, "pick_temp", GEO.S[-1])
        set_tube_temp(hot_mat, T_pick, frame=F(t["swap"]))
        set_tube_temp(hot_mat, T_pick - 2.0, frame=F(t["start"]))
        a, b = F(t["die_close"][0]), F(t["die_close"][1])
        n_k = max(4, (b - a) // 2)
        for i in range(n_k + 1):
            pose_tube(hot_sp, ss, smoothstep(i / n_k))
            key_tube(hot_sp, a + round((b - a) * i / n_k), with_radius=False)
        a, b = F(t["mandrel"][0]), F(t["mandrel"][1])
        approach_end = a + int(round(1.0 * FPS))
        done = [1.0] * len(ss)
        n_k = max(6, (b - a) // 2)
        for i in range(n_k + 1):
            f = a + round((b - a) * i / n_k)
            if f <= approach_end:
                adv = stroke * 0.85 * smoothstep((f - a) / max(1, approach_end - a))
            else:
                adv = stroke * (0.85 + 0.15 * smoothstep((f - approach_end) / max(1, b - approach_end)))
            for k, bp in enumerate(hot_sp.bezier_points):
                done[k] = max(done[k], bell_factor(ss[k], Y_TIP0 + adv))
                bp.radius = done[k]
                if k < 9:
                    bp.keyframe_insert("radius", frame=f)
        # enfriamiento: decaimiento exponencial hasta DEMOLD_TEMP al terminar el agua+purga
        a, b = F(t["water"][0]), F(t["purge"][1])
        t_w = 22.0
        tc0 = T_pick - 4.0
        tau = (b - a) / FPS / math.log((tc0 - t_w) / (DEMOLD_TEMP - t_w))
        n_k = max(6, int((b - a) / FPS))
        for i in range(n_k + 1):
            f = a + round((b - a) * i / n_k)
            set_tube_temp(hot_mat, t_w + (tc0 - t_w) * exp(-((f - a) / FPS) / tau), frame=f)
        # --- matriz, mordaza y mandril ---
        a, b = F(t["die_close"][0]), F(t["die_close"][1])
        for ob in (st["moving"], st["die_rod"]):
            key_loc(ob, a, open_vec)
            key_loc(ob, b, (0, 0, 0))
        a, b = F(t["clamp"][0]), F(t["clamp"][1])
        for ob in (st["clamp"], st["clamp_rod"]):
            key_loc(ob, a, open_vec)
            key_loc(ob, b, (0, 0, 0))
        a, b = F(t["mandrel"][0]), F(t["mandrel"][1])
        key_loc(st["mandrel"], a, (0, 0, 0))
        key_loc(st["mandrel"], a + int(round(1.0 * FPS)), (0, stroke * 0.85, 0))
        key_loc(st["mandrel"], b, (0, stroke, 0))
        a, b = F(t["mback"][0]), F(t["mback"][1])
        key_loc(st["mandrel"], a, (0, stroke, 0))
        key_loc(st["mandrel"], b, (0, 0, 0))
        a, b = F(t["copen"][0]), F(t["copen"][1])
        for ob in (st["clamp"], st["clamp_rod"]):
            key_loc(ob, a, (0, 0, 0))
            key_loc(ob, b, open_vec)
        a, b = F(t["dopen"][0]), F(t["dopen"][1])
        for ob in (st["moving"], st["die_rod"]):
            key_loc(ob, a, (0, 0, 0))
            key_loc(ob, b, open_vec)
        # --- vaso: se llena durante el agua, se vacía, sube para liberar la pieza y vuelve a bajar ---
        w = st["water"]
        a = F(t["water"][0])
        w.scale = (1, 1, 0.02)
        w.keyframe_insert("scale", frame=a)
        w.scale = (1, 1, 1.0)
        w.keyframe_insert("scale", frame=a + int(round(3.0 * FPS)))
        w.keyframe_insert("scale", frame=F(t["mback"][0]))
        w.scale = (1, 1, 0.02)
        w.keyframe_insert("scale", frame=F(t["mback"][0]) + int(round(1.0 * FPS)))
        a, b = F(t["cup_up"][0]), F(t["cup_up"][1])
        key_loc(st["cup"], a, (0, 0, 0))
        key_loc(st["cup"], b, (0, 0, 0.10))
        a, b = F(t["cup_down"][0]), F(t["cup_down"][1])
        key_loc(st["cup"], a, (0, 0, 0.10))
        key_loc(st["cup"], b, (0, 0, 0))
        # --- luces del PLC (salidas activas) ---
        def glow(name, t0, t1, level=3.0):
            set_glow(lights[name], 0.0, F(t0) - 1)
            set_glow(lights[name], level, F(t0))
            set_glow(lights[name], level, F(t1))
            set_glow(lights[name], 0.0, F(t1) + 1)

        glow("AUTO", t["start"], t["dopen"][1])
        glow("Y1_MATRIZ", t["die_close"][0], t["dopen"][0])
        glow("Y2_MORDAZA", t["clamp"][0], t["copen"][0])
        glow("Y3_MANDRIL", t["mandrel"][0], t["mback"][0])
        glow("K1_BOMBA", t["water"][0], t["water"][1])
        glow("Y4_PURGA", t["purge"][0], t["purge"][1])
        # botón START: se hunde al tocarlo
        btn = plc["button"]
        p0 = plc["button_pos"]
        key_loc(btn, F(t["press"][0]) + 8, p0)
        key_loc(btn, F(t["start"]), p0 + Vector((0, 0.008, 0)))
        key_loc(btn, F(t["start"]) + 6, p0)
        # ventilador de la bomba: gira durante el llenado
        fan = tank["fan"]
        a, b = F(t["water"][0]), F(t["purge"][0])
        ang = fan.rotation_euler[1]
        for f in range(a, b + 1, 3):
            fan.rotation_euler = (0, ang + (f - a) * 0.45, 0)
            fan.keyframe_insert("rotation_euler", frame=f)
        fan.rotation_euler = (0, ang + (b - a) * 0.45, 0)
        fan.keyframe_insert("rotation_euler", frame=b + 1)

    # --- las pistas de pose del caño caliente y de las piezas ---
    sample_track(hot_ob, plan.hot)
    for k, pob in enumerate(pieces):
        sample_track(pob, plan.pieces[k])
    return hot_ob


def sample_track(ob, track, step=None):
    step = step or SAMPLE_STEP
    for t0, t1, _ in track.segs:
        f0, f1 = F(t0), F(t1)
        f = f0
        while True:
            pos, eul = track.at((f - 1) / FPS)
            key_obj(ob, f, pos, eul)
            if f >= f1:
                break
            f = min(f + step, f1)


def animate_cold_tube(plan, logistics):
    cold = temp_material("Cano_Frio_Mano", AMBIENT)
    bm = bmesh.new()
    add_cyl(bm, mm(PIPE_OD / 2), mm(PIPE_LEN), (0, 0, 0), (0, 1, 0), 32)
    ob = finish("Cano_Frio_en_Mano", bm, cold, logistics["col"])
    set_vis(ob, 1, False)
    for cy in plan.cycles:
        t0 = cy.t["rack"][0] + 0.5
        set_vis(ob, F(t0) - 1, False)
        set_vis(ob, F(t0), True)
        set_vis(ob, F(cy.t["load"][1]), False)
    sample_track(ob, plan.cold)


def animate_packing(plan, logistics, col):
    """Zunchos (flojo → apretado) y movimiento de las 10 piezas ya incluido en las pistas de las piezas."""
    strap_mat = make_material("Zuncho_Amarillo", (0.95, 0.8, 0.1), roughness=0.5)
    for p, b in enumerate(plan.bundles):
        t_a, t_b = b["tie"]
        objs = []
        for i, y in enumerate((-0.36, -0.16)):
            loose = strap_mesh(f"Zuncho_{p + 1}_{i + 1}_flojo", y, 0.02, strap_mat, col)
            tight = strap_mesh(f"Zuncho_{p + 1}_{i + 1}", y, 0.0, strap_mat, col)
            t_on = t_a + 0.5 + i * (t_b - t_a) / 2
            t_tight = t_on + 1.6
            set_vis(loose, 1, False)
            set_vis(loose, F(t_on), True)
            set_vis(loose, F(t_tight), False)
            set_vis(tight, 1, False)
            set_vis(tight, F(t_tight), True)
            objs += [loose, tight]
        for ob in objs:
            # misma pose que el fondo del paquete (las piezas están giradas 90° sobre Y)
            for t0, t1, _ in b["track"].segs:
                f0, f1 = F(t0), F(t1)
                f = f0
                while True:
                    pos, eul = b["track"].at((f - 1) / FPS)
                    key_obj(ob, f, pos, (0.0, pi / 2, eul[2]))
                    if f >= f1:
                        break
                    f = min(f + SAMPLE_STEP, f1)


def animate_drips(plan, logistics, col):
    """Gotas de glicerina que caen del extremo bajo de la vaina al sacarla del carrusel (por la inclinación)."""
    mat = make_material("Gota_Glicerina", (0.95, 0.5, 0.06), roughness=0.05, transmission=1.0, ior=1.47)
    drops = []
    for i in range(6):
        bm = bmesh.new()
        add_sphere(bm, 0.007, (0, 0, 0), 12, 8)
        d = finish(f"Gota_{i + 1}", bm, mat, col, edge_split=False)
        set_vis(d, 1, False)
        drops.append(d)
    G = GEO
    axis = Vector((0, cos(G.tilt), sin(G.tilt)))
    for cy in plan.cycles:
        start = cy.slot_pos - axis * (mm(PIPE_LEN) / 2)
        for i, d in enumerate(drops):
            t0 = cy.t["swap"] + 0.05 + 0.18 * i
            t1 = t0 + 0.5
            key_loc(d, F(t0), tuple(start + Vector((0.0, 0.01 * (i % 3), 0.0))))
            set_vis(d, F(t0) - 1, False)
            set_vis(d, F(t0), True)
            key_loc(d, F(t1), tuple(start + Vector((0.0, 0.01 * (i % 3), -0.38))))
            set_vis(d, F(t1), False)


# ============================================================================================
# 7. Cámara con zoom por operación, leyendas y escena
# ============================================================================================


def build_camera(scene, col):
    cd = bpy.data.cameras.new("Camara_Principal")
    cd.lens = 30
    cd.clip_end = 100
    cam = bpy.data.objects.new("Camara_Principal", cd)
    col.objects.link(cam)
    tgt = make_empty("Objetivo_Camara", col, (1.3, 0.4, 0.9), size=0.1)
    c = cam.constraints.new("TRACK_TO")
    c.target, c.track_axis, c.up_axis = tgt, "TRACK_NEGATIVE_Z", "UP_Y"
    scene.camera = cam
    return cam, tgt


class Shot:
    def __init__(self, t0, t1, pos0, pos1, tgt0, tgt1, text):
        self.t0, self.t1, self.pos0, self.pos1, self.tgt0, self.tgt1, self.text = t0, t1, Vector(pos0), Vector(pos1), Vector(tgt0), Vector(tgt1), text


WIDE_POS = (3.4, -4.8, 2.9)
WIDE_TGT = (1.25, 0.45, 0.95)


def build_shots(plan):
    S = []
    # introducción: vista general y detalle de la batea (nivel de glicerina, resistencias, inclinación)
    S.append(Shot(0.0, 4.5, (3.6, -5.2, 3.0), (3.0, -4.6, 2.6), WIDE_TGT, WIDE_TGT, "Celda de conformado de curvas conduit PEAD Ø40"))
    S.append(Shot(4.5, INTRO_S, (-0.2, -2.2, 1.5), (0.6, -2.0, 1.3), (0.0, 0.0, 0.75), (0.1, 0.0, 0.75), "Batea: glicerina a 120 °C; el eje queda sobre el nivel (resistencias Ø55)"))
    for cy in plan.cycles:
        t = cy.t
        T = cy.T
        if cy.c == 0:
            S.append(Shot(t["index"][0], t["pick_end"], (1.5, -1.0, 1.45), (1.3, -0.7, 1.35), (0.27, 0.0, 0.98), (0.30, 0.0, 1.0), "1. Avance automático y retiro de la vaina (drena la glicerina)"))
            S.append(Shot(t["pick_end"], t["place_end"], (0.9, -2.3, 1.6), (1.6, -1.9, 1.5), (1.0, 0.0, 1.1), (1.85, 0.0, 1.05), "2. Traslado y colocación en la matriz"))
            S.append(Shot(t["press"][0], t["start"] + 0.5, (1.30, 0.0, 1.45), (1.30, -0.1, 1.40), (1.35, -0.55, 1.25), (1.35, -0.55, 1.25), "3. El operario activa el PLC: START"))
            S.append(Shot(t["start"] + 0.5, t["mandrel"][1], (1.25, -1.5, 1.35), (1.45, -1.3, 1.25), (1.95, -0.05, 1.05), (1.95, -0.1, 1.05), "4. Cierre de matriz, mordaza y avance del mandril"))
            S.append(Shot(t["mandrel"][1], t["load"][1] + 0.5, (1.2, -1.3, 1.9), (1.0, -1.0, 1.9), (0.5, -0.4, 1.1), (0.15, 0.0, 1.15), "5. Carga de un caño frío en el carrusel"))
            S.append(Shot(t["load"][1] + 0.5, t["purge"][1], (2.55, -1.15, 1.45), (3.0, -1.2, 1.1), (2.0, 0.1, 1.35), (2.8, -0.2, 0.55), "6. Enfriamiento: bomba, agua y rebalse"))
            S.append(Shot(t["purge"][1], t["extract"][0] + 0.5, (1.25, -1.5, 1.4), (1.3, -1.2, 1.3), (1.95, 0.0, 1.1), (1.95, 0.0, 1.15), "7. Retroceso del mandril y apertura"))
            S.append(Shot(t["extract"][0] + 0.5, T + CYCLE_S, (2.6, 0.2, 1.7), (2.5, 0.5, 1.6), (1.35, 0.7, 0.95), (1.4, 0.95, 0.85), "8. Extracción y pieza al canasto"))
        else:
            S.append(Shot(T, T + CYCLE_S, WIDE_POS, WIDE_POS, WIDE_TGT, WIDE_TGT, f"Pieza {cy.c + 1}"))
        if cy.pack:
            pt = cy.pack_t
            S.append(Shot(T + CYCLE_S, pt["g1"] + 1.0, (2.6, -0.5, 1.7), (2.5, 0.2, 1.6), (1.3, 0.95, 0.95), (1.3, 1.3, 1.0), f"Pieza {PACK_EVERY}: pausa y armado del paquete de {PACK_EVERY}"))
            S.append(Shot(pt["g1"] + 1.0, pt["l1"], (2.5, 1.0, 1.6), (2.4, 1.2, 1.5), (1.3, 1.75, 1.0), (1.3, 1.75, 1.05), "Atado del paquete con dos zunchos"))
            S.append(Shot(pt["l1"], pt["q2"] + 1.0, (2.5, 2.0, 1.6), (2.5, 2.2, 1.5), (1.3, 2.4, 0.95), (1.3, 2.5, 0.9), "Paquete de 10 al canasto de reserva"))
            S.append(Shot(pt["q2"] + 1.0, cy.T + cy.L, WIDE_POS, WIDE_POS, WIDE_TGT, WIDE_TGT, "Se reanuda la línea"))
    t_end = plan.t_end
    S.append(Shot(t_end, t_end + 6.0, (1.4, -0.9, 7.8), (1.4, -0.9, 7.8), (1.4, 0.4, 0.0), (1.4, 0.4, 0.0), "Vista cenital de la celda completa"))
    steps = 12
    for i in range(steps):
        a0, a1 = 2 * pi * i / steps - pi / 2, 2 * pi * (i + 1) / steps - pi / 2
        ta = t_end + 6.0 + 12.0 * i / steps
        tb = t_end + 6.0 + 12.0 * (i + 1) / steps
        c0 = Vector((1.4 + 6.5 * cos(a0), 0.4 + 6.5 * sin(a0), 3.4))
        c1 = Vector((1.4 + 6.5 * cos(a1), 0.4 + 6.5 * sin(a1), 3.4))
        S.append(Shot(ta, tb, c0, c1, (1.4, 0.4, 0.8), (1.4, 0.4, 0.8), "Perspectiva de la secuencia completa"))
    return S


def animate_camera(scene, cam, tgt, shots, col):
    cap_mat = make_material("Leyenda_Blanca", (1, 1, 1), roughness=1.0, emission=(1, 1, 1), emission_strength=2.5)
    glide = 0.8
    first = True
    for sh in shots:
        ta = sh.t0 if first else sh.t0 + glide
        first = False
        tb = max(sh.t1, ta + 0.1)
        cam.location = sh.pos0
        cam.keyframe_insert("location", frame=F(ta))
        tgt.location = sh.tgt0
        tgt.keyframe_insert("location", frame=F(ta))
        cam.location = sh.pos1
        cam.keyframe_insert("location", frame=F(tb))
        tgt.location = sh.tgt1
        tgt.keyframe_insert("location", frame=F(tb))
        txt = make_text("Leyenda", sh.text, col, cap_mat, 0.026)
        txt.parent = cam
        txt.location = (0.0, -0.30, -1.0)
        set_vis(txt, 1, False)
        set_vis(txt, F(sh.t0), True)
        set_vis(txt, F(sh.t1), False)


def build_scene_setup(scene, root):
    col = new_collection("04_Escena", root)
    world = bpy.data.worlds.new("Mundo_Planta")
    world.use_nodes = True
    wnodes = world.node_tree.nodes
    bg = find_node(wnodes, "BACKGROUND") or wnodes.new(type="ShaderNodeBackground")
    wout = find_node(wnodes, "OUTPUT_WORLD") or wnodes.new(type="ShaderNodeOutputWorld")
    if not wout.inputs[0].is_linked:
        world.node_tree.links.new(bg.outputs[0], wout.inputs[0])
    bg.inputs[0].default_value = (*lin((0.07, 0.09, 0.12)), 1.0)
    bg.inputs[1].default_value = 0.9
    scene.world = world
    sun = bpy.data.lights.new("Sol_Nave", "SUN")
    sun.energy = 2.0
    sun.angle = radians(6)
    so = bpy.data.objects.new("Sol_Nave", sun)
    so.rotation_euler = (radians(52), radians(8), radians(-35))
    col.objects.link(so)
    for name, loc, power, size in (("Panel_Central", (1.3, 0.6, 3.4), 1500, 4.0), ("Panel_Carrusel", (0.0, -1.8, 2.2), 450, 2.0), ("Panel_Estacion", (1.6, -1.6, 2.0), 500, 2.0), ("Panel_Embalaje", (1.3, 2.0, 2.2), 500, 2.5)):
        li = bpy.data.lights.new(name, "AREA")
        li.energy, li.size = power, size
        lo = bpy.data.objects.new(name, li)
        lo.location = loc
        lo.rotation_euler = (Vector((1.3, 0.5, 0.9)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        col.objects.link(lo)
    # piso
    bm = bmesh.new()
    add_box(bm, (9.0, 7.5, 0.02), (1.3, 0.6, -0.01))
    use_parent(None)
    finish("Piso_Hormigon", bm, make_material("Piso_Hormigon", (0.22, 0.23, 0.25), roughness=0.85), col, smooth=False, edge_split=False)
    r = scene.render
    r.fps = FPS
    r.resolution_x, r.resolution_y, r.resolution_percentage = 1920, 1080, 100
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            r.engine = eng
            break
        except TypeError:
            continue
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        scene.view_settings.view_transform = "Filmic"
    return col


def setup_viewport(scene):
    """Con la interfaz abierta: vista de cámara con materiales (Material Preview)."""
    if bpy.app.background:
        return
    try:
        for win in bpy.context.window_manager.windows:
            for area in win.screen.areas:
                if area.type == "VIEW_3D":
                    sp = area.spaces.active
                    sp.shading.type = "MATERIAL"
                    sp.region_3d.view_perspective = "CAMERA"
                    sp.clip_end = 100.0
    except (AttributeError, RuntimeError):
        pass


def default_save_path():
    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.expanduser("~")
    return os.path.join(here, "celda_realista_3d.blend")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Genera la celda de conformado de curvas conduit en 3D")
    p.add_argument("--pieces", type=int, default=N_PIECES)
    p.add_argument("--step", type=int, default=SAMPLE_STEP)
    p.add_argument("--save", default=None)
    p.add_argument("--no-save", action="store_true")
    return p.parse_args(argv)


def main():
    global SAMPLE_STEP, STATION_BTN_FRONT
    args = parse_args()
    SAMPLE_STEP = max(1, args.step)
    derive_geometry()
    G = GEO
    print(
        "[celda_realista] nivel glicerina %.0f mm bajo el borde · eje %.0f mm sobre el borde (%.0f mm sobre la glicerina) · holgura a resistencias %.0f mm\n"
        "[celda_realista] vainas equivalentes sumergidas %.2f · avance automático cada %.1f s · τ = %.1f s · retiro a %.1f °C (posición %d°)"
        % (G.level_h * 1000, G.axis_a * 1000, (G.axis_a - G.level_z) * 1000, G.heater_clearance * 1000, G.n_eff, G.cycle, G.tau, G.S[-1], G.pick_angle)
    )
    if G.interval < CYCLE_S - 1e-6:
        print("[celda_realista] AVISO: el intervalo calculado (%.1f s) es menor que el ciclo del operario (%.1f s); se usa %.1f s y la vaina queda %.0f s en el baño." % (G.interval, CYCLE_S, CYCLE_S, CYCLE_S * G.n_eff))
    clear_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "MILLIMETERS"
    root = scene.collection
    bath = build_bath_and_carousel(root)
    station = build_station(root)
    tank = build_tank_pump_pipes(root, station)
    plc = build_plc(root, station)
    STATION_BTN_FRONT = tuple(plc["front"])
    logistics = build_logistics(root, station)
    op = build_operator(root)
    cam_col = build_scene_setup(scene, root)
    cam, tgt = build_camera(scene, cam_col)

    plan = build_plan(max(1, args.pieces))
    thermal_plan(plan)
    total = F(plan.t_end + 6.0 + 12.0) + 1
    scene.frame_start, scene.frame_end = 1, total

    animate_carousel(plan, bath)
    animate_machine(plan, station, bath, tank, plc)
    animate_cold_tube(plan, logistics)
    animate_drips(plan, logistics, logistics["col"])
    if plan.bundles:
        animate_packing(plan, logistics, logistics["col"])
    state = {"f": None, "x": ST_A[0], "y": ST_A[1], "phase": 0.0}
    f = 1
    while f <= total:
        key_operator(op, f, plan, state)
        f += SAMPLE_STEP
    animate_camera(scene, cam, tgt, build_shots(plan), cam_col)
    scene.frame_set(1)
    print("[celda_realista] %d objetos · %d cuadros a %d FPS (%.0f s) · %d piezas" % (len(bpy.data.objects), total, FPS, total / FPS, len(plan.cycles)))
    if not args.no_save:
        path = args.save or default_save_path()
        try:
            bpy.ops.wm.save_as_mainfile(filepath=path)
            print("[celda_realista] guardado:", path)
        except RuntimeError as exc:
            print("[celda_realista] no se pudo guardar:", exc)
    setup_viewport(scene)


if __name__ == "__main__":
    main()
