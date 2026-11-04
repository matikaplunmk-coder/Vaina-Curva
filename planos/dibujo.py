"""Mini biblioteca de dibujo técnico 2D: las mismas primitivas se escriben a PDF (reportlab) y a DXF (ezdxf).

Coordenadas del papel en mm con Y hacia arriba. Una `Vista` convierte coordenadas del modelo (mm reales) a papel con una escala.
"""
import math

from reportlab.lib.colors import black
from reportlab.pdfgen import canvas as rl_canvas

import ezdxf

A3 = (420.0, 297.0)

# estilo -> (ancho de línea PDF [mm], patrón de trazos [mm] o None, capa DXF, color DXF)
STYLES = {
    "v": (0.50, None, "CONTORNO", 7),
    "t": (0.25, None, "FINAS", 8),
    "h": (0.25, (3.0, 1.5), "OCULTAS", 8),
    "c": (0.25, (9.0, 1.5, 1.5, 1.5), "EJES", 1),
    "b": (0.70, None, "MARCO", 7),
    "d": (0.20, None, "COTAS", 3),
}
LINETYPE = {"h": "DASHED", "c": "CENTER"}


def fmt(v):
    r = round(v, 1)
    return str(int(r)) if abs(r - round(r)) < 1e-9 else f"{r:.1f}".rstrip("0").rstrip(".")


