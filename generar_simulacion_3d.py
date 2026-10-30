#!/usr/bin/env python3
"""
generar_simulacion_3d.py — Celda de conformado de curvas conduit PEAD Ø40, en 3D para Blender 4.x.

Crea PROCEDURALMENTE (sin archivos CAD/STEP ni assets externos) los sólidos, los materiales y la
animación de la celda del simulador web (carpeta `src/sim`): batea de glicerina con carrusel de 16
posiciones, estación de conformado en L, mandril abocardador, tanque de 500 L con electrobomba y
cañerías.

Uso (desde la terminal):

    blender --python generar_simulacion_3d.py
    blender --background --python generar_simulacion_3d.py -- --save celda.blend
    blender --background --python generar_simulacion_3d.py -- --render-frames 1,300,700 --out /tmp/vista

Argumentos (después de `--`):
    --save RUTA.blend      guarda la escena (por defecto: celda_conduit_3d.blend junto al script)
    --no-save              no guarda
    --cycles N             cantidad de ciclos de conformado a animar (por defecto 3)
    --cool S               pausa de enfriamiento en segundos (por defecto 12)
    --render-frames LISTA  renderiza esos cuadros a PNG (p. ej. 1,300,700) y termina
    --out PREFIJO          prefijo de los PNG (por defecto /tmp/celda3d)
    --samples N            muestras de Cycles al renderizar cuadros (por defecto 24)
    --camera NOMBRE        Cam_General | Cam_Estacion | Cam_Carrusel (por defecto Cam_General)

Convenciones: 1 unidad de Blender = 1 metro (todas las cotas se escriben en mm y se pasan por `mm()`).
  · Eje del carrusel = eje Y; el eje Y positivo es "hacia el fondo".  Z arriba.
  · Carrusel en el origen, a la izquierda; estación de conformado en L a la derecha (+X).
  · El ángulo de una posición se mide desde el cenit, en sentido horario visto desde -Y, igual
    que en el simulador 2D (0° = cenit/carga, 67,5° = retiro).

Módulos (funciones `build_*`): batea y carrusel · estación en L · tanque, bomba y cañerías ·
cinemática y animación · escena (luces, cámaras, render). Todo se parametriza en la sección CONFIG.
"""
import argparse
import math
import os
import sys
from math import cos, exp, pi, radians, sin

import bpy
import bmesh  # noqa: E402  (debe importarse después de bpy)
from mathutils import Matrix, Vector

# ============================================================================================
# CONFIG — parámetros del simulador (src/sim/physics.ts y params.ts) y de la animación
# ============================================================================================
MM = 0.001


def mm(v):
    """Milímetros → metros (unidades de Blender)."""
    return v * MM


# --- Batea de glicerina y carrusel (BATH, PIPE) ---
BATH_R = 323.0  # mm, radio de la batea semicilíndrica
BATH_L = 900.0  # mm, largo
BATH_WALL = 8.0  # mm, espesor de chapa
MOUNT_R = 270.0  # mm, radio de montaje de los caños (centro)
SHAFT_D = 40.0  # mm, eje central
SLOTS = 16  # posiciones del carrusel
STEP_DEG = 360.0 / SLOTS  # 22,5°
PIPE_OD = 40.0  # mm
PIPE_LEN = 860.0  # mm
BATH_PODS = 7.5  # vainas equivalentes en la glicerina (parámetro bathPods del simulador)
GLYCERIN_DROP = 10.0  # mm que el nivel queda por debajo del eje con 7,5 vainas (levelDropFor(7.5, 16))
PLATE_Y = 380.0  # mm, posición axial de los platos portatubos (±)
BEARING_Y = 530.0  # mm, posición axial de los soportes con rodamientos (±)
SHAFT_LEN = 1300.0  # mm
HEATER_D = 24.0  # mm, resistencias blindadas
FLOOR_Z = -0.62  # m, piso de la planta

# --- Termodinámica (para colorear los caños) ---
BATH_TEMP = 132.0
AMBIENT = 25.0
BATH_TAU = 75.0  # s a 2,5 mm
WALL_MM = 2.5
EMERGED_TAU = 5000.0
THERMAL_CYCLE_S = 22.9  # s, ciclo nominal del simulador (residencia por posición)
PICK_K = 3  # estación de RETIRO: 3 × 22,5° = 67,5°
# Escala de color del simulador 2D (tempColor): (°C, (R, G, B) 0-255)
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

# --- Estación de conformado en L ---
STATION_ORIGIN = Vector((1.15, 0.0, 0.10))  # m, eje del caño en la matriz (coordenadas del mundo)
BEND_R = 200.0  # mm, radio neutro de la matriz
LEG_H = 300.0  # mm de caño recto en la entrada antes del codo
GROOVE_R = 20.5  # mm, canal semicilíndrico para Ø40
DIE_X = 90.0  # mm, espesor de cada mitad de la matriz
DIE_BAND = 60.0  # mm, medio ancho de banda de la matriz alrededor de la línea neutra
DIE_OPEN = 200.0  # mm, recorrido en X y en Z de la matriz móvil (diagonal)
CUP_D = 90.0  # mm, vaso de rebalse
CUP_H = 150.0  # mm
MANDREL_STROKE = 100.0  # mm
CONE_HALF_ANGLE = 10.0  # grados
CONE_TIP_R = 16.0  # mm
CONE_LEN = 65.0  # mm
TANK_LITERS = 500.0
TANK_R = 0.40  # m  → altura = V / (π R²) ≈ 0,995 m
TANK_POS = Vector((0.85, 0.0))  # x, y locales de la estación

# --- Cinemática (segundos). Los pasos de la secuencia del simulador están en params.ts ---
FPS = 30
N_CYCLES = 3
PHASES = [  # (nombre, duración s)
    ("index", 1.5),  # giro de indexado de 22,5°
    ("transfer", 2.0),  # traslado del caño caliente a la matriz fija
    ("die_close", 1.6),  # cierre de la matriz móvil + curvado a 90° (1,4 s + 0,2 s de asentamiento)
    ("clamp", 0.4),  # bloqueo de la mordaza
    ("mandrel", 1.3),  # avance del mandril (1,0 s de aproximación + 0,3 s de asiento)
    ("cool", 12.0),  # pausa de enfriamiento
    ("mandrel_back", 0.8),  # retroceso del mandril
    ("clamp_open", 0.3),  # liberación de la mordaza
    ("die_open", 1.5),  # apertura de la matriz
    ("extract", 2.0),  # extracción de la pieza
]
MANDREL_APPROACH_S = 1.0
MANDREL_APPROACH_FRAC = 0.85  # fracción de la carrera al final de la aproximación
CLAMP_TRAVEL = 70.0  # mm de carrera de la mordaza inferior
DEMOLD_TEMP = 52.0  # °C de la pieza al abrir la matriz

# ============================================================================================
# Utilidades
# ============================================================================================


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(rgb):
    return tuple(srgb_to_linear(c) for c in rgb)


def temp_rgb(t):
    """Color sRGB (0-1) de un caño a la temperatura `t` [°C]: misma escala que tempColor() del simulador."""
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


def clamp01(v):
    return max(0.0, min(1.0, v))


def smoothstep(u):
    u = clamp01(u)
    return u * u * (3 - 2 * u)


def fr(sec):
    """Segundos → número de cuadros (duración)."""
    return max(1, int(round(sec * FPS)))


def new_collection(name, parent=None):
    col = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(col)
    return col


