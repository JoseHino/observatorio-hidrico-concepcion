# -*- coding: utf-8 -*-
"""Colector del Observatorio Hidrico del embalse de La Concepcion.

    python pipeline/build_data.py            # incremental (lo normal)
    python pipeline/build_data.py --todo     # rehace la cache de Hidrosur desde 2000

Fuentes:
  - REDIAM (Junta de Andalucia): reserva diaria del embalse a las 8:00, desde 1970.
  - Red Hidrosur (SAIH Cuencas Mediterraneas Andaluzas): cota del embalse y
    pluviometria diaria de las estaciones del entorno.

Reglas del kit que este fichero respeta:
  1. Solo lectura (ver la excepcion documentada en sources/hidrosur.py).
  2. Un fallo de una fuente no tumba el panel: se registra en meta.fallos y esa
     parte se queda con lo que habia en la cache.
  3. Nunca se publica un data.js peor que el vigente (umbral del 90 %).
"""

import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sources import rediam, hidrosur                      # noqa: E402
from sources.comun import escribir_js, paso, ok, aviso    # noqa: E402

# ---------------------------------------------------------------- Configuracion

EMBALSE = "La Concepción"
REDIAM_COD = "S16"                       # codigo de estacion en el visor REDIAM
HIDROSUR_ESTACION = "16"                 # estacion SAIH del embalse
HIDROSUR_COTA = "016E01"                 # COTA EMBALSE (BALANZA)

# Pluviometros SAIH del entorno: la propia presa (cuenca del rio Verde) y las
# estaciones mas proximas de la costa entre Ojen y San Pedro.
PLUVIOMETROS = [
    {"id": "016P01", "est": "16",  "nombre": "Presa de La Concepción"},
    {"id": "017P01", "est": "17",  "nombre": "Ojén"},
    {"id": "024P01", "est": "24",  "nombre": "EDAR de Marbella"},
    {"id": "116P01", "est": "116", "nombre": "Río Guadaiza"},
]
PLUVIO_REF = "016P01"                    # el de la presa manda en los KPI

HISTORICO_DESDE = datetime.date(2000, 1, 1)
SOLAPE_DIAS = 20                         # se repiden para recoger correcciones

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "data", "data.js")
CACHE = os.path.join(RAIZ, "pipeline", "cache", "hidrosur.json")

HOY = datetime.date.today()


# ------------------------------------------------------------------- Utilidades

def d(s):
    return datetime.date.fromisoformat(s)



def r(v, n=2):
    return None if v is None else round(v, n)


# ------------------------------------------------------------------------ Cache

def leer_cache():
    try:
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:                                             # noqa: BLE001
        return {"cota": {}, "lluvia": {}}


def guardar_cache(c):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def desde_para(serie, todo):
    if todo or not serie:
        return HISTORICO_DESDE
    return d(max(serie)) - datetime.timedelta(days=SOLAPE_DIAS)


# ------------------------------------------------------------------ Recoleccion

def recoger(todo=False):
    fallos = []
    cache = leer_cache()

    # --- REDIAM: reserva diaria ---------------------------------------------
    paso("REDIAM - reserva diaria del embalse")
    reserva = []
    try:
        reserva = rediam.serie_diaria(REDIAM_COD)
        ok(f"{len(reserva)} dias, {reserva[0][0]} -> {reserva[-1][0]}")
    except Exception as e:                                        # noqa: BLE001
        fallos.append(f"REDIAM: {e}")
        aviso(str(e))

    # --- Hidrosur: cota -----------------------------------------------------
    paso("Red Hidrosur - cota del embalse")
    try:
        ini = desde_para(cache["cota"], todo)
        nuevo = hidrosur.cota_diaria(HIDROSUR_ESTACION, HIDROSUR_COTA, ini, HOY)
        if not nuevo and ini < HOY - datetime.timedelta(days=60):
            raise RuntimeError("sin lecturas de cota")
        cache["cota"].update(nuevo)
        ok(f"{len(nuevo)} dias nuevos desde {ini}; cache {len(cache['cota'])} dias")
    except Exception as e:                                        # noqa: BLE001
        fallos.append(f"Hidrosur cota: {e}")
        aviso(str(e))

    # --- Hidrosur: pluviometria ---------------------------------------------
    paso("Red Hidrosur - pluviometria diaria")
    for p in PLUVIOMETROS:
        serie = cache["lluvia"].setdefault(p["id"], {})
        try:
            ini = desde_para(serie, todo)
            nuevo = hidrosur.lluvia_diaria(p["est"], p["id"], ini, HOY)
            serie.update(nuevo)
            ok(f"{p['nombre']}: {len(nuevo)} dias desde {ini}; cache {len(serie)}")
        except Exception as e:                                    # noqa: BLE001
            fallos.append(f"Hidrosur {p['id']}: {e}")
            aviso(f"{p['nombre']}: {e}")

    guardar_cache(cache)
    return construir(reserva, cache, fallos), fallos


