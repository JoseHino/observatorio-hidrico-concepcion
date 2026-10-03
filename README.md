# Observatorio Hídrico · Embalse de La Concepción

Reserva, cota y precipitaciones del embalse de La Concepción (río Verde, Istán, Málaga).
Montado sobre `observatorio-kit`; `assets/` es el kit y no se toca.

## Fuentes

| Dato | Fuente | Acceso |
|---|---|---|
| Reserva diaria (hm³, %, capacidad) desde 1970 | REDIAM · Visor de embalses | `GET portalrediam.cica.es/embalses/api/csv/embalse/S16/<desde>/<hasta>` |
| Cota (m s. n. m.), lectura de las 8:00, desde 2000 | Red Hidrosur · SAIH, sensor `016E01` | formulario "Datos a la carta" (POST de consulta), agrupación horaria |
| Volumen y lluvia de cada hora desde 2000 (comparativa) | Red Hidrosur · `016E01` (nivel y volumen) y `016P01` | ídem, agrupación horaria → `data/horario/AAAA.js`, que hace también de caché |
| Lluvia diaria desde 2000 | Red Hidrosur · `016P01` presa, `017P01` Ojén, `024P01` EDAR Marbella, `116P01` Guadaiza (desde 2024) | ídem, agrupación diaria |

Trampas conocidas:
- Hidrosur no devuelve nada si la consulta pasa de ~1 año: se pide en tramos de 180 días.
- La cota solo existe en agrupación horaria o cincominutal.
- La capacidad oficial cambió (61,85 → 57,5 hm³): las series largas se comparan en %.
- Un día sin dato no es un día seco: meses y años con < 90 % de días quedan en blanco.

## Actualización

`python pipeline/build_data.py` (incremental, ~10 s) · `--todo` rehace la caché de Hidrosur (~4 min).
La Action `actualizar-datos.yml` corre cada día a las 08:15 UTC y publica `data/data.js` y `pipeline/cache/`.

## Ecuación lluvia → volumen

`pipeline/ajustar_modelo.py` (necesita numpy, pandas y scipy; no lo ejecuta la Action) ajusta el
número de curva del SCS por episodios de lluvia (≥ 30 mm en 3 días) y escribe `pipeline/modelo.json`,
que el colector mete en `data.js` y la web usa en la previsión y en la calculadora de riesgo.

    S = S0·e^(−P90/β)    Q = (P − λS)² / (P + (1−λ)S)    ΔV = min(Vtecho − V0, a·Q)

Ajuste de 2026-10-03: a = 0,188 hm³/mm (≈ 188 km² aportando), S0 = 433 mm, β = 90,7 mm, λ = 0,05,
Vtecho = 56,4 hm³. Validado con 2018–2026 (sin usar en el ajuste): R² = 0,56, error medio ±3,2 hm³ por episodio.
Conviene reajustarlo una vez al año, después del invierno.