def clear_scene():
    """Deja el archivo vacío sin recargar la configuración de fábrica (no interfiere con --python)."""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.actions, bpy.data.worlds):
        for item in list(coll):
            coll.remove(item)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


# ---------------------------------------------------------------- materiales


def find_node(nodes, node_type):
    """Primer nodo de un tipo interno (p. ej. 'BSDF_PRINCIPLED'). Nunca por nombre: éste cambia con el idioma de la interfaz."""
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
    """Socket de entrada por nombre o por identificador (tolera variantes entre versiones 4.x). None si no existe."""
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
    """Principled BSDF con tolerancia a los cambios de nombres entre versiones 4.x."""
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


# ---------------------------------------------------------------- geometría con bmesh


def rot_to(direction):
    """Matriz 4×4 que lleva +Z a `direction`."""
    return Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()


def add_cyl(bm, r, depth, center=(0, 0, 0), direction=(0, 0, 1), segs=48, r2=None, caps=True):
    """Cilindro/cono centrado en `center`; r en la base (−dirección) y r2 en la punta."""
    m = Matrix.Translation(Vector(center)) @ rot_to(direction)
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth, matrix=m)


def add_box(bm, size, center=(0, 0, 0)):
    m = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


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


def add_half_pipe(bm, r_in, r_out, y0, y1, a0, a1, segs=24):
    """Media caña (anillo parcial) con eje paralelo a Y, entre los ángulos a0 y a1 (rad) en el plano XZ."""
    inner = [[bm.verts.new((r_in * cos(a0 + (a1 - a0) * i / segs), y, r_in * sin(a0 + (a1 - a0) * i / segs))) for y in (y0, y1)] for i in range(segs + 1)]
    outer = [[bm.verts.new((r_out * cos(a0 + (a1 - a0) * i / segs), y, r_out * sin(a0 + (a1 - a0) * i / segs))) for y in (y0, y1)] for i in range(segs + 1)]
    for i in range(segs):
        bm.faces.new((inner[i][0], inner[i + 1][0], inner[i + 1][1], inner[i][1]))  # cara interior
        bm.faces.new((outer[i][0], outer[i][1], outer[i + 1][1], outer[i + 1][0]))  # cara exterior
    for e in (0, 1):  # tapas planas en los extremos axiales (un polígono por extremo)
        bm.faces.new([inner[i][e] for i in range(segs + 1)] + [outer[i][e] for i in range(segs, -1, -1)])
    for idx in (0, segs):  # tapas en los extremos angulares
        bm.faces.new((inner[idx][0], outer[idx][0], outer[idx][1], inner[idx][1]))


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
    if edge_split:
        mod = ob.modifiers.new("EdgeSplit", "EDGE_SPLIT")
        mod.split_angle = radians(38)
    if bevel:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    return ob


def prism(bm, pts_xz, y0, y1):
    """Prisma cerrado: polígono en XZ (n-gono convexo o no) extruido de y0 a y1."""
    a = [bm.verts.new((x, y0, z)) for x, z in pts_xz]
    b = [bm.verts.new((x, y1, z)) for x, z in pts_xz]
    n = len(pts_xz)
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))


def parent_keep(child, parent):
    """Emparenta dejando la matriz inversa del padre en identidad: la posición del hijo queda en coordenadas LOCALES del padre."""
    child.parent = parent


def make_empty(name, col, loc=(0, 0, 0), kind="PLAIN_AXES", size=0.1):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.empty_display_size = size
    e.location = loc
    col.objects.link(e)
    return e


# ---------------------------------------------------------------- tuberías (curvas con bisel)


def fillet_polyline(pts, radius, segs=6):
    """Redondea las esquinas de una poligonal con arcos (curva cuadrática por esquina)."""
    pts = [Vector(p) for p in pts]
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        d1, d2 = (a - b), (c - b)
        l1, l2 = d1.length, d2.length
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
    return ob


# ============================================================================================
# Modelo térmico (port de physics.ts) — sólo para colorear los caños del carrusel
# ============================================================================================


def submerged_fraction(angle_deg, drop_mm=GLYCERIN_DROP):
    depth = -MOUNT_R * cos(radians(angle_deg)) - drop_mm
    return clamp01(depth / PIPE_OD + 0.5)


def carousel_step(T, f, dt, bath_t, amb, tau_l):
    g_l, g_a = f / tau_l, (1 - f) / EMERGED_TAU
    g = g_l + g_a
    t_inf = (g_l * bath_t + g_a * amb) / g
    return t_inf + (T - t_inf) * exp(-dt * g)


def slot_temperatures(cycle_s=THERMAL_CYCLE_S):
    """S[j] = temperatura al terminar la residencia en la posición j (j=0: recién cargado, frío)."""
    tau_l = BATH_TAU * WALL_MM / 2.5
    S = [AMBIENT]
    for j in range(1, SLOTS):
        angle = (-j * STEP_DEG) % 360.0
        S.append(carousel_step(S[-1], submerged_fraction(angle), cycle_s, BATH_TEMP, AMBIENT, tau_l))
    return S


def temp_material(name, t):
    r, g, b = temp_rgb(t)
    return make_material(name, color=(r, g, b), roughness=0.38, emission=(r, g, b), emission_strength=emission_strength(t), coat=0.3)


def emission_strength(t):
    return 0.35 + 1.6 * clamp01((t - 40.0) / 90.0)


def set_tube_temp(mat, t, frame=None):
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


# ============================================================================================
# 1. Batea y carrusel
# ============================================================================================


