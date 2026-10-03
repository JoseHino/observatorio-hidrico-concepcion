# Observatorio Hídrico · Embalse de La Concepción

Reserva, cota y precipitaciones del embalse de La Concepción (río Verde, Istán, Málaga).
Montado sobre `observatorio-kit`; `assets/` es el kit y no se toca.

## Fuentes

| Dato | Fuente | Acceso |
|---|---|---|
| Reserva diaria (hm³, %, capacidad) desde 1970 | REDIAM · Visor de embalses | `GET portalrediam.cica.es/embalses/api/csv/embalse/S16/<desde>/<hasta>` |
| Cota (m s. n. m.), lectura de las 8:00, desde 2000 | Red Hidrosur · SAIH, sensor `016E01` | formulario "Datos a la carta" (POST de consulta), agrupación horaria |
| Lluvia diaria desde 2000 | Red Hidrosur · `016P01` presa, `017P01` Ojén, `024P01` EDAR Marbella, `116P01` Guadaiza (desde 2024) | ídem, agrupación diaria |

Trampas conocidas:
- Hidrosur no devuelve nada si la consulta pasa de ~1 año: se pide en tramos de 180 días.
- La cota solo existe en agrupación horaria o cincominutal.
- La capacidad oficial cambió (61,85 → 57,5 hm³): las series largas se comparan en %.
- Un día sin dato no es un día seco: meses y años con < 90 % de días quedan en blanco.

## Actualización

`python pipeline/build_data.py` (incremental, ~10 s) · `--todo` rehace la caché de Hidrosur (~4 min).
La Action `actualizar-datos.yml` corre cada día a las 08:15 UTC y publica `data/data.js` y `pipeline/cache/`.
