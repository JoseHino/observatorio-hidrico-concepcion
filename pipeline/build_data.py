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
SALIDA_HORARIO = os.path.join(RAIZ, "data", "horario")              # un .js por ano
MODELO = os.path.join(RAIZ, "pipeline", "modelo.json")              # ecuacion lluvia-volumen

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


def leer_horario(anio):
    """Los ficheros publicados data/horario/AAAA.js hacen de cache: se leen,
    se completan con las horas nuevas y se reescriben.

    En memoria: {"vol": {"AAAA-MM-DDTHH": hm3}, "<pluviometro>": {hora: mm}, ...}"""
    ruta = os.path.join(SALIDA_HORARIO, f"{anio}.js")
    if not os.path.exists(ruta):
        return {}
    try:
        txt = open(ruta, encoding="utf-8").read()
        H = json.loads(re.search(r"=\s*(\{.*\});?\s*$", txt, re.S).group(1))
    except Exception:                                             # noqa: BLE001
        return {}
    t0 = datetime.datetime.strptime(H["inicio"], "%Y-%m-%dT%H")
    series = {"vol": H.get("vol", [])}
    ll = H.get("lluvia", {})
    if isinstance(ll, list):                 # formato antiguo: solo la presa
        ll = {PLUVIO_REF: ll}
    series.update(ll)
    out = {}
    for clave, vals in series.items():
        out[clave] = {(t0 + datetime.timedelta(hours=i)).strftime("%Y-%m-%dT%H"): v
                      for i, v in enumerate(vals) if v is not None}
    return out


def guardar_horario(anio, h):
    """data/horario/AAAA.js: volumen y lluvia de cada pluviometro hora a hora,
    como listas desde el 1 de enero a las 00 (null = hora sin dato). La web
    solo descarga los anos que necesita para el periodo elegido."""
    os.makedirs(SALIDA_HORARIO, exist_ok=True)
    t0 = datetime.datetime(int(anio), 1, 1)
    claves = set()
    for s in h.values():
        claves |= s.keys()
    if not claves:
        return
    ultima = datetime.datetime.strptime(max(claves), "%Y-%m-%dT%H")
    n = int((ultima - t0).total_seconds() // 3600) + 1
    ks = [(t0 + datetime.timedelta(hours=i)).strftime("%Y-%m-%dT%H") for i in range(n)]
    datos = {"inicio": f"{anio}-01-01T00",
             "vol": [r(h.get("vol", {}).get(k)) for k in ks],
             "lluvia": {p["id"]: [r(h.get(p["id"], {}).get(k), 1) for k in ks]
                        for p in PLUVIOMETROS if h.get(p["id"])}}
    with open(os.path.join(SALIDA_HORARIO, f"{anio}.js"), "w", encoding="utf-8") as f:
        f.write("/* Generado por pipeline/build_data.py - no editar a mano. */\n")
        f.write(f"(window.HORARIO = window.HORARIO || {{}})['{anio}'] = ")
        json.dump(datos, f, separators=(",", ":"))
        f.write(";\n")


def ultima_hora(clave):
    """Ultima fecha con dato horario de `clave` en la cache (o None)."""
    if not os.path.isdir(SALIDA_HORARIO):
        return None
    for nombre in sorted(os.listdir(SALIDA_HORARIO), reverse=True):
        s = leer_horario(nombre[:4]).get(clave, {})
        if s:
            return d(max(s)[:10])
    return None


def volcar_horario(nuevo, clave_fn):
    """Reparte {'AAAA-MM-DDTHH': valores} en la cache anual. Devuelve los anos tocados."""
    porAnio = {}
    for k, v in nuevo.items():
        porAnio.setdefault(k[:4], {})[k] = v
    for anio, filas in porAnio.items():
        h = leer_horario(anio)
        for k, v in filas.items():
            for clave, valor in clave_fn(v):
                h.setdefault(clave, {})[k] = valor
        guardar_horario(anio, h)
    return set(porAnio)


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

    # --- Hidrosur: cota y volumen horarios ----------------------------------
    # La tabla horaria del sensor de cota trae nivel y volumen. Se guarda todo
    # hora a hora y de ahi sale tambien la cota diaria (lectura de las 8:00).
    paso("Red Hidrosur - cota y volumen horarios")
    anios_tocados = set()
    try:
        u = None if todo else ultima_hora("vol")
        ini = HISTORICO_DESDE if u is None else u - datetime.timedelta(days=SOLAPE_DIAS)
        nuevo = hidrosur.horaria(HIDROSUR_ESTACION, HIDROSUR_COTA, ini, HOY)
        if not nuevo and ini < HOY - datetime.timedelta(days=60):
            raise RuntimeError("sin lecturas de cota")
        anios_tocados |= volcar_horario(nuevo, lambda v: [("vol", v[1])] if len(v) > 1 else [])
        porDia = {}
        for k, v in nuevo.items():
            if v[0] > 0:
                porDia.setdefault(k[:10], {})[int(k[11:13])] = v[0]
        for f, horas in porDia.items():
            cache["cota"][f] = horas.get(8, horas[max(horas)])
        ok(f"{len(nuevo)} horas desde {ini}; cota diaria en cache {len(cache['cota'])} dias")
    except Exception as e:                                        # noqa: BLE001
        fallos.append(f"Hidrosur cota: {e}")
        aviso(str(e))

    paso("Red Hidrosur - lluvia horaria de cada pluviometro")
    for p in PLUVIOMETROS:
        try:
            u = None if todo else ultima_hora(p["id"])
            ini = HISTORICO_DESDE if u is None else u - datetime.timedelta(days=SOLAPE_DIAS)
            nuevo = hidrosur.horaria(p["est"], p["id"], ini, HOY)
            anios_tocados |= volcar_horario(
                nuevo, lambda v, c=p["id"]: [(c, v[0])] if 0 <= v[0] < 300 else [])
            ok(f"{p['nombre']}: {len(nuevo)} horas desde {ini}")
        except Exception as e:                                    # noqa: BLE001
            fallos.append(f"Hidrosur lluvia horaria {p['id']}: {e}")
            aviso(f"{p['nombre']}: {e}")

    if anios_tocados:
        ok(f"horario: {len(anios_tocados)} ano(s) actualizados en data/horario/")

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

    if os.path.isdir(SALIDA_HORARIO):
        datos["horario"] = {"anios": sorted(n[:4] for n in os.listdir(SALIDA_HORARIO) if n.endswith(".js")),
                            "sensor_lluvia": PLUVIO_REF}
    try:
        with open(MODELO, encoding="utf-8") as f:
            datos["modelo"] = json.load(f)
    except Exception:                                             # noqa: BLE001
        pass

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