def build_bath_and_carousel(root):
    col = new_collection("01_Batea_Carrusel", root)
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
    out = {"mats": mats, "col": col}

    # --- Cuba semicilíndrica (mitad inferior) con tapas y reborde ---
    bm = bmesh.new()
    n = 64
    arc = [(R * sin(radians(-90 + 180 * i / n)), -R * cos(radians(-90 + 180 * i / n))) for i in range(n + 1)]
    prism(bm, arc, -L / 2, L / 2)
    # quitar las caras laterales del prisma de la cuerda (borde superior abierto): dejar cuba + tapas
    top = [f for f in bm.faces if all(abs(v.co.z) < 1e-6 for v in f.verts) and len(f.verts) == 4]
    bmesh.ops.delete(bm, geom=top, context="FACES")
    batea = finish("Batea_R323", bm, mats["steel"], col, edge_split=False)
    mod = batea.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = mm(BATH_WALL)
    mod.offset = 0
    for sx in (-1, 1):  # reborde superior
        b2 = bmesh.new()
        add_box(b2, (mm(34), L + mm(16), mm(8)), (sx * (R + mm(13)), 0, mm(2)))
        finish(f"Reborde_{'D' if sx > 0 else 'I'}", b2, mats["steel"], col, smooth=False, bevel=mm(2))

    # --- Glicerina traslúcida: casquete bajo el nivel (el eje queda por encima: las resistencias suben el fondo) ---
    ri = R - mm(BATH_WALL)
    drop = mm(GLYCERIN_DROP)
    a0 = math.acos(drop / ri)
    gl = [(ri * sin(-a0 + 2 * a0 * i / n), -ri * cos(-a0 + 2 * a0 * i / n)) for i in range(n + 1)]
    bm = bmesh.new()
    prism(bm, gl, -L / 2 + mm(BATH_WALL), L / 2 - mm(BATH_WALL))
    bm.verts.ensure_lookup_table()
    for v in bm.verts:  # la cuerda superior es la superficie libre: z = -drop
        if v.co.z > -drop + 1e-6:
            v.co.z = -drop
    out["glycerin"] = finish("Glicerina", bm, mats["glycerin"], col, edge_split=False)

    # --- 2 resistencias eléctricas blindadas en el fondo longitudinal ---
    hz = -mm(288)
    for k, sx in enumerate((-1, 1)):
        bm = bmesh.new()
        add_cyl(bm, mm(HEATER_D / 2), mm(840), (sx * mm(75), 0, hz), (0, 1, 0), 32)
        finish(f"Resistencia_{k + 1}", bm, mats["heater"], col)
        bm = bmesh.new()
        for sy in (-1, 1):
            add_cyl(bm, mm(14), mm(34), (sx * mm(75), sy * mm(437), hz), (0, 1, 0), 24)
        finish(f"Borne_Resistencia_{k + 1}", bm, mats["terminal"], col)

    # --- Bastidor de la batea y piso ---
    bm = bmesh.new()
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box(bm, (mm(60), mm(60), -FLOOR_Z - R + mm(6)), (sx * mm(300), sy * mm(380), (FLOOR_Z - R) / 2 + mm(3)))
    for sy in (-1, 1):
        add_box(bm, (mm(660), mm(50), mm(50)), (0, sy * mm(380), -R - mm(30)))
    for sx in (-1, 1):
        add_box(bm, (mm(50), mm(800), mm(50)), (sx * mm(300), 0, -R - mm(30)))
    finish("Bastidor_Batea", bm, mats["frame"], col, smooth=False, bevel=mm(2))
    bm = bmesh.new()
    add_box(bm, (6.0, 5.0, 0.02), (1.0, -0.2, FLOOR_Z - 0.01))
    out["floor"] = finish("Piso", bm, make_material("Piso_Hormigón", (0.22, 0.23, 0.25), roughness=0.85), col, smooth=False, edge_split=False)

    # --- Eje Ø40 y dos soportes con rodamientos ---
    bm = bmesh.new()
    add_cyl(bm, mm(SHAFT_D / 2), mm(SHAFT_LEN), (0, 0, 0), (0, 1, 0), 40)
    finish("Eje_Carrusel_D40", bm, mats["inox"], col)
    for sy in (-1, 1):
        y = sy * mm(BEARING_Y)
        bm = bmesh.new()
        add_box(bm, (mm(180), mm(70), mm(18)), (0, y, FLOOR_Z + mm(9)))  # base
        add_box(bm, (mm(110), mm(50), -FLOOR_Z - mm(18) - mm(60)), (0, y, (FLOOR_Z + mm(18) - mm(60)) / 2))  # pedestal
        add_cyl(bm, mm(62), mm(50), (0, y, 0), (0, 1, 0), 48)  # carcasa
        for sx in (-1, 1):
            add_cyl(bm, mm(9), mm(30), (sx * mm(70), y, FLOOR_Z + mm(18)), (0, 0, 1), 16)  # bulones
        finish(f"Soporte_Rodamiento_{'+' if sy > 0 else '-'}", bm, mats["frame"], col, smooth=False, bevel=mm(2))
        bm = bmesh.new()
        add_torus(bm, mm(33), mm(12), (0, y + sy * mm(28), 0), (0, 1, 0), 48, 12)
        add_cyl(bm, mm(34), mm(54), (0, y, 0), (0, 1, 0), 48)
        finish(f"Rodamiento_{'+' if sy > 0 else '-'}", bm, mats["bearing"], col)

    # --- Rotor: platos portatubos con 16 posiciones y 16 tubos ---
    rotor = make_empty("Carrusel_Rotor", col, kind="CIRCLE", size=0.2)
    out["rotor"] = rotor
    for sy in (-1, 1):
        y = sy * mm(PLATE_Y)
        bm = bmesh.new()
        add_cyl(bm, mm(70), mm(16), (0, y, 0), (0, 1, 0), 48)  # cubo
        add_torus(bm, mm(MOUNT_R), mm(5), (0, y, 0), (0, 1, 0), 96, 8)  # aro
        for i in range(SLOTS):
            a = radians(i * STEP_DEG)
            dx, dz = sin(a), cos(a)
            mid = mm(MOUNT_R - 70) / 2 + mm(70)
            m = Matrix.Translation((dx * mid, y, dz * mid)) @ Matrix.Rotation(-a, 4, "Y")
            bmesh.ops.create_cube(bm, size=1.0, matrix=m @ Matrix.Diagonal((mm(26), mm(10), mm(MOUNT_R - 70 - 22), 1.0)))
            add_torus(bm, mm(PIPE_OD / 2 + 6.5), mm(6.5), (dx * mm(MOUNT_R), y, dz * mm(MOUNT_R)), (0, 1, 0), 32, 10)  # collar
        plate = finish(f"Plato_{'+' if sy > 0 else '-'}", bm, mats["steel_dark"], col, bevel=mm(1.5))
        parent_keep(plate, rotor)

    S = slot_temperatures()
    tubes = []
    for m in range(SLOTS):
        a = radians(m * STEP_DEG)
        j0 = (-m) % SLOTS
        t0 = S[j0] if j0 <= 12 else AMBIENT
        bm = bmesh.new()
        add_cyl(bm, mm(PIPE_OD / 2), mm(PIPE_LEN), (0, 0, 0), (0, 1, 0), 40)
        mat = temp_material(f"Tubo_PEAD_{m:02d}", t0)
        ob = finish(f"Tubo_{m:02d}", bm, mat, col)
        ob.location = (mm(MOUNT_R) * sin(a), 0, mm(MOUNT_R) * cos(a))
        parent_keep(ob, rotor)
        tubes.append(ob)
    out["tubes"] = tubes
    out["S"] = S
    return out


# ============================================================================================
# 2. Estación de conformado en L
# ============================================================================================

TUBE_Y0 = -mm(PIPE_LEN) / 2  # y local del extremo de entrada (campana) del caño
LEG = mm(LEG_H)
BR = mm(BEND_R)


def tube_path(s, beta):
    """Punto (y, z) y rumbo del eje del caño en la coordenada material `s` [m] con el codo curvado a la fracción beta.

    Recto en la entrada → arco de radio neutro R (ángulo beta·90°) → recta con el rumbo final.
    """
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
    half, t = mm(DIE_BAND), mm(DIE_X)
    gr = mm(GROOVE_R)
    prof = [(-half, 0.0), (-gr, 0.0)]
    for k in range(1, 12):  # canal semicircular (hacia +x)
        al = pi - pi * k / 12
        prof.append((gr * cos(al), gr * sin(al)))
    prof += [(gr, 0.0), (half, 0.0), (half, t), (-half, t)]
    samples = []
    n_arc = 32
    ss = [s0]
    for s in (LEG - 0.0, LEG + BR * pi / 2):
        if s0 < s < s1:
            ss.append(s)
    ss.append(s1)
    for a, b in zip(ss, ss[1:]):
        k = max(2, int((b - a) / mm(25))) if abs((b - a) - BR * pi / 2) > 1e-6 else n_arc
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
    return finish(name, bm, mat, col, bevel=0.0)


