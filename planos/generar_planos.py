"""Genera el juego de planos de fabricación (PDF multipágina + un DXF por hoja).

Uso:  python generar_planos.py [carpeta_de_salida]
Requiere: reportlab, ezdxf.
"""
import os
import sys

from dibujo import guardar
from hoja_batea import hoja_batea_detalles, hoja_batea_vistas
from hojas_resto import hoja_carrusel, hoja_conjunto, hoja_mesa, hoja_tanque


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out, exist_ok=True)
    total = 6
    hojas = [
        hoja_conjunto(1, total),
        hoja_batea_vistas(2, total),
        hoja_batea_detalles(3, total),
        hoja_carrusel(4, total),
        hoja_mesa(5, total),
        hoja_tanque(6, total),
    ]
    guardar(hojas, os.path.join(out, "planos_celda_vaina_curva"))
    print("listo:", out)


if __name__ == "__main__":
    main()
