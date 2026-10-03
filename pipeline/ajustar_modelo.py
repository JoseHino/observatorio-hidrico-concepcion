# -*- coding: utf-8 -*-
"""Ajusta la ecuacion lluvia-volumen del embalse y escribe pipeline/modelo.json.

    pip install numpy pandas scipy
    python pipeline/ajustar_modelo.py

No lo ejecuta la Action: los parametros cambian poco y conviene revisarlos a
mano (una vez al ano, tras el invierno). Lee los datos HORARIOS publicados en
data/horario/AAAA.js (volumen del embalse y lluvia en la presa, Red Hidrosur).

EL MODELO (por temporales, con datos horarios)
----------------------------------------------
Un temporal es una racha de horas con lluvia en la que no pasan 24 h seguidas
sin llover, con 30 mm o mas en total. Para cada uno se mide, hora a hora, la
subida del embalse desde que empieza a llover hasta su pico (que llega, de
mediana, unos 5 dias despues) y se ajusta el metodo del numero de curva del
SCS, el estandar para pasar de lluvia a escorrentia, con la humedad previa:

    S  = S0 * exp(-P90 / beta)                  retencion del suelo (mm)
    Q  = (P - l*S)^2 / (P + (1-l)*S)  si P > l*S, si no 0     escorrentia (mm)
    dV = min(Vtecho - V0, a * Q)                subida del embalse (hm3)

    P     lluvia total del temporal en la presa (mm)
    P90   lluvia de los 90 dias anteriores (mm): cuanto mas mojado, menos retiene
    V0    volumen al empezar a llover (hm3)
    a     hm3 por mm de escorrentia: equivale al area que aporta (a*1000 = km2)
    Vtecho  volumen a partir del cual la presa desembalsa en lugar de llenarse

Se valida dejando fuera cada ano por turno (se ajusta con el resto y se predice
ese ano): es la medida honesta de como acertaria con un ano que no ha visto.
Con datos horarios explica el 63 % de la subida frente al 57 % con semanas
fijas de datos diarios, y el error medio baja de 2,7 a 2,1 hm3. Se probo
anadir la intensidad (lluvia maxima en 1, 3, 6 y 24 h) y no mejora.
"""

import datetime
import glob
import json
import os
import re

import numpy as np
import pandas as pd
from scipy.optimize import least_squares

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HORARIO = os.path.join(RAIZ, "data", "horario")
DATOS = os.path.join(RAIZ, "data", "data.js")
SALIDA = os.path.join(RAIZ, "pipeline", "modelo.json")

PLUVIO = "016P01"       # pluviometro de la presa
UMBRAL_MM = 30          # lluvia minima de un temporal
HUECO_H = 24            # horas secas que separan dos temporales
COLA_H = 96             # horas tras la lluvia en las que se busca el pico
LAMBDA = 0.05           # abstraccion inicial Ia = LAMBDA * S


def cargar():
    vol, ll = [], []
    for f in sorted(glob.glob(os.path.join(HORARIO, "*.js"))):
        txt = open(f, encoding="utf-8").read()
        H = json.loads(re.search(r"=\s*(\{.*\});?\s*$", txt, re.S).group(1))
        idx = pd.date_range(pd.Timestamp(H["inicio"].replace("T", " ") + ":00"),
                            periods=len(H["vol"]), freq="h")
        lluvia = H["lluvia"] if isinstance(H["lluvia"], list) else H["lluvia"].get(PLUVIO, [])
        vol.append(pd.Series(H["vol"], index=idx, dtype=float))
        ll.append(pd.Series(lluvia + [None] * (len(idx) - len(lluvia)), index=idx, dtype=float))
    txt = open(DATOS, encoding="utf-8").read()
    cap = json.loads(re.search(r"=\s*(\{.*\});", txt, re.S).group(1))["embalse"]["capacidad"]
    return pd.concat(vol).interpolate(limit=6), pd.concat(ll).fillna(0), cap


def temporales(V, P, cap):
    rachas, ini, fin, tot = [], None, None, 0.0
    for t, v in P[P > 0].items():
        if ini is not None and (t - fin).total_seconds() / 3600 < HUECO_H:
            fin, tot = t, tot + v
            continue
        if ini is not None:
            rachas.append((ini, fin, tot))
        ini, fin, tot = t, t, v
    if ini is not None:
        rachas.append((ini, fin, tot))
    filas = []
    for ini, fin, tot in rachas:
        if tot < UMBRAL_MM:
            continue
        v0 = V[ini - pd.Timedelta(hours=6):ini].dropna()
        ventana = V[ini:fin + pd.Timedelta(hours=COLA_H)].dropna()
        if v0.empty or len(ventana) < 24:
            continue
        filas.append({
            "ini": ini, "P": tot, "V0": v0.iloc[-1], "dV": ventana.max() - v0.iloc[-1], "cap": cap,
            "retardo_h": (ventana.idxmax() - ini).total_seconds() / 3600,
            "P90": P[ini - pd.Timedelta(days=90):ini - pd.Timedelta(hours=1)].sum(),
        })
    return pd.DataFrame(filas).set_index("ini")


def predecir(th, E):
    a, s0, beta, vtecho = th
    S = s0 * np.exp(-E.P90 / beta)
    Q = np.where(E.P > LAMBDA * S, (E.P - LAMBDA * S) ** 2 / (E.P + (1 - LAMBDA) * S), 0.0)
    techo = np.minimum(E.cap, vtecho)
    return np.maximum(np.minimum(techo - E.V0, a * Q), np.minimum(0, techo - E.V0))


def ajustar(E):
    return least_squares(lambda th: predecir(th, E) - E.dV, x0=[0.15, 300, 90, 56],
                         bounds=([0.001, 1, 1, 40], [5, 3000, 5000, 62])).x


def main():
    V, P, cap = cargar()
    E = temporales(V, P, cap)
    # Validacion dejando fuera cada ano.
    cvp = pd.Series(np.nan, index=E.index)
    for a in sorted(set(E.index.year)):
        fuera = E.index.year == a
        cvp[fuera] = predecir(ajustar(E[~fuera]), E[fuera])
    res = E.dV - cvp
    r2_cv = 1 - (res ** 2).sum() / ((E.dV - E.dV.mean()) ** 2).sum()

    a, s0, beta, vtecho = (float(x) for x in ajustar(E))
    modelo = {
        "tipo": "SCS numero de curva por temporales (datos horarios)",
        "ajustado": datetime.date.today().isoformat(),
        "pluviometro": PLUVIO,
        "episodios": int(len(E)),
        "desde": E.index.min().strftime("%Y-%m-%d"),
        "hasta": E.index.max().strftime("%Y-%m-%d"),
        "umbral_mm": UMBRAL_MM,
        "retardo_mediano_h": round(float(E.retardo_h.median())),
        "parametros": {"a": round(a, 4), "S0": round(s0, 1), "beta": round(beta, 1),
                       "lambda": LAMBDA, "Vtecho": round(vtecho, 2)},
        "r2_validacion": round(float(r2_cv), 3),
        "error_medio_validacion_hm3": round(float(res.abs().mean()), 2),
        "validacion": "dejando fuera cada ano",
        # Margen de error empirico de la validacion (observado - previsto), en hm3.
        "error_p10": round(float(np.percentile(res, 10)), 2),
        "error_p90": round(float(np.percentile(res, 90)), 2),
    }
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(modelo, f, ensure_ascii=False, indent=2)
    print(json.dumps(modelo, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