def build_station(root):
    col = new_collection("02_Estacion_L", root)
    O = STATION_ORIGIN
    st = make_empty("Estacion_L", col, tuple(O), kind="ARROWS", size=0.15)
    fl = FLOOR_Z - O.z  # piso en coordenadas locales
    mats = {
        "die": make_material("Matriz_Acero_Mecanizado", (0.5, 0.53, 0.58), metallic=1.0, roughness=0.28),
        "die_move": make_material("Matriz_Móvil", (0.42, 0.46, 0.52), metallic=1.0, roughness=0.3),
        "brass": make_material("Bronce_Mordaza", (0.8, 0.55, 0.16), metallic=1.0, roughness=0.3),
        "chrome": make_material("Cromo_Pulido", (0.95, 0.96, 0.98), metallic=1.0, roughness=0.06),
        "cone": make_material("Cono_Expansor", (0.9, 0.92, 0.95), metallic=1.0, roughness=0.08),
        "cyl": make_material("Cilindro_Neumático", (0.12, 0.13, 0.16), metallic=0.8, roughness=0.38),
        "frame": make_material("Bastidor_Estación", (0.08, 0.2, 0.42), metallic=0.3, roughness=0.45),
        "glass": make_material("Vaso_Acrílico", (0.85, 0.92, 1.0), roughness=0.05, alpha=0.25, transmission=1.0, ior=1.49),
        "water": make_material("Agua_Templado", (0.1, 0.45, 0.95), roughness=0.02, alpha=0.6, transmission=1.0, ior=1.33),
        "blue": make_material("Anodizado_Azul", (0.1, 0.35, 0.8), metallic=0.8, roughness=0.3),
        "pipe": make_material("Cañería_Inox", (0.78, 0.8, 0.84), metallic=1.0, roughness=0.25),
        "hose": make_material("Manguera_Negra", (0.03, 0.03, 0.04), roughness=0.55),
    }
    out = {"root": st, "col": col, "mats": mats}

    # --- Matriz fija en escuadra (x ≥ 0) y matriz móvil complementaria (x ≤ 0) ---
    fixed = sweep_band("Matriz_Fija_L_R200", mm(200), mm(720), +1, mats["die"], col)
    moving = sweep_band("Matriz_Movil_Curva", mm(200), mm(700), -1, mats["die_move"], col)
    for ob in (fixed, moving):
        ob.location = (0, 0, 0)
        parent_keep(ob, st)
    out["fixed"], out["moving"] = fixed, moving

    # --- Actuador diagonal de la matriz móvil (vástago solidario, cuerpo fijo a un poste) ---
    ay, az = TUBE_Y0 + LEG + BR * sin(pi / 4), BR * (1 - cos(pi / 4))
    anchor = Vector((-mm(DIE_X), ay, az))
    u = Vector((-1, 0, 1)).normalized()
    bm = bmesh.new()
    add_cyl(bm, mm(14), 0.36, anchor + u * 0.18, u, 32)
    add_box(bm, (mm(70), mm(20), mm(70)), anchor + u * 0.012)  # horquilla
    rod = finish("Vastago_Matriz", bm, mats["chrome"], col)
    rod.location = (0, 0, 0)
    parent_keep(rod, st)
    bm = bmesh.new()
    add_cyl(bm, mm(42), 0.44, anchor + u * 0.52, u, 40)
    add_cyl(bm, mm(48), mm(30), anchor + u * 0.74, u, 40)
    add_cyl(bm, mm(48), mm(30), anchor + u * 0.30, u, 40)
    body = finish("Cilindro_Matriz_Diagonal", bm, mats["cyl"], col)
    parent_keep(body, st)
    post_pos = anchor + u * 0.52
    bm = bmesh.new()
    add_box(bm, (mm(70), mm(70), post_pos.z - fl - mm(40)), (post_pos.x, post_pos.y, (post_pos.z + fl) / 2 - mm(20)))
    add_box(bm, (mm(300), mm(260), mm(20)), (post_pos.x, post_pos.y, fl + mm(10)))
    finish("Poste_Cilindro_Matriz", bm, mats["frame"], col, smooth=False, bevel=mm(2)).parent = st
    out["moving_rod"] = rod
    out["die_open_vec"] = Vector((-mm(DIE_OPEN), 0, mm(DIE_OPEN)))

    # --- Mordaza de sujeción inferior en la entrada recta (+ silleta superior fija) ---
    jy0, jy1 = TUBE_Y0 + mm(30), TUBE_Y0 + mm(180)
    bm = bmesh.new()
    add_box(bm, (mm(DIE_X), jy1 - jy0, mm(50)), (0, (jy0 + jy1) / 2, -mm(55)))
    jaw = finish("Mordaza_Inferior", bm, mats["die"], col, smooth=False, bevel=mm(1.5))
    bm = bmesh.new()
    add_half_pipe(bm, mm(GROOVE_R), mm(30), jy0, jy1, pi, 2 * pi, 24)
    ins = finish("Mordaza_Inserto_Bronce", bm, mats["brass"], col)
    bm = bmesh.new()
    add_cyl(bm, mm(10), mm(130), (0, (jy0 + jy1) / 2, -mm(155)), (0, 0, 1), 24)
    jrod = finish("Vastago_Mordaza", bm, mats["chrome"], col)
    for ob in (jaw, ins, jrod):
        parent_keep(ob, st)
    out["jaw_parts"] = [jaw, ins, jrod]
    bm = bmesh.new()
    add_box(bm, (mm(DIE_X), jy1 - jy0, mm(50)), (0, (jy0 + jy1) / 2, mm(55)))
    add_cyl(bm, mm(36), mm(150), (0, (jy0 + jy1) / 2, -mm(255)), (0, 0, 1), 36)
    sad = finish("Silleta_Fija_y_Cilindro_Mordaza", bm, mats["die"], col, smooth=False, bevel=mm(1.5))
    bm = bmesh.new()
    add_half_pipe(bm, mm(GROOVE_R), mm(30), jy0, jy1, 0, pi, 24)
    ins2 = finish("Silleta_Inserto_Bronce", bm, mats["brass"], col)
    bm = bmesh.new()
    add_box(bm, (mm(DIE_X), jy1 - jy0, mm(180)), (mm(DIE_X) / 2 + mm(45), (jy0 + jy1) / 2, 0))
    add_box(bm, (mm(20), jy1 - jy0, mm(200)), (mm(DIE_X) + mm(45) + mm(10), (jy0 + jy1) / 2, 0))
    finish("Escuadra_Silleta", bm, mats["frame"], col, smooth=False).parent = st
    sad.parent = st
    ins2.parent = st
    bm = bmesh.new()  # columna de la silleta/mordaza
    add_box(bm, (mm(60), mm(60), -fl - mm(180)), (mm(120), (jy0 + jy1) / 2, fl / 2 - mm(60) / 2))
    finish("Columna_Mordaza", bm, mats["frame"], col, smooth=False).parent = st

    # --- Pared de bancada detrás de la matriz fija ---
    bm = bmesh.new()
    wall_top = mm(300)
    add_box(bm, (mm(20), mm(780), wall_top - fl), (mm(DIE_X) + mm(10), mm(-120), (wall_top + fl) / 2))
    add_box(bm, (mm(300), mm(1500), mm(20)), (mm(80), mm(-380), fl + mm(10)))
    for y in (-0.60, -0.15, 0.20):
        add_box(bm, (mm(140), mm(16), wall_top - fl - mm(60)), (mm(DIE_X) - mm(50), y, (wall_top + fl) / 2 - mm(30)))
    finish("Bancada_Estacion", bm, mats["frame"], col, smooth=False, bevel=mm(2)).parent = st

    # --- Vaso superior de rebalse Ø90 × 150 con salida de manguera hacia abajo ---
    cy = TUBE_Y0 + LEG + BR  # y del tramo vertical
    cz0 = mm(395)  # fondo del vaso
    n = 48
    ro, ri_ = mm(CUP_D / 2), mm(CUP_D / 2 - 3)
    walls = bmesh.new()
    rings = []
    for z in (cz0, cz0 + mm(CUP_H)):
        rings.append(([walls.verts.new((ri_ * cos(2 * pi * i / n), cy + ri_ * sin(2 * pi * i / n), z)) for i in range(n)], [walls.verts.new((ro * cos(2 * pi * i / n), cy + ro * sin(2 * pi * i / n), z)) for i in range(n)]))
    (ia, oa), (ib, ob_) = rings
    for i in range(n):
        j = (i + 1) % n
        walls.faces.new((oa[i], oa[j], ob_[j], ob_[i]))  # exterior
        walls.faces.new((ia[j], ia[i], ib[i], ib[j]))  # interior
        walls.faces.new((ib[i], ib[j], ob_[j], ob_[i]))  # borde superior
        walls.faces.new((ia[i], ia[j], oa[j], oa[i]))  # fondo (anillo)
    cup = finish("Vaso_Rebalse_D90", walls, mats["glass"], col, edge_split=False)
    parent_keep(cup, st)
    bm = bmesh.new()
    add_cyl(bm, ro, mm(6), (0, cy, cz0 + mm(3)), (0, 0, 1), 48)  # piso del vaso
    add_cyl(bm, mm(14), mm(40), (0, cy, cz0 - mm(20)), (0, 0, 1), 32)  # cuello de empalme
    add_cyl(bm, mm(14), mm(40), (0, cy + mm(32), cz0 - mm(20)), (0, 0, 1), 24, r2=mm(10))  # pico de salida hacia abajo
    add_box(bm, (mm(90), mm(20), mm(16)), (mm(DIE_X) / 2 + 0.0, cy, cz0 - mm(30)))
    cupbase = finish("Vaso_Fondo_y_Salida", bm, mats["pipe"], col)
    parent_keep(cupbase, st)
    water_h = mm(100)
    bm = bmesh.new()
    add_cyl(bm, ri_ - mm(1), water_h, (0, 0, water_h / 2), (0, 0, 1), 48)  # origen en la base: escala en Z sin desplazarse
    water = finish("Agua_Vaso", bm, mats["water"], col, edge_split=False)
    water.parent = st
    water.location = (0, cy, cz0 + mm(6))
    out["water"] = water
    out["cup_water_pivot"] = (cy, cz0 + mm(6))
    out["cup_outlet"] = Vector((0, cy + mm(32), cz0 - mm(42)))
    out["cup_water_h"] = water_h

    # --- Mandril abocardador: cilindro de avance, vástago, cono de 10° y tobera interior de inyección ---
    bm = bmesh.new()
    add_cyl(bm, mm(48), mm(240), (0, -mm(1000), 0), (0, 1, 0), 48)
    add_cyl(bm, mm(55), mm(26), (0, -mm(1115), 0), (0, 1, 0), 48)
    add_cyl(bm, mm(55), mm(26), (0, -mm(887), 0), (0, 1, 0), 48)
    for sy in (-1, 1):
        add_cyl(bm, mm(10), mm(300), (sy * mm(60), -mm(1000), mm(60)), (0, 1, 0), 16)  # tensores
    add_box(bm, (mm(90), mm(240), -fl - mm(60)), (0, -mm(1000), (fl - mm(60)) / 2 - mm(30)))
    add_box(bm, (mm(180), mm(300), mm(20)), (0, -mm(1000), fl + mm(10)))
    mbody = finish("Cilindro_Mandril", bm, mats["cyl"], col, bevel=mm(1))
    parent_keep(mbody, st)
    grp = make_empty("Mandril_Grupo", col, (0, 0, 0), size=0.05)
    parent_keep(grp, st)
    cone_half = radians(CONE_HALF_ANGLE)
    r_base = mm(CONE_TIP_R) + mm(CONE_LEN) * math.tan(cone_half)
    y_tip0 = TUBE_Y0 - mm(50)  # punta del cono con el mandril atrás
    y_base0 = y_tip0 - mm(CONE_LEN)
    bm = bmesh.new()
    add_cyl(bm, mm(12.5), (y_base0 - (-mm(1000))) , (0, (y_base0 - mm(1000)) / 2 + mm(0) , 0), (0, 1, 0), 32)
    rodm = finish("Vastago_Mandril", bm, mats["chrome"], col)
    bm = bmesh.new()
    # radio1 va en el extremo −dirección: base ancha atrás (−Y), punta fina adelante (+Y)
    add_cyl(bm, r_base, mm(CONE_LEN), (0, y_tip0 - mm(CONE_LEN) / 2, 0), (0, 1, 0), 48, r2=mm(CONE_TIP_R))
    cone = finish("Cono_10deg", bm, mats["cone"], col)
    bm = bmesh.new()
    add_cyl(bm, mm(7), mm(70), (0, y_tip0 + mm(35) - mm(6), 0), (0, 1, 0), 24)
    add_cyl(bm, mm(8.5), mm(4), (0, y_tip0 + mm(60), 0), (0, 1, 0), 24)
    for k in range(4):
        a = k * pi / 2
        add_cyl(bm, mm(2.2), mm(10), (mm(7) * cos(a) * 0.9, y_tip0 + mm(50), mm(7) * sin(a) * 0.9), (cos(a), 0, sin(a)), 8)
    nozzle = finish("Tobera_Inyeccion", bm, mats["blue"], col)
    for ob in (rodm, cone, nozzle):
        parent_keep(ob, grp)
    bm = bmesh.new()  # guía fija del vástago (anillo) y su soporte
    add_torus(bm, mm(26), mm(10), (0, TUBE_Y0 - mm(170), 0), (0, 1, 0), 32, 10)
    add_box(bm, (mm(30), mm(30), -fl - mm(40)), (0, TUBE_Y0 - mm(170), (fl - mm(40)) / 2 - mm(20)))
    finish("Guia_Vastago", bm, mats["pipe"], col, bevel=mm(1)).parent = st
    out["mandrel"] = grp
    out["y_tip0"] = y_tip0
    out["mandrel_inlet"] = Vector((0, -mm(1128), 0))

    # --- Caño conformado: curva Bézier con bisel Ø40 (una por cada ciclo) ---
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
    pob.hide_viewport = True
    out["profile"] = pob
    return out


