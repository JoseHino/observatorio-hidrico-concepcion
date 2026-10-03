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
import statistics
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
VENTANA_DIARIA = 3 * 366                 # dias que se publican en serie diaria
COMPLETITUD = 0.9                        # dias con dato para dar por bueno un total

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "data", "data.js")
CACHE = os.path.join(RAIZ, "pipeline", "cache", "hidrosur.json")

HOY = datetime.date.today()


# ------------------------------------------------------------------- Utilidades

def d(s):
    return datetime.date.fromisoformat(s)


def anio_hidro(f):
    """El ano hidrologico empieza el 1 de octubre: 2026-10-03 -> 2026 (2026/27)."""
    return f.year if f.month >= 10 else f.year - 1


def etiqueta_hidro(a):
    return f"{a}/{str(a + 1)[2:]}"


# Dias del ano hidrologico sin el 29 de febrero: 365 posiciones fijas.
DIAS_HIDRO = [(m, dd) for m in (10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9)
              for dd in range(1, 32)
              if not (m == 2 and dd > 28)
              and not (m in (4, 6, 9, 11) and dd > 30)]
POS_HIDRO = {md: i for i, md in enumerate(DIAS_HIDRO)}


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

def construir(reserva, cache, fallos):
    datos = {"meta": {
        "embalse": EMBALSE,
        "actualizado": datetime.datetime.now(datetime.timezone.utc)
                        .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fallos": fallos,
    }}
    cota = cache.get("cota", {})
    res = {f: (v, c, p) for f, v, c, p in reserva}

    if res:
        ult = max(res)
        v, c, p = res[ult]
        datos["embalse"] = {
            "fecha": ult, "volumen": v, "capacidad": c, "porcentaje": p,
            "cota": cota.get(ult) or (cota[max(cota)] if cota else None),
            "cota_fecha": ult if ult in cota else (max(cota) if cota else None),
            "primer_dato": min(res),
        }
        datos["meta"]["ultimo_periodo"] = ult

        # Serie diaria reciente (volumen, % y cota alineados por fecha).
        f0 = d(ult) - datetime.timedelta(days=VENTANA_DIARIA)
        xs = [(f0 + datetime.timedelta(days=i)).isoformat()
              for i in range((d(ult) - f0).days + 1)]
        datos["diario"] = {
            "x": xs,
            "volumen": [r(res[x][0]) if x in res else None for x in xs],
            "porcentaje": [r(res[x][2]) if x in res else None for x in xs],
            "cota": [r(cota.get(x)) for x in xs],
        }

        # Mensual desde 1970: % medio del mes y reserva del ultimo dia.
        porMes = {}
        for f in sorted(res):
            porMes.setdefault(f[:7], []).append(res[f])
        meses = sorted(porMes)
        datos["mensual"] = {
            "x": meses,
            "porcentaje": [r(statistics.mean(t[2] for t in porMes[m]), 1) for m in meses],
            "volumen_fin": [r(porMes[m][-1][0]) for m in meses],
        }
        vf = datos["mensual"]["volumen_fin"]
        datos["mensual"]["variacion"] = [None] + [
            r(vf[i] - vf[i - 1]) if vf[i] is not None and vf[i - 1] is not None else None
            for i in range(1, len(vf))]

        # Curva del ano hidrologico frente a la estadistica historica.
        datos["curva"] = curva_hidro(res, ult)

        # Evolucion anual: % a 1 de octubre (inicio de ano hidrologico).
        anios, pct_ini, pct_min = [], [], []
        for a in range(anio_hidro(d(min(res))), anio_hidro(d(ult)) + 1):
            f = f"{a}-10-01"
            dias = [res[k][2] for k in res if anio_hidro(d(k)) == a]
            if f in res:
                anios.append(etiqueta_hidro(a))
                pct_ini.append(res[f][2])
                pct_min.append(min(dias) if dias else None)
        datos["anual"] = {"x": anios, "pct_inicio": pct_ini, "pct_minimo": pct_min}

    if cota:
        cs = sorted(cota)
        datos["cota_hist"] = {
            "desde": cs[0], "max": max(cota.values()), "min": min(cota.values()),
            "fecha_max": max(cs, key=lambda k: cota[k]),
            "fecha_min": min(cs, key=lambda k: cota[k]),
        }

    datos["lluvia"] = lluvias(cache.get("lluvia", {}))
    return datos