class Hoja:
    def __init__(self, ancho=A3[0], alto=A3[1]):
        self.w, self.h = ancho, alto
        self.ents = []

    # ---- primitivas en papel ----
    def line(self, a, b, st="v"):
        self.ents.append(("line", st, tuple(a), tuple(b)))

    def circle(self, c, r, st="v"):
        self.ents.append(("circle", st, tuple(c), r))

    def arc(self, c, r, a0, a1, st="v"):
        self.ents.append(("arc", st, tuple(c), r, a0, a1))

    def poly(self, pts, st="v", closed=True):
        self.ents.append(("poly", st, [tuple(p) for p in pts], closed))

    def fill(self, pts):
        self.ents.append(("fill", [tuple(p) for p in pts]))

    def rect(self, x0, y0, x1, y1, st="v"):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], st, True)

    def text(self, p, s, h=3.0, anchor="l", rot=0.0):
        self.ents.append(("text", tuple(p), s, h, anchor, rot))

    def arrow(self, tip, ang_deg, size=2.6):
        """Punta de flecha rellena con la punta en `tip`, apuntando hacia ang (dirección en la que avanza la punta)."""
        a = math.radians(ang_deg)
        ux, uy = math.cos(a), math.sin(a)
        bx, by = tip[0] - ux * size, tip[1] - uy * size
        nx, ny = -uy * size * 0.17, ux * size * 0.17
        self.ents.append(("arrow", tuple(tip), [(tip[0], tip[1]), (bx + nx, by + ny), (bx - nx, by - ny)]))

    # ---- marco y cajetín ----
    def marco(self, titulo, componente, hoja_n, hoja_t, escala, material, notas=None, rev="A", estado="PARA REVISIÓN — verificar cotas marcadas antes de fabricar"):
        W, H = self.w, self.h
        self.rect(20, 10, W - 10, H - 10, "b")
        self.rect(5, 5, W - 5, H - 5, "t")
        x0, y0, x1, y1 = W - 10 - 185, 10, W - 10, 10 + 46
        self.rect(x0, y0, x1, y1, "b")
        self.line((x0, y0 + 30), (x1, y0 + 30), "v")
        self.line((x0, y0 + 20), (x1, y0 + 20), "t")
        self.line((x0, y0 + 10), (x1, y0 + 10), "t")
        self.line((x0 + 95, y0), (x0 + 95, y0 + 20), "t")
        self.line((x0 + 140, y0), (x0 + 140, y0 + 20), "t")
        self.text((x0 + 3, y0 + 36), titulo, 5.0)
        self.text((x0 + 3, y0 + 31.8), componente, 3.0)
        self.text((x0 + 3, y0 + 23), "Proyecto: Celda de conformado de curvas conduit PEAD Ø40 (Vaina-Curva)", 2.6)
        self.text((x0 + 3, y0 + 13), f"Material: {material}", 2.6)
        self.text((x0 + 3, y0 + 3.5), f"Estado: {estado}", 2.2)
        self.text((x0 + 98, y0 + 13), f"Escala: {escala}", 2.6)
        self.text((x0 + 98, y0 + 3.5), "Cotas en mm", 2.6)
        self.text((x0 + 143, y0 + 13), f"Hoja {hoja_n}/{hoja_t}", 2.8)
        self.text((x0 + 143, y0 + 3.5), f"Rev. {rev}", 2.8)
        self.text((x0 + 3, y0 + 16.2), "Tolerancias generales ISO 2768-mK · rugosidad Ra 6,3 salvo indicación", 2.2)
        if notas:
            nx, ny = 24, 14 + 4.2 * len(notas)
            self.text((nx, ny + 4), "NOTAS", 3.0)
            for i, n in enumerate(notas):
                self.text((nx, ny - 4.2 * i - 0.5), n, 2.3)

    # ---- escritura ----
    def a_pdf(self, c):
        c.setPageSize((self.w * 72 / 25.4, self.h * 72 / 25.4))
        k = 72 / 25.4
        c.setStrokeColor(black)
        c.setFillColor(black)
        for e in self.ents:
            kind = e[0]
            if kind in ("line", "circle", "arc", "poly"):
                lw, dash, _, _ = STYLES[e[1]]
                c.setLineWidth(lw * k)
                c.setDash(*( [[d * k for d in dash], 0] if dash else [[], 0]))
            if kind == "line":
                c.line(e[2][0] * k, e[2][1] * k, e[3][0] * k, e[3][1] * k)
            elif kind == "circle":
                c.circle(e[2][0] * k, e[2][1] * k, e[3] * k, stroke=1, fill=0)
            elif kind == "arc":
                (cx, cy), r, a0, a1 = e[2], e[3], e[4], e[5]
                sweep = (a1 - a0) % 360 or 360
                c.arc((cx - r) * k, (cy - r) * k, (cx + r) * k, (cy + r) * k, a0, sweep)
            elif kind == "poly":
                p = c.beginPath()
                pts = e[2]
                p.moveTo(pts[0][0] * k, pts[0][1] * k)
                for q in pts[1:]:
                    p.lineTo(q[0] * k, q[1] * k)
                if e[3]:
                    p.close()
                c.drawPath(p, stroke=1, fill=0)
            elif kind in ("fill", "arrow"):
                pts = e[1] if kind == "fill" else e[2]
                c.setDash([], 0)
                p = c.beginPath()
                p.moveTo(pts[0][0] * k, pts[0][1] * k)
                for q in pts[1:]:
                    p.lineTo(q[0] * k, q[1] * k)
                p.close()
                c.drawPath(p, stroke=0, fill=1)
            elif kind == "text":
                (x, y), s, h, anchor, rot = e[1], e[2], e[3], e[4], e[5]
                c.saveState()
                c.translate(x * k, y * k)
                c.rotate(rot)
                c.setFont("Helvetica", h * k)
                w = c.stringWidth(s, "Helvetica", h * k)
                dx = {"l": 0, "c": -w / 2, "r": -w}[anchor]
                c.drawString(dx, 0, s)
                c.restoreState()
        c.showPage()

    def a_dxf(self, doc):
        msp = doc.modelspace()
        for st, (_, _, capa, color) in STYLES.items():
            if capa not in doc.layers:
                doc.layers.add(capa, color=color, linetype=LINETYPE.get(st, "Continuous"))
        if "TEXTO" not in doc.layers:
            doc.layers.add("TEXTO", color=7)
        for e in self.ents:
            kind = e[0]
            if kind in ("line", "circle", "arc", "poly"):
                capa = STYLES[e[1]][2]
            if kind == "line":
                msp.add_line(e[2], e[3], dxfattribs={"layer": capa})
            elif kind == "circle":
                msp.add_circle(e[2], e[3], dxfattribs={"layer": capa})
            elif kind == "arc":
                msp.add_arc(e[2], e[3], e[4], e[5], dxfattribs={"layer": capa})
            elif kind == "poly":
                msp.add_lwpolyline(e[2], close=e[3], dxfattribs={"layer": capa})
            elif kind == "fill":
                h = msp.add_hatch(color=7, dxfattribs={"layer": "CONTORNO"})
                h.paths.add_polyline_path(e[1], is_closed=True)
            elif kind == "arrow":
                h = msp.add_hatch(color=3, dxfattribs={"layer": "COTAS"})
                h.paths.add_polyline_path(e[2], is_closed=True)
            elif kind == "text":
                (x, y), s, hh, anchor, rot = e[1], e[2], e[3], e[4], e[5]
                t = msp.add_text(s, height=hh, rotation=rot, dxfattribs={"layer": "TEXTO"})
                al = {"l": "LEFT", "c": "MIDDLE_CENTER", "r": "RIGHT"}[anchor]
                t.set_placement((x, y), align=ezdxf.enums.TextEntityAlignment[al] if anchor != "l" else ezdxf.enums.TextEntityAlignment.LEFT)