def tube_sample_params():
    """Coordenadas material `s` de los puntos de control del caño: más densas en el campana y en el arco."""
    ss = set()
    L = mm(PIPE_LEN)
    for i in range(0, 61):
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


def build_forming_tube(station, index):
    """Caño que se deforma en la matriz: Bézier + Bevel Object Ø40, con el radio de los puntos para la campana."""
    col = station["col"]
    name = f"Caño_Conformado_{index + 1:02d}"
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
    mat = temp_material(f"Material_{name}", 120.0)
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    col.objects.link(ob)
    return ob, sp, ss, mat


def pose_forming_tube(sp, ss, beta, bell_tip=None):
    """Coloca los puntos de control del caño para la fracción de curvado `beta` y el cono en `bell_tip` (y de la punta)."""
    n = len(ss)
    pts = []
    for s in ss:
        y, z, phi = tube_path(s, beta)
        pts.append((y, z, phi))
    for i, (bp, (y, z, phi)) in enumerate(zip(sp.bezier_points, pts)):
        t = Vector((0.0, cos(phi), sin(phi)))
        s = ss[i]
        dl = (s - ss[i - 1]) / 3 if i > 0 else (ss[1] - ss[0]) / 3
        dr = (ss[i + 1] - s) / 3 if i < n - 1 else dl
        c = Vector((0.0, y, z))
        bp.co = c
        bp.handle_left = c - t * dl
        bp.handle_right = c + t * dr
        bp.radius = 1.0


