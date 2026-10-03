# -*- coding: utf-8 -*-
"""Red Hidrosur - SAIH de las Cuencas Mediterraneas Andaluzas.

"Datos a la carta" de https://www.redhidrosurmedioambiente.es/saih/datos/a/la/carta

EXCEPCION DOCUMENTADA A LA REGLA "SOLO GET": la consulta publica de la Red
Hidrosur es un formulario que solo responde a POST. Es una consulta de lectura
(el mismo formulario que usa cualquier visitante de la web), sin credenciales y
sin efecto alguno sobre la plataforma. No se envia nada mas que los filtros.

Limites comprobados (oct-2026):
  - Una consulta no puede pasar de ~1 ano: con mas, la web responde
    "No se ha encontrado ningun resultado". Se pide por tramos de 6 meses.
  - La COTA (sensor xxxE01) solo existe en agrupacion horaria (60) o
    cincominutal; la diaria solo ofrece pluviometria.
  - Fechas dd/mm/yy en la tabla. Historico disponible al menos desde 2000.
"""

import datetime
import re
import time
import urllib.parse
import urllib.request

from .comun import UA

URL = "https://www.redhidrosurmedioambiente.es/saih/datos/a/la/carta"
HORARIA, DIARIA = 60, 1
TRAMO_DIAS = 180


def _post(datos, reintentos=3):
    cuerpo = urllib.parse.urlencode(datos).encode()
    ultimo = None
    for i in range(reintentos):
        try:
            req = urllib.request.Request(URL, data=cuerpo, headers=UA)
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:                                   # noqa: BLE001
            ultimo = e
            time.sleep(3 * (i + 1))
    raise ultimo


def _tabla(html):
    s = html[html.find("</form>"):]
    for fila in re.findall(r"<tr[^>]*>(.*?)</tr>", s, re.S):
        celdas = [re.sub(r"<[^>]+>", "", c).strip()
                  for c in re.findall(r"<td[^>]*>(.*?)</td>", fila, re.S)]
        if celdas:
            yield celdas


def _num(s):
    try:
        return float(s.replace(".", "").replace(",", "."))
    except (ValueError, AttributeError):
        return None


def _consulta(estacion, sensor, agrupacion, d0, d1):
    return _post({
        "datepickerini": d0.strftime("%d/%m/%Y 00:00"),
        "datepickerfin": d1.strftime("%d/%m/%Y 23:59"),
        "agrupacion": agrupacion, "provincia": "", "subsistema": "",
        "tipoestacion": "", "estacion": estacion, "tipo": "", "sensor": sensor,
    })


def _tramos(desde, hasta):
    d = desde
    while d <= hasta:
        f = min(d + datetime.timedelta(days=TRAMO_DIAS - 1), hasta)
        yield d, f
        d = f + datetime.timedelta(days=1)


def lluvia_diaria(estacion, sensor, desde, hasta):
    """{fecha_iso: mm}. Un dia ausente en la tabla es 'sin dato', no 0 mm."""
    out = {}
    for d0, d1 in _tramos(desde, hasta):
        for c in _tabla(_consulta(estacion, sensor, DIARIA, d0, d1)):
            # estacion | nombre | sensor | dd/mm/yy | nombre sensor | mm
            if len(c) < 6 or c[2] != sensor:
                continue
            try:
                f = datetime.datetime.strptime(c[3], "%d/%m/%y").date()
            except ValueError:
                continue
            v = _num(c[5])
            if v is not None and 0 <= v < 600:      # descarta lecturas imposibles
                out[f.isoformat()] = round(v, 1)
        time.sleep(0.5)
    return out


def cota_diaria(estacion, sensor, desde, hasta, hora=8):
    """{fecha_iso: cota_msnm} tomando la lectura de las `hora`:00, que es la
    misma hora de referencia de la reserva diaria de REDIAM. Si falta esa
    lectura se usa la ultima del dia."""
    porDia = {}
    for d0, d1 in _tramos(desde, hasta):
        for c in _tabla(_consulta(estacion, sensor, HORARIA, d0, d1)):
            # estacion | nombre | sensor | dd/mm/yy HH:MM | nivel | volumen
            if len(c) < 5 or c[2] != sensor:
                continue
            try:
                t = datetime.datetime.strptime(c[3], "%d/%m/%y %H:%M")
            except ValueError:
                continue
            v = _num(c[4])
            if v is None or v <= 0:
                continue
            dia = porDia.setdefault(t.date().isoformat(), {})
            dia[t.hour] = v
        time.sleep(0.5)
    out = {}
    for f, horas in porDia.items():
        out[f] = horas.get(hora, horas[max(horas)])
    return out