def curva_hidro(res, ult):
    actual = anio_hidro(d(ult))
    porAnio = {}
    for f, (_, _, p) in res.items():
        fd = d(f)
        pos = POS_HIDRO.get((fd.month, fd.day))
        if pos is None:
            continue
        porAnio.setdefault(anio_hidro(fd), [None] * len(DIAS_HIDRO))[pos] = p
    # Estadistica con anos completos de los ultimos 30 anos hidrologicos cerrados.
    refs = [a for a in range(actual - 30, actual)
            if a in porAnio and sum(v is not None for v in porAnio[a]) >= 0.95 * len(DIAS_HIDRO)]
    mn, med, mx = [], [], []
    for i in range(len(DIAS_HIDRO)):
        vals = [porAnio[a][i] for a in refs if porAnio[a][i] is not None]
        mn.append(r(min(vals), 1) if vals else None)
        mx.append(r(max(vals), 1) if vals else None)
        med.append(r(statistics.median(vals), 1) if vals else None)
    return {
        "x": [f"{dd}-{m}" for m, dd in DIAS_HIDRO],
        "anio_actual": etiqueta_hidro(actual),
        "anio_anterior": etiqueta_hidro(actual - 1),
        "actual": porAnio.get(actual, [None] * len(DIAS_HIDRO)),
        "anterior": porAnio.get(actual - 1, [None] * len(DIAS_HIDRO)),
        "minimo": mn, "mediana": med, "maximo": mx,
        "referencia": f"{etiqueta_hidro(refs[0])} a {etiqueta_hidro(refs[-1])}" if refs else "",
        "n_anios": len(refs),
    }


def lluvias(cache_ll):
    out = {"estaciones": [{"id": p["id"], "nombre": p["nombre"]} for p in PLUVIOMETROS],
           "ref": PLUVIO_REF}
    actual = anio_hidro(HOY)

    # Diaria: ultimos 365 dias.
    xs = [(HOY - datetime.timedelta(days=i)).isoformat() for i in range(364, -1, -1)]
    out["diario"] = {"x": xs}
    for p in PLUVIOMETROS:
        s = cache_ll.get(p["id"], {})
        out["diario"][p["id"]] = [s.get(x) for x in xs]

    # Mensual con control de completitud: un mes con huecos no es un mes seco.
    meses = []
    m = datetime.date(HISTORICO_DESDE.year, HISTORICO_DESDE.month, 1)
    while m <= HOY:
        meses.append(m.strftime("%Y-%m"))
        m = datetime.date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    out["mensual"] = {"x": meses}
    for p in PLUVIOMETROS:
        s = cache_ll.get(p["id"], {})
        porMes = {}
        for f, v in s.items():
            porMes.setdefault(f[:7], []).append(v)
        vals = []
        for mm in meses:
            y, mo = int(mm[:4]), int(mm[5:])
            nd = (datetime.date(y + (mo == 12), mo % 12 + 1, 1) - datetime.date(y, mo, 1)).days
            if mm == HOY.strftime("%Y-%m"):
                nd = HOY.day
            got = porMes.get(mm, [])
            vals.append(r(sum(got), 1) if len(got) >= COMPLETITUD * nd else None)
        out["mensual"][p["id"]] = vals

    # Totales por ano hidrologico cerrado (el en curso va aparte).
    anios = list(range(anio_hidro(HISTORICO_DESDE) + 1, actual))
    out["hidro"] = {"x": [etiqueta_hidro(a) for a in anios]}
    for p in PLUVIOMETROS:
        s = cache_ll.get(p["id"], {})
        tot = []
        for a in anios:
            got = [v for f, v in s.items() if anio_hidro(d(f)) == a]
            nd = (datetime.date(a + 1, 10, 1) - datetime.date(a, 10, 1)).days
            tot.append(r(sum(got), 1) if len(got) >= COMPLETITUD * nd else None)
        out["hidro"][p["id"]] = tot
        validos = [t for t in tot if t is not None]
        out["hidro"][p["id"] + "_media"] = r(statistics.mean(validos), 1) if validos else None

    # Acumulado del ano en curso y del anterior frente a la media diaria (presa).
    s = cache_ll.get(PLUVIO_REF, {})
    porAnio = {}
    for f, v in s.items():
        fd = d(f)
        pos = POS_HIDRO.get((fd.month, fd.day))
        if pos is not None:
            porAnio.setdefault(anio_hidro(fd), {})[pos] = v

    def acumular(a, hasta=None):
        tot, serie = 0.0, []
        dias = porAnio.get(a, {})
        for i in range(len(DIAS_HIDRO)):
            if hasta is not None and i > hasta:
                serie.append(None)
                continue
            tot += dias.get(i, 0.0)
            serie.append(round(tot, 1))
        return serie

    hoy_pos = POS_HIDRO.get((HOY.month, HOY.day), POS_HIDRO[(2, 28)])
    completos = [a for a, t in zip(anios, out["hidro"][PLUVIO_REF]) if t is not None]
    curvas = [acumular(a) for a in completos]
    media = [r(statistics.mean(c[i] for c in curvas), 1) if curvas else None
             for i in range(len(DIAS_HIDRO))]
    out["acumulado"] = {
        "x": [f"{dd}-{m}" for m, dd in DIAS_HIDRO],
        "actual": acumular(actual, hoy_pos), "anterior": acumular(actual - 1),
        "media": media, "anio_actual": etiqueta_hidro(actual),
        "anio_anterior": etiqueta_hidro(actual - 1),
        "referencia": f"{etiqueta_hidro(completos[0])} a {etiqueta_hidro(completos[-1])}" if completos else "",
        "hoy_pos": hoy_pos,
    }
    return out


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