def bell_factor(s, y_tip):
    """Factor de radio de la campana en la coordenada s con la punta del cono en y_tip (cono de 10° semiángulo)."""
    behind = (y_tip - TUBE_Y0) - s  # distancia detrás de la punta, medida sobre el caño
    if behind <= 0:
        return 1.0
    r_cone = mm(CONE_TIP_R) + behind * math.tan(radians(CONE_HALF_ANGLE))
    return max(1.0, r_cone / mm(PIPE_OD / 2))


def key_forming_tube(sp, f, with_radius=True):
    for bp in sp.bezier_points:
        bp.keyframe_insert("co", frame=f)
        bp.keyframe_insert("handle_left", frame=f)
        bp.keyframe_insert("handle_right", frame=f)
        if with_radius:
            bp.keyframe_insert("radius", frame=f)


# ============================================================================================
# 3. Tanque de 500 L, electrobomba y cañerías
# ============================================================================================


def build_tank_pump_pipes(root, station):
    col = new_collection("03_Tanque_Bomba_Cañerías", root)
    O = STATION_ORIGIN
    m = station["mats"]
    steel = make_material("Acero_Tanque", (0.72, 0.74, 0.78), metallic=1.0, roughness=0.32)
    paint = make_material("Pintura_Bomba", (0.05, 0.28, 0.55), metallic=0.4, roughness=0.4)
    cast = make_material("Fundición_Bomba", (0.2, 0.22, 0.25), metallic=0.9, roughness=0.5)
    height = (TANK_LITERS / 1000.0) / (pi * TANK_R**2)
    fl = FLOOR_Z
    tx, ty = O.x + TANK_POS.x, O.y + TANK_POS.y
    base = fl + 0.10  # el tanque apoya sobre patas
    bm = bmesh.new()
    add_cyl(bm, TANK_R, height, (tx, ty, base + height / 2), (0, 0, 1), 96)
    add_torus(bm, TANK_R, mm(14), (tx, ty, base + height), (0, 0, 1), 96, 12)
    add_torus(bm, TANK_R, mm(14), (tx, ty, base), (0, 0, 1), 96, 12)
    for k in range(3):  # cordones de refuerzo
        add_torus(bm, TANK_R, mm(8), (tx, ty, base + height * (k + 1) / 4), (0, 0, 1), 96, 8)
    add_cyl(bm, mm(110), mm(40), (tx - 0.12, ty - 0.12, base + height + mm(20)), (0, 0, 1), 40)  # boca de inspección
    tank = finish("Tanque_500L", bm, steel, col)
    bm = bmesh.new()
    for k in range(4):
        a = radians(45 + 90 * k)
        add_box(bm, (mm(70), mm(70), 0.10), (tx + (TANK_R - 0.07) * cos(a), ty + (TANK_R - 0.07) * sin(a), fl + 0.05))
    finish("Patas_Tanque", bm, m["frame"], col, smooth=False, bevel=mm(2))
    top_z = base + height

    # --- Electrobomba centrífuga en la base del tanque (lado -Y) ---
    py = ty - TANK_R - 0.26
    pz = fl + mm(110)
    bm = bmesh.new()
    add_cyl(bm, mm(88), mm(250), (tx, py - 0.13, pz), (0, 1, 0), 48)  # motor
    for k in range(10):  # aletas
        add_cyl(bm, mm(94), mm(5), (tx, py - 0.22 + k * 0.025, pz), (0, 1, 0), 48)
    add_box(bm, (mm(90), mm(100), mm(70)), (tx, py - 0.1, pz + mm(120)))  # caja de bornes
    add_cyl(bm, mm(80), mm(30), (tx, py - 0.275, pz), (0, 1, 0), 40)  # tapa ventilador
    motor = finish("Electrobomba_Motor", bm, paint, col, bevel=mm(1))
    bm = bmesh.new()
    add_cyl(bm, mm(105), mm(80), (tx, py + 0.04, pz), (0, 1, 0), 48)  # voluta
    add_cyl(bm, mm(26), mm(110), (tx, py + 0.14, pz), (0, 1, 0), 32)  # boca de aspiración
    add_cyl(bm, mm(22), mm(120), (tx, py + 0.04, pz + mm(150)), (0, 0, 1), 32)  # descarga
    add_cyl(bm, mm(36), mm(14), (tx, py + 0.20, pz), (0, 1, 0), 32)  # brida
    add_cyl(bm, mm(32), mm(14), (tx, py + 0.04, pz + mm(212)), (0, 0, 1), 32)
    add_box(bm, (mm(220), mm(520), mm(20)), (tx, py - 0.1, fl + mm(10)))  # base
    finish("Electrobomba_Voluta", bm, cast, col, bevel=mm(1))
    inlet = Vector((tx, py + 0.20, pz))
    outlet = Vector((tx, py + 0.04, pz + mm(220)))

    # --- Cañerías: aspiración (tanque → bomba), impulsión (bomba → mandril) y rebalse (vaso → tanque) ---
    tank_out = Vector((tx, ty - TANK_R, pz))
    make_pipe("Cañería_Aspiración", [tank_out, inlet], mm(23), m["pipe"], col, fillet=0.04)
    inlet_m = O + station["mandrel_inlet"]
    route = [outlet, Vector((tx, outlet.y, fl + 0.46)), Vector((tx, inlet_m.y - 0.12, fl + 0.46)), Vector((inlet_m.x, inlet_m.y - 0.12, fl + 0.46)), Vector((inlet_m.x, inlet_m.y - 0.12, inlet_m.z)), inlet_m]
    make_pipe("Cañería_Impulsión_Mandril", route, mm(16), m["pipe"], col, fillet=0.07)
    out = O + station["cup_outlet"]
    hose = [out, out + Vector((0, 0, -0.02)), Vector((out.x, out.y + 0.11, out.z - 0.02)), Vector((tx, out.y + 0.11, out.z - 0.02)), Vector((tx, out.y + 0.11, top_z + 0.02)), Vector((tx, out.y + 0.11, top_z - 0.12))]
    make_pipe("Manguera_Rebalse", hose, mm(13), m["hose"], col, fillet=0.08)
    return {"col": col, "tank": tank, "motor": motor}


# ============================================================================================
# 4. Cinemática y animación (30 FPS)
# ============================================================================================


def phase_frames(start):
    """Devuelve ({nombre: (f0, f1)}, f_fin) para un ciclo que empieza en el cuadro `start`."""
    d, f = {}, start
    for name, sec in PHASES:
        n = fr(sec)
        d[name] = (f, f + n)
        f += n
    return d, f


def key_loc(ob, f, loc):
    ob.location = loc
    ob.keyframe_insert("location", frame=f)


def key_vis(ob, f, visible):
    ob.hide_viewport = not visible
    ob.hide_render = not visible
    ob.keyframe_insert("hide_viewport", frame=f)
    ob.keyframe_insert("hide_render", frame=f)