# ------------------------------------------------------------------ Elaboracion
#
# Se publica la serie DIARIA completa y la web recorta y agrega segun el periodo
# que elija el usuario. Para que pese poco, cada serie va como fecha de inicio +
# lista de valores por dia consecutivo (null = dia sin dato, nunca 0).

def diaria(serie, inicio, fin, n=2):
    f0, f1 = d(inicio), d(fin)
    return [r(serie.get((f0 + datetime.timedelta(days=i)).isoformat()), n)
            for i in range((f1 - f0).days + 1)]


def construir(reserva, cache, fallos):
    datos = {"meta": {
        "embalse": EMBALSE,
        "actualizado": datetime.datetime.now(datetime.timezone.utc)
                        .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fallos": fallos,
    }}
    cota = cache.get("cota", {})
    res = {f: (v, c, p) for f, v, c, p in reserva}
    if not res:
        return datos

    ini, ult = min(res), max(res)
    v, c, p = res[ult]
    datos["embalse"] = {
        "fecha": ult, "volumen": v, "capacidad": c, "porcentaje": p,
        "cota": cota.get(ult) or (cota[max(cota)] if cota else None),
    }
    datos["meta"]["ultimo_periodo"] = ult

    # La capacidad oficial cambia con las revisiones de la curva de embalse:
    # se publica por tramos {desde, capacidad} en lugar de repetirla cada dia.
    tramos = []
    for f in sorted(res):
        cap = res[f][1]
        if not tramos or abs(tramos[-1]["capacidad"] - cap) > 0.005:
            tramos.append({"desde": f, "capacidad": cap})

    datos["embalse_diario"] = {
        "inicio": ini,
        "volumen": diaria({f: x[0] for f, x in res.items()}, ini, ult),
        "porcentaje": diaria({f: x[2] for f, x in res.items()}, ini, ult),
        "capacidad": tramos,
    }

    ll = cache.get("lluvia", {})
    ini_ll = min((min(s) for s in ll.values() if s), default=ult)
    fin_ll = max((max(s) for s in ll.values() if s), default=ult)
    datos["lluvia_diaria"] = {
        "inicio": ini_ll,
        "estaciones": [{"id": p["id"], "nombre": p["nombre"]} for p in PLUVIOMETROS],
        "ref": PLUVIO_REF,
        "series": {p["id"]: diaria(ll.get(p["id"], {}), ini_ll, fin_ll, 1)
                   for p in PLUVIOMETROS},
    }
    return datos


# --------------------------------------------------------------- Red de seguridad

def _contar_valores(obj):
    if isinstance(obj, dict):
        return sum(_contar_valores(v) for v in obj.values())
    if isinstance(obj, list):
        return sum(1 for v in obj if isinstance(v, (int, float)))
    return 0


def _vigente():
    if not os.path.exists(SALIDA):
        return None
    try:
        txt = open(SALIDA, encoding="utf-8").read()
        m = re.search(r"window\.\w+\s*=\s*(\{.*\});?\s*$", txt, re.S)
        return json.loads(m.group(1)) if m else None
    except Exception:                                             # noqa: BLE001
        return None


def main():
    todo = "--todo" in sys.argv
    print(f"== Observatorio hidrico - embalse de {EMBALSE} ==")
    datos, fallos = recoger(todo)

    nuevos = _contar_valores(datos)
    previo = _vigente()
    if previo is not None:
        antes = _contar_valores(previo)
        if antes and nuevos < antes * 0.9:
            aviso(f"ABORTADO: {nuevos} valores frente a {antes} publicados "
                  f"({nuevos / antes:.0%}). No se sobrescribe data.js.")
            return 1

    paso("Escritura")
    escribir_js(SALIDA, datos)
    if fallos:
        aviso(f"{len(fallos)} fuente(s) con incidencia: " + "; ".join(fallos))
    print(f"\nListo. {nuevos} valores. Ultimo dia: "
          f"{datos['meta'].get('ultimo_periodo', 'n/d')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
