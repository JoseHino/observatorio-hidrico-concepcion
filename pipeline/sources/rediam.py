# -*- coding: utf-8 -*-
"""REDIAM - Visor de embalses de Andalucia (Junta de Andalucia).

Reserva diaria de cada embalse andaluz a las 8:00, tal y como la reciben las
demarcaciones hidrograficas. Serie completa desde el primer dato del embalse.

    https://portalrediam.cica.es/embalses/api/csv/embalse/<cod>/<desde>/<hasta>

CSV con cabecera:  codigo,fecha,"reserva (Hm3)",capacidad,porcentaje,nombre

Ojo: la CAPACIDAD no es constante. La de La Concepcion pasa de 61,85 hm3 a
57,5 hm3 tras la actualizacion de la curva de embalse (aterramiento). Para
comparar epocas distintas manda el PORCENTAJE, no el volumen.
"""

import csv
import datetime
import io

from .comun import get

BASE = "https://portalrediam.cica.es/embalses/api"


def serie_diaria(cod, desde="1944-06-01", hasta=None):
    """Devuelve [(fecha_iso, reserva_hm3, capacidad_hm3, porcentaje)] ordenado."""
    hasta = hasta or datetime.date.today().isoformat()
    txt = get(f"{BASE}/csv/embalse/{cod}/{desde}/{hasta}", timeout=180).decode("utf-8-sig")
    filas = []
    for r in csv.reader(io.StringIO(txt)):
        if not r or r[0] != cod:
            continue
        try:
            filas.append((r[1], float(r[2]), float(r[3]), float(r[4])))
        except (ValueError, IndexError):
            continue        # dia sin dato: hueco, no cero
    filas.sort()
    return filas