def animate(scene, bath, station, n_cycles):
    O = STATION_ORIGIN
    S = bath["S"]
    rotor, tubes = bath["rotor"], bath["tubes"]
    mats = [t.data.materials[0] for t in tubes]

    # --- cronograma de todos los ciclos ---
    start, cycles = 1, []
    for c in range(n_cycles):
        ph, end = phase_frames(start)
        cycles.append((start, ph, end))
        start = end
    total = start
    scene.frame_start, scene.frame_end = 1, total

    # --- giro de indexado del carrusel: −22,5° por ciclo (la posición sube por la derecha) ---
    rotor.rotation_euler = (0, 0, 0)
    rotor.keyframe_insert("rotation_euler", frame=1)
    for c, (f0, ph, f1) in enumerate(cycles):
        a, b = ph["index"]
        rotor.rotation_euler = (0, -radians(STEP_DEG) * c, 0)
        rotor.keyframe_insert("rotation_euler", frame=a)
        rotor.rotation_euler = (0, -radians(STEP_DEG) * (c + 1), 0)
        rotor.keyframe_insert("rotation_euler", frame=b)
    rotor.rotation_euler = (0, -radians(STEP_DEG) * n_cycles, 0)
    rotor.keyframe_insert("rotation_euler", frame=total)

    # --- color/visibilidad de cada tubo del carrusel (gradiente térmico de la simulación 2D) ---
    for m, (tb, mat) in enumerate(zip(tubes, mats)):
        j = (-m) % SLOTS  # posición antes del primer indexado
        visible = j <= 12  # la posición de RETIRO (13) ya fue vaciada antes de empezar
        set_tube_temp(mat, S[j] if j <= 12 else AMBIENT, frame=1)
        key_vis(tb, 1, visible)
        for c, (f0, ph, f1) in enumerate(cycles):
            j += 1
            jm = j % SLOTS
            a, b = ph["index"]
            tp0 = ph["transfer"][0]
            if jm == 0:  # llega a la carga: entra un caño frío nuevo
                key_vis(tb, a, True)
                set_tube_temp(mat, AMBIENT, frame=a)
                set_tube_temp(mat, AMBIENT, frame=f1)
            elif 1 <= jm <= 13:
                set_tube_temp(mat, S[jm - 1], frame=a)
                if jm < 13:
                    set_tube_temp(mat, S[jm], frame=f1)
                else:  # RETIRO: el operario lo toma al empezar el traslado
                    key_vis(tb, a, True)
                    key_vis(tb, tp0, False)
            else:  # posición vacía tras el retiro (14, 15)
                key_vis(tb, a, False)

    # --- estación: un caño conformado por ciclo ---
    jaw_parts, die, rod, mand, water = station["jaw_parts"], station["moving"], station["moving_rod"], station["mandrel"], station["water"]
    open_vec = station["die_open_vec"]
    pick_world = Vector((mm(MOUNT_R) * sin(radians(PICK_K * STEP_DEG)), 0.0, mm(MOUNT_R) * cos(radians(PICK_K * STEP_DEG))))
    wy, wz0 = station["cup_water_pivot"]
    for key_ob, loc in ((die, open_vec), (rod, open_vec)):
        key_loc(key_ob, 1, loc)
    for jp in jaw_parts:
        key_loc(jp, 1, (0, 0, -mm(CLAMP_TRAVEL)))
    key_loc(mand, 1, (0, mm(0), 0))
    water.scale = (1, 1, 0.001)
    water.keyframe_insert("scale", frame=1)

    ss = tube_sample_params()
    for c, (f0, ph, f1) in enumerate(cycles):
        ob, sp, ss, tmat = build_forming_tube(station, c)
        parent_keep(ob, station["root"])
        tub_start = ph["transfer"][0]
        # visibilidad: sólo existe desde el traslado hasta el final de la extracción
        key_vis(ob, 1, False)
        key_vis(ob, tub_start, True)
        key_vis(ob, ph["extract"][1], False)
        loc_pick = pick_world - O
        # --- traslado del caño caliente a la matriz fija ---
        a, b = ph["transfer"]
        key_loc(ob, a, loc_pick)
        key_loc(ob, a + (b - a) // 2, (loc_pick.x + (0 - loc_pick.x) * 0.5, 0, 0.05 + (loc_pick.z + 0.0) * 0.5))
        key_loc(ob, b, (0, 0, 0))
        pose_forming_tube(sp, ss, 0.0)
        key_forming_tube(sp, a)
        key_forming_tube(sp, b)
        t0_pick = S[12]
        set_tube_temp(tmat, t0_pick, frame=a)
        # --- cierre de matriz móvil + curvado a 90° ---
        a, b = ph["die_close"]
        key_loc(die, a, open_vec)
        key_loc(rod, a, open_vec)
        key_loc(die, b, (0, 0, 0))
        key_loc(rod, b, (0, 0, 0))
        n_k = max(4, (b - a) // 2)
        for i in range(n_k + 1):
            f = a + round((b - a) * i / n_k)
            pose_forming_tube(sp, ss, smoothstep(i / n_k))
            key_forming_tube(sp, f, with_radius=False)
        for bp in sp.bezier_points:
            bp.radius = 1.0
            bp.keyframe_insert("radius", frame=b)
        set_tube_temp(tmat, t0_pick - 2.0, frame=b)
        # --- bloqueo de la mordaza inferior ---
        a, b = ph["clamp"]
        for jp in jaw_parts:
            key_loc(jp, a, (0, 0, -mm(CLAMP_TRAVEL)))
            key_loc(jp, b, (0, 0, 0))
        # --- avance del mandril abocardador (carrera de 100 mm) y formación de la campana ---
        a, b = ph["mandrel"]
        approach_end = a + fr(MANDREL_APPROACH_S)
        stroke = mm(MANDREL_STROKE)
        key_loc(mand, a, (0, 0, 0))
        key_loc(mand, approach_end, (0, stroke * MANDREL_APPROACH_FRAC, 0))
        key_loc(mand, b, (0, stroke, 0))
        pose_forming_tube(sp, ss, 1.0)
        bell_done = [1.0] * len(ss)
        n_k = max(6, (b - a) // 2)
        for i in range(n_k + 1):
            f = a + round((b - a) * i / n_k)
            if f <= approach_end:
                adv = stroke * MANDREL_APPROACH_FRAC * smoothstep((f - a) / max(1, approach_end - a))
            else:
                adv = stroke * (MANDREL_APPROACH_FRAC + (1 - MANDREL_APPROACH_FRAC) * smoothstep((f - approach_end) / max(1, b - approach_end)))
            y_tip = station["y_tip0"] + adv
            for k, bp in enumerate(sp.bezier_points):
                bell_done[k] = max(bell_done[k], bell_factor(ss[k], y_tip))
                bp.radius = bell_done[k]
                bp.keyframe_insert("radius", frame=f)
        # --- pausa de enfriamiento: llenado y rebalse del vaso, la pieza baja a ~50 °C ---
        a, b = ph["cool"]
        n_k = max(6, int((b - a) / FPS))
        t_water = scene_water_temp()
        tc0 = t0_pick - 2.0
        # decaimiento exponencial calibrado para llegar a DEMOLD_TEMP al terminar la pausa
        tau = (b - a) / FPS / math.log((tc0 - t_water) / (DEMOLD_TEMP - t_water))
        for i in range(n_k + 1):
            f = a + round((b - a) * i / n_k)
            set_tube_temp(tmat, t_water + (tc0 - t_water) * exp(-((f - a) / FPS) / tau), frame=f)
        water.scale = (1, 1, 0.02)
        water.keyframe_insert("scale", frame=a)
        water.scale = (1, 1, 1.0)
        water.keyframe_insert("scale", frame=a + min(b - a - 1, fr(4.0)))
        # --- retroceso secuencial: mandril, mordaza y matriz ---
        a, b = ph["mandrel_back"]
        key_loc(mand, a, (0, stroke, 0))
        key_loc(mand, b, (0, 0, 0))
        water.scale = (1, 1, 1.0)
        water.keyframe_insert("scale", frame=a)
        water.scale = (1, 1, 0.001)
        water.keyframe_insert("scale", frame=b)
        a, b = ph["clamp_open"]
        for jp in jaw_parts:
            key_loc(jp, a, (0, 0, 0))
            key_loc(jp, b, (0, 0, -mm(CLAMP_TRAVEL)))
        a, b = ph["die_open"]
        key_loc(die, a, (0, 0, 0))
        key_loc(rod, a, (0, 0, 0))
        key_loc(die, b, open_vec)
        key_loc(rod, b, open_vec)
        # --- extracción de la pieza: sale hacia −X y se eleva ---
        a, b = ph["extract"]
        mid = a + (b - a) // 3
        key_loc(ob, a, (0, 0, 0))
        key_loc(ob, mid, (-0.14, 0, 0))
        key_loc(ob, b, (-0.14, 0, 0.62))
        set_tube_temp(tmat, DEMOLD_TEMP, frame=a)
        set_tube_temp(tmat, DEMOLD_TEMP - 3, frame=b)
        # el último cuadro del ciclo: el vaso y los actuadores quedan en reposo
        key_loc(die, f1, open_vec)
        key_loc(rod, f1, open_vec)
        for jp in jaw_parts:
            key_loc(jp, f1, (0, 0, -mm(CLAMP_TRAVEL)))
        key_loc(mand, f1, (0, 0, 0))
    return total, cycles


def scene_water_temp():
    return 22.0


# ============================================================================================
# 5. Escena: luces, cámaras, mundo y render
# ============================================================================================


def build_scene_setup(scene, root):
    col = new_collection("04_Escena", root)
    # mundo
    world = bpy.data.worlds.new("Mundo_Planta")
    world.use_nodes = True
    wnodes = world.node_tree.nodes
    bg = find_node(wnodes, "BACKGROUND") or wnodes.new(type="ShaderNodeBackground")
    wout = find_node(wnodes, "OUTPUT_WORLD") or wnodes.new(type="ShaderNodeOutputWorld")
    if not wout.inputs[0].is_linked:  # entrada 0 = Surface
        world.node_tree.links.new(bg.outputs[0], wout.inputs[0])
    bg.inputs[0].default_value = (*lin((0.07, 0.09, 0.12)), 1.0)  # Color
    bg.inputs[1].default_value = 0.9  # Strength
    scene.world = world
    # luces
    sun = bpy.data.lights.new("Sol_Nave", "SUN")
    sun.energy = 2.2
    sun.angle = radians(6)
    so = bpy.data.objects.new("Sol_Nave", sun)
    so.rotation_euler = (radians(52), radians(8), radians(-35))
    col.objects.link(so)
    for name, loc, power, size in (("Panel_Central", (0.9, -0.2, 2.6), 900, 3.0), ("Panel_Carrusel", (0.0, -1.6, 1.6), 350, 2.0), ("Panel_Estación", (1.2, -1.4, 1.5), 450, 2.0)):
        li = bpy.data.lights.new(name, "AREA")
        li.energy, li.size = power, size
        lo = bpy.data.objects.new(name, li)
        lo.location = loc
        d = Vector((0.7, -0.1, 0.0)) - Vector(loc)
        lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        col.objects.link(lo)
    # cámaras con objetivo
    def cam(name, loc, target, lens):
        cd = bpy.data.cameras.new(name)
        cd.lens = lens
        cd.clip_end = 50
        co = bpy.data.objects.new(name, cd)
        co.location = loc
        col.objects.link(co)
        tgt = make_empty(f"Objetivo_{name}", col, target, size=0.05)
        c = co.constraints.new("TRACK_TO")
        c.target, c.track_axis, c.up_axis = tgt, "TRACK_NEGATIVE_Z", "UP_Y"
        return co

    cams = {
        "Cam_General": cam("Cam_General", (0.2, -4.6, 1.5), (1.0, -0.1, 0.0), 30),
        "Cam_Estacion": cam("Cam_Estacion", (-0.2, -1.9, 0.75), (1.15, -0.2, 0.28), 38),
        "Cam_Carrusel": cam("Cam_Carrusel", (-1.2, -2.4, 0.55), (0.0, 0.0, -0.05), 36),
    }
    scene.camera = cams["Cam_General"]
    # render
    r = scene.render
    r.fps = FPS
    r.resolution_x, r.resolution_y, r.resolution_percentage = 1920, 1080, 100
    r.film_transparent = False
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
    scene.view_settings.exposure = 0.0
    return cams


# ============================================================================================
# main
# ============================================================================================


def setup_viewport(scene):
    """Con la interfaz abierta: vista de cámara con materiales (Material Preview) y la línea de tiempo en el cuadro 1."""
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
        pass  # un cambio de vista nunca debe romper la generación de la escena


def default_save_path():
    """Junto al script si se conoce su ruta; si no (p. ej. desde el editor de texto), en la carpeta del usuario."""
    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.expanduser("~")
    return os.path.join(here, "celda_conduit_3d.blend")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Genera la simulación 3D de la celda de conformado de curvas conduit")
    p.add_argument("--save", default=None)
    p.add_argument("--no-save", action="store_true")
    p.add_argument("--cycles", type=int, default=N_CYCLES)
    p.add_argument("--cool", type=float, default=None)
    p.add_argument("--render-frames", default=None)
    p.add_argument("--out", default="/tmp/celda3d")
    p.add_argument("--samples", type=int, default=24)
    p.add_argument("--camera", default="Cam_General")
    p.add_argument("--res", default=None, help="ANCHOxALTO para los renders de cuadros, p. ej. 960x540")
    return p.parse_args(argv)


def main():
    global PHASES
    args = parse_args()
    if args.cool is not None:
        PHASES = [(n, args.cool if n == "cool" else s) for n, s in PHASES]
    clear_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "MILLIMETERS"
    root = scene.collection
    bath = build_bath_and_carousel(root)
    station = build_station(root)
    build_tank_pump_pipes(root, station)
    cams = build_scene_setup(scene, root)
    total, cycles = animate(scene, bath, station, args.cycles)
    scene.frame_set(1)
    print(f"[generar_simulacion_3d] {len(bpy.data.objects)} objetos · {total} cuadros a {FPS} FPS ({total / FPS:.1f} s) · {args.cycles} ciclos")

    if args.render_frames:
        scene.camera = cams[args.camera]
        scene.render.engine = "CYCLES"
        scene.cycles.samples = args.samples
        scene.cycles.use_denoising = False
        if args.res:
            w, h = args.res.lower().split("x")
            scene.render.resolution_x, scene.render.resolution_y = int(w), int(h)
        scene.render.image_settings.file_format = "PNG"
        for f in [int(v) for v in args.render_frames.split(",")]:
            scene.frame_set(f)
            scene.render.filepath = f"{args.out}_{f:05d}.png"
            bpy.ops.render.render(write_still=True)
            print("[generar_simulacion_3d] render:", scene.render.filepath)
        return
    if not args.no_save:
        path = args.save or default_save_path()
        try:
            bpy.ops.wm.save_as_mainfile(filepath=path)
            print("[generar_simulacion_3d] guardado:", path)
        except RuntimeError as exc:  # carpeta sin permiso de escritura: la escena queda abierta igual
            print("[generar_simulacion_3d] no se pudo guardar:", exc)
    setup_viewport(scene)


if __name__ == "__main__":
    main()