class Vista:
    """Convierte coordenadas del modelo (mm reales) a papel: P = origen + modelo × escala."""

    def __init__(self, hoja, ox, oy, escala):
        self.h, self.ox, self.oy, self.s = hoja, ox, oy, escala

    def P(self, x, y):
        return (self.ox + x * self.s, self.oy + y * self.s)

    # ---- geometría ----
    def line(self, a, b, st="v"):
        self.h.line(self.P(*a), self.P(*b), st)

    def circle(self, c, r, st="v"):
        self.h.circle(self.P(*c), r * self.s, st)

    def arc(self, c, r, a0, a1, st="v"):
        self.h.arc(self.P(*c), r * self.s, a0, a1, st)

    def poly(self, pts, st="v", closed=True):
        self.h.poly([self.P(*p) for p in pts], st, closed)

    def fill(self, pts):
        self.h.fill([self.P(*p) for p in pts])

    def rect(self, x0, y0, x1, y1, st="v"):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], st, True)

    def centro(self, c, r, ext=3.0, st="c"):
        """Cruz de ejes para un agujero/círculo de radio r (modelo)."""
        x, y = c
        e = ext / self.s
        self.line((x - r - e, y), (x + r + e, y), st)
        self.line((x, y - r - e), (x, y + r + e), st)

    def text(self, x, y, s, h=3.0, anchor="l", rot=0.0):
        self.h.text(self.P(x, y), s, h, anchor, rot)

    # ---- cotas ----
    def dim_h(self, x1, x2, y, off, texto=None, pref="", suf=""):
        """Cota horizontal entre x1 y x2 (referidas a y); la línea de cota queda `off` mm de papel por encima (o por debajo si off<0)."""
        a, b = self.P(x1, y), self.P(x2, y)
        yd = a[1] + off
        sg = 1 if off >= 0 else -1
        for p in (a, b):
            self.h.line((p[0], p[1] + sg * 1.0), (p[0], yd + sg * 1.6), "d")
        self.h.line((a[0], yd), (b[0], yd), "d")
        d = 1 if b[0] >= a[0] else -1
        self.h.arrow((a[0], yd), 0 if d < 0 else 180)
        self.h.arrow((b[0], yd), 180 if d < 0 else 0)
        # las flechas apuntan hacia afuera de la cota: la punta toca la línea de extensión
        s = texto if texto is not None else pref + fmt(abs(x2 - x1)) + suf
        self.h.text(((a[0] + b[0]) / 2, yd + (1.0 if sg > 0 else -3.6)), s, 3.0, "c")

    def dim_v(self, y1, y2, x, off, texto=None, pref="", suf=""):
        """Cota vertical entre y1 y y2 (referidas a x); la línea de cota queda `off` mm de papel a la derecha (o izquierda si off<0)."""
        a, b = self.P(x, y1), self.P(x, y2)
        xd = a[0] + off
        sg = 1 if off >= 0 else -1
        for p in (a, b):
            self.h.line((p[0] + sg * 1.0, p[1]), (xd + sg * 1.6, p[1]), "d")
        self.h.line((xd, a[1]), (xd, b[1]), "d")
        d = 1 if b[1] >= a[1] else -1
        self.h.arrow((xd, a[1]), 90 if d < 0 else 270)
        self.h.arrow((xd, b[1]), 270 if d < 0 else 90)
        s = texto if texto is not None else pref + fmt(abs(y2 - y1)) + suf
        self.h.text((xd + (-1.0 if sg > 0 else 1.0) * -1.0 + (0 if sg > 0 else 0), (a[1] + b[1]) / 2), s, 3.0, "c", 90)

    def llamada(self, x, y, texto, dx, dy, h=2.8, punto=True):
        """Línea de referencia desde un punto del modelo hasta (dx, dy) mm de papel, con el texto sobre una repisa horizontal."""
        p = self.P(x, y)
        q = (p[0] + dx, p[1] + dy)
        self.h.line(p, q, "d")
        if punto:
            ang = math.degrees(math.atan2(p[1] - q[1], p[0] - q[0]))
            self.h.arrow(p, ang, 2.2)
        w = max(len(t) for t in texto.split("\n")) * h * 0.52
        lines = texto.split("\n")
        sg = 1 if dx >= 0 else -1
        self.h.line(q, (q[0] + sg * (w + 1.5), q[1]), "d")
        for i, t in enumerate(lines):
            self.h.text((q[0] + (0.8 if sg > 0 else -0.8 - w), q[1] + 0.8 + (len(lines) - 1 - i) * (h + 0.6)), t, h, "l")

    def radio(self, c, r, ang_deg, texto=None, largo=8.0):
        """Cota de radio: flecha sobre el arco en el ángulo dado y texto fuera."""
        a = math.radians(ang_deg)
        p = self.P(c[0] + r * math.cos(a), c[1] + r * math.sin(a))
        q = (p[0] + math.cos(a) * largo, p[1] + math.sin(a) * largo)
        self.h.line(p, q, "d")
        self.h.arrow(p, ang_deg + 180, 2.4)
        self.h.text((q[0] + (1.0 if math.cos(a) >= 0 else -1.0), q[1] + 0.5), texto or "R" + fmt(r), 3.0, "l" if math.cos(a) >= 0 else "r")

    def titulo(self, x, y, texto, h=3.8):
        self.h.text(self.P(x, y), texto, h, "l")


def guardar(hojas, base):
    """Escribe `base`.pdf (una página por hoja) y `base`_hojaN.dxf."""
    c = rl_canvas.Canvas(base + ".pdf")
    c.setTitle(base.split("/")[-1])
    for h in hojas:
        h.a_pdf(c)
    c.save()
    for i, h in enumerate(hojas, 1):
        doc = ezdxf.new("R2010", setup=True)
        doc.units = ezdxf.units.MM
        h.a_dxf(doc)
        doc.saveas(f"{base}_hoja{i}.dxf")
