# -*- coding: utf-8 -*-
"""Ajusta la ecuacion lluvia-volumen del embalse y escribe pipeline/modelo.json.

    pip install numpy pandas scipy
    python pipeline/ajustar_modelo.py

No lo ejecuta la Action: los parametros cambian poco y conviene revisarlos a
mano (una vez al ano, tras el invierno). Lee data/data.js, que ya contiene la
reserva diaria (REDIAM) y la lluvia diaria de la presa (Red Hidrosur).

EL MODELO (por episodios de lluvia)
-----------------------------------
Un episodio es una semana que empieza cuando caen >= 30 mm en 3 dias. Para
cada uno se mide la subida del embalse en los ~10 dias siguientes y se ajusta
el metodo del numero de curva del SCS, el estandar para pasar de lluvia a
escorrentia, con la humedad previa del suelo:

    S  = S0 * exp(-P90 / beta)                  retencion del suelo (mm)
    Q  = (P - l*S)^2 / (P + (1-l)*S)  si P > l*S, si no 0     escorrentia (mm)
    dV = min(Vtecho - V0, a * Q)                subida del embalse (hm3)

    P     lluvia del episodio en la presa (mm, 7 dias)
    P90   lluvia de los 90 dias anteriores (mm): cuanto mas mojado, menos retiene
    V0    volumen al empezar (hm3)
    a     hm3 por mm de escorrentia: equivale al area que aporta (a*1000 = km2)
    Vtecho  volumen a partir del cual la presa desembalsa en lugar de llenarse

Se ajusta con los episodios hasta 2017 y se valida con los de 2018 en adelante
(que el modelo no ha visto); los parametros publicados se reajustan con todos.
"""

import datetime
import json
import os
import re

import numpy as np
import pandas as pd
from scipy.optimize import least_squares

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATOS = os.path.join(RAIZ, "data", "data.js")
SALIDA = os.path.join(RAIZ, "pipeline", "modelo.json")

UMBRAL_3D = 30          # mm en 3 dias que abren un episodio
SEPARACION = 10         # dias minimos entre episodios
LAMBDA = 0.05           # abstraccion inicial Ia = LAMBDA * S
CORTE = "2018-01-01"    # ajuste antes, validacion despues


def cargar():
    txt = open(DATOS, encoding="utf-8").read()
    D = json.loads(re.search(r"=\s*(\{.*\});", txt, re.S).group(1))
    ED, LD = D["embalse_diario"], D["lluvia_diaria"]
    iv = pd.date_range(ED["inicio"], periods=len(ED["volumen"]))
    df = pd.DataFrame({"V": ED["volumen"]}, index=iv)
    cap = pd.Series(np.nan, index=iv)
    for tr in ED["capacidad"]:
        cap[tr["desde"]:] = tr["capacidad"]
    df["cap"] = cap
    ref = LD["ref"]
    il = pd.date_range(LD["inicio"], periods=len(LD["series"][ref]))
    df = df.join(pd.Series(LD["series"][ref], index=il, name="P"))
    return df[LD["inicio"]:], ref


def episodios(df):
    p = df.P.fillna(0)
    p3 = p.rolling(3).sum()
    filas, ultimo = [], None
    for f, v in p3.items():
        if v >= UMBRAL_3D and (ultimo is None or (f - ultimo).days >= SEPARACION):
            ini = f - pd.Timedelta(days=2)
            V0 = df.V.get(ini - pd.Timedelta(days=1))
            V1 = df.V[ini + pd.Timedelta(days=9):ini + pd.Timedelta(days=11)].max()
            if pd.notna(V0) and pd.notna(V1):
                filas.append({
                    "f": ini, "V0": V0, "dV": V1 - V0, "cap": df.cap.get(ini),
                    "P": p[ini:ini + pd.Timedelta(days=6)].sum(),
                    "P90": p[ini - pd.Timedelta(days=90):ini - pd.Timedelta(days=1)].sum(),
                })
            ultimo = f
    return pd.DataFrame(filas).set_index("f")


def predecir(th, E):
    a, s0, beta, vtecho = th
    S = s0 * np.exp(-E.P90 / beta)
    Q = np.where(E.P > LAMBDA * S, (E.P - LAMBDA * S) ** 2 / (E.P + (1 - LAMBDA) * S), 0.0)
    techo = np.minimum(E.cap, vtecho)
    return np.maximum(np.minimum(techo - E.V0, a * Q), np.minimum(0, techo - E.V0))


def r2(y, yh):
    return float(1 - ((y - yh) ** 2).sum() / ((y - y.mean()) ** 2).sum())


def ajustar(E, x0=(0.15, 300, 90, 56)):
    sol = least_squares(lambda th: predecir(th, E) - E.dV, x0=list(x0),
                        bounds=([0.001, 1, 1, 40], [5, 3000, 5000, 62]))
    return sol.x


def main():
    df, ref = cargar()
    E = episodios(df)
    tr, te = E[:CORTE], E[CORTE:]
    th_tr = ajustar(tr)
    val = {"r2_validacion": round(r2(te.dV, predecir(th_tr, te)), 3),
           "error_medio_validacion_hm3": round(float(np.abs(te.dV - predecir(th_tr, te)).mean()), 2),
           "episodios_validacion": int(len(te))}
    th = ajustar(E, th_tr)
    res = E.dV - predecir(th, E)
    a, s0, beta, vtecho = (float(x) for x in th)
    modelo = {
        "tipo": "SCS numero de curva por episodios de 7 dias",
        "ajustado": datetime.date.today().isoformat(),
        "pluviometro": ref,
        "episodios": int(len(E)),
        "desde": E.index.min().strftime("%Y-%m-%d"),
        "hasta": E.index.max().strftime("%Y-%m-%d"),
        "umbral_3d_mm": UMBRAL_3D,
        "parametros": {"a": round(a, 4), "S0": round(s0, 1), "beta": round(beta, 1),
                       "lambda": LAMBDA, "Vtecho": round(vtecho, 2)},
        "r2_total": round(r2(E.dV, predecir(th, E)), 3),
        **val,
        # Margen de error empirico (residuos observados - previstos), en hm3.
        "error_p10": round(float(np.percentile(res, 10)), 2),
        "error_p90": round(float(np.percentile(res, 90)), 2),
    }
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(modelo, f, ensure_ascii=False, indent=2)
    print(json.dumps(modelo, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
