/* ============================================================================
   app.js — Observatorio Hídrico del embalse de La Concepción (Istán, Málaga).
   Declara secciones, KPI y tarjetas; el kit (assets/) dibuja.
   ========================================================================== */
(function () {
  'use strict';

  var D = window.DATOS || {};
  var F = Obs.fmt;
  var E = D.embalse || {};
  var DI = D.diario || {};
  var LL = D.lluvia || {};

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /* '2026-10-03' -> '3 oct 26'  ·  '3-10' (día del año hidrológico) -> '3 oct' */
  var fDia = function (s) {
    if (!s) return '';
    var p = s.split('-');
    return (+p[2]) + ' ' + MESES[+p[1] - 1] + ' ' + p[0].slice(2);
  };
  var fDiaLargo = function (s) {
    if (!s) return '—';
    var p = s.split('-');
    return (+p[2]) + ' de ' + ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
      'septiembre', 'octubre', 'noviembre', 'diciembre'][+p[1] - 1] + ' de ' + p[0];
  };
  var fDiaHidro = function (s) { var p = s.split('-'); return p[0] + ' ' + MESES[+p[1] - 1]; };

  var hm3 = function (v) { return v == null ? '—' : F.num(v, 2) + ' hm³'; };
  var msnm = function (v) { return v == null ? '—' : F.num(v, 2) + ' m'; };
  var mm = function (v) { return v == null ? '—' : F.num(v, 1) + ' mm'; };
  var metros = function (v) { return v == null ? '—' : (v > 0 ? '+' : '') + F.num(v, 2) + ' m'; };

  /* Valor de una serie diaria en una fecha concreta (o el último anterior con dato). */
  var enFecha = function (serie, iso) {
    var i = (DI.x || []).indexOf(iso);
    for (; i >= 0; i--) if (serie[i] != null) return serie[i];
    return null;
  };
  var restarDias = function (iso, n) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  var ultimoValor = function (a) {
    for (var i = (a || []).length - 1; i >= 0; i--) if (a[i] != null) return a[i];
    return null;
  };
  var pctVar = function (a, b) { return (a == null || b == null || !b) ? null : (a - b) / b * 100; };
  var sumaUltimos = function (a, n) {
    var s = (a || []).slice(-n), con = s.filter(function (v) { return v != null; });
    return con.length < n * 0.9 ? null : con.reduce(function (t, v) { return t + v; }, 0);
  };
  var ultimos = function (a, n) { return (a || []).slice(-n); };
  /* Suelo del eje para barras con negativos: el kit arranca las barras en 0 y,
     sin esto, los meses en que el embalse pierde agua no se verían. */
  var sueloNeg = function (a) {
    var m = Math.min.apply(null, (a || []).filter(function (v) { return v != null; }).concat([0]));
    return m < 0 ? Math.floor(m / 5) * 5 : 0;
  };

  var FUENTE_REDIAM = { txt: 'REDIAM · Visor de embalses de Andalucía', url: 'https://portalrediam.cica.es/embalses/' };
  var FUENTE_COTA = { txt: 'Red Hidrosur · SAIH, sensor 016E01', url: 'https://www.redhidrosurmedioambiente.es/saih/datos/a/la/carta' };
  var FUENTE_PLUVIO = { txt: 'Red Hidrosur · SAIH, pluviómetros', url: 'https://www.redhidrosurmedioambiente.es/saih/datos/a/la/carta' };
  var FUENTE_RESUMEN = { txt: 'Red Hidrosur · resumen de embalses', url: 'https://www.redhidrosurmedioambiente.es/saih/resumen/embalses' };

  var CHIP_DIARIO = { txt: 'Diario', tipo: 'live' };
  var CHIP_MENSUAL = { txt: 'Mensual' };
  var CHIP_ANUAL = { txt: 'Año hidrológico' };

  var ESTS = LL.estaciones || [];
  var REF = LL.ref || '016P01';
  var nombreEst = function (id) {
    var e = ESTS.filter(function (x) { return x.id === id; })[0];
    return e ? e.nombre : id;
  };

  /* Cálculos compartidos por varias secciones. */
  var hoy = E.fecha;
  var vol7 = enFecha(DI.volumen || [], restarDias(hoy, 7));
  var vol365 = enFecha(DI.volumen || [], restarDias(hoy, 365));
  var cotaHoy = ultimoValor(DI.cota);
  var cota7 = enFecha(DI.cota || [], restarDias(hoy, 7));
  var cota365 = enFecha(DI.cota || [], restarDias(hoy, 365));
  var LD = LL.diario || {};
  var lluvia30 = sumaUltimos(LD[REF], 30);
  var AC = LL.acumulado || {};
  var lluviaAnioActual = AC.actual ? ultimoValor(AC.actual) : null;
  var H = LL.hidro || {};
  var lluviaAnioAnt = ultimoValor(H[REF]);
  var mediaAnual = H[REF + '_media'];
  var mediaHastaHoy = AC.media && AC.hoy_pos != null ? AC.media[AC.hoy_pos] : null;

  /* Último día con lluvia apreciable en la presa (>= 1 mm). */
  var ultimoDiaLluvia = (function () {
    var s = LD[REF] || [], x = LD.x || [];
    for (var i = s.length - 1; i >= 0; i--) if (s[i] != null && s[i] >= 1) return { f: x[i], v: s[i] };
    return null;
  })();

  /* ------------------------------------------------------------- Secciones */

  var SECCIONES = [

    /* -------------------------------------------------------- Situación --- */
    {
      id: 'situacion', nombre: 'Situación actual',
      titulo: 'El embalse hoy',
      desc: 'Reserva y cota del embalse de La Concepción (río Verde, Istán), que abastece a la Costa del Sol occidental. La reserva es la que registran a las 8:00 las redes de control de la demarcación; la cota es la lectura de esa misma hora en el sensor de la presa.',
      render: function () {
        var C = D.curva || {};
        return {
          hero: {
            valor: E.porcentaje, label: 'Llenado del embalse a ' + fDiaLargo(E.fecha),
            formato: function (v) { return F.pct(v); },
            extra: [
              { label: 'Volumen embalsado', valor: E.volumen, formato: hm3 },
              { label: 'Cota de la lámina de agua', valor: E.cota, formato: function (v) { return v == null ? '—' : F.num(v, 2) + ' m s. n. m.'; } },
              { label: 'Capacidad útil', valor: E.capacidad, formato: hm3 }
            ]
          },
          kpis: [
            { label: 'Volumen embalsado', valor: E.volumen, unidad: 'hm³', dec: 2, delta: pctVar(E.volumen, vol7), deltaRef: 'en 7 días', serie: ultimos(DI.volumen, 90) },
            { label: 'Volumen hace un año', valor: vol365, unidad: 'hm³', dec: 2, delta: pctVar(E.volumen, vol365), deltaRef: 'interanual', serie: ultimos(DI.volumen, 400) },
            { label: 'Cota (m s. n. m.)', valor: cotaHoy, unidad: 'm', dec: 2, serie: ultimos(DI.cota, 90) },
            { label: 'Variación de cota en 7 días', valor: cotaHoy != null && cota7 != null ? cotaHoy - cota7 : null, formato: metros },
            { label: 'Variación de cota en un año', valor: cotaHoy != null && cota365 != null ? cotaHoy - cota365 : null, formato: metros }
          ],
          cards: [
            {
              titulo: 'Año hidrológico ' + (C.anio_actual || '') + ' frente a la historia',
              sub: 'Llenado diario (%) del 1 de octubre al 30 de septiembre',
              chips: [CHIP_DIARIO], fuente: FUENTE_REDIAM, ancho: 'full', alto: 'tall',
              nota: 'Mínimo, mediana y máximo de cada día en los ' + (C.n_anios || '') + ' años hidrológicos completos de ' + (C.referencia || '') + '. Se compara el porcentaje y no el volumen porque la capacidad del embalse se ha revisado a la baja con los años.',
              spec: {
                type: 'line', xType: 'cat', x: (C.x || []).map(fDiaHidro), yFormat: 'pct', desdeCero: true, yMax: 100, zoom: false,
                series: [
                  { name: 'Máximo histórico', data: C.maximo },
                  { name: 'Mediana', data: C.mediana },
                  { name: 'Mínimo histórico', data: C.minimo },
                  { name: 'Año ' + (C.anio_anterior || ''), data: C.anterior },
                  { name: 'Año ' + (C.anio_actual || ''), data: C.actual }
                ]
              }
            },
            {
              titulo: 'Volumen embalsado', sub: 'Reserva diaria a las 8:00, últimos tres años',
              chips: [CHIP_DIARIO], fuente: FUENTE_REDIAM,
              spec: {
                type: 'line', xType: 'cat', x: (DI.x || []).map(fDia), yFormat: 'dec1', unidad: 'hm³', zoom: true, zoomDesde: 0,
                series: [{ name: 'Volumen', data: DI.volumen }]
              }
            },
            {
              titulo: 'Cota de la lámina de agua', sub: 'Metros sobre el nivel del mar, lectura de las 8:00',
              chips: [CHIP_DIARIO], fuente: FUENTE_COTA,
              nota: (D.cota_hist ? 'Desde ' + fDia(D.cota_hist.desde) + ', la cota ha oscilado entre ' + msnm(D.cota_hist.min) + ' (' + fDia(D.cota_hist.fecha_min) + ') y ' + msnm(D.cota_hist.max) + ' (' + fDia(D.cota_hist.fecha_max) + ').' : ''),
              spec: {
                type: 'line', xType: 'cat', x: (DI.x || []).map(fDia), yFormat: 'dec1', unidad: 'm', zoom: true, zoomDesde: 0,
                series: [{ name: 'Cota', data: DI.cota }]
              }
            }
          ]
        };
      }
    },

    /* -------------------------------------------------------- Histórico --- */
    {
      id: 'historico', nombre: 'Serie histórica',
      titulo: 'Más de cincuenta años de reservas',
      desc: 'Evolución del embalse desde su primer dato registrado. Las series largas se leen en porcentaje de llenado: la capacidad oficial ha pasado de 61,85 hm³ a 57,5 hm³ tras actualizar la curva de embalse, y comparar volúmenes de épocas distintas sobrestimaría las reservas antiguas.',
      render: function () {
        var M = D.mensual || {}, A = D.anual || {};
        var n = (M.x || []).length;
        var desde = Math.max(0, n - 60);
        return {
          cards: [
            {
              titulo: 'Llenado medio mensual', sub: 'Desde ' + Obs.periodo((M.x || [])[0], 'mes'),
              chips: [CHIP_MENSUAL], fuente: FUENTE_REDIAM, ancho: 'full', alto: 'tall',
              spec: {
                type: 'area', xType: 'mes', x: M.x, yFormat: 'pct', yMax: 100, zoom: true, zoomDesde: 0,
                series: [{ name: 'Llenado medio', data: M.porcentaje }]
              }
            },
            {
              titulo: 'Llenado al inicio y mínimo de cada año hidrológico', sub: 'Porcentaje a 1 de octubre y mínimo diario del año',
              chips: [CHIP_ANUAL], fuente: FUENTE_REDIAM, ancho: 'full',
              spec: {
                type: 'line', xType: 'cat', x: A.x, yFormat: 'pct', desdeCero: true, yMax: 100, zoom: false,
                series: [
                  { name: 'A 1 de octubre', data: A.pct_inicio },
                  { name: 'Mínimo del año', data: A.pct_minimo }
                ]
              }
            },
            {
              titulo: 'Variación mensual de la reserva', sub: 'Diferencia entre el último día de cada mes y el del mes anterior, últimos cinco años',
              chips: [CHIP_MENSUAL], fuente: FUENTE_REDIAM, ancho: 'full',
              nota: 'Es el balance neto: entradas por lluvia y escorrentía menos desembalses para abastecimiento, evaporación y vertidos.',
              spec: {
                type: 'bar', xType: 'mes', x: (M.x || []).slice(desde), yFormat: 'dec1', unidad: 'hm³', zoom: false, yMin: sueloNeg((M.variacion || []).slice(desde)),
                series: [{ name: 'Variación', data: (M.variacion || []).slice(desde) }]
              }
            }
          ]
        };
      }
    },

    /* ---------------------------------------------------- Precipitación --- */
    {
      id: 'lluvia', nombre: 'Precipitaciones',
      titulo: 'Lluvia en el entorno del embalse',
      desc: 'Pluviometría diaria de la Red Hidrosur en la propia presa y en las estaciones más próximas de la cuenca y la costa. El año hidrológico va del 1 de octubre al 30 de septiembre, que es como se mide la lluvia útil para los embalses. Un día sin dato no se cuenta como día seco: los meses y años con menos del 90 % de días registrados se dejan en blanco.',
      render: function () {
        var LM = LL.mensual || {};
        var n = (LM.x || []).length, desde = Math.max(0, n - 36);
        var ultHidro = (H.x || []).length - 1;
        return {
          kpis: [
            { label: 'Año hidrológico ' + (AC.anio_actual || '') + ' (presa)', valor: lluviaAnioActual, formato: mm,
              /* Las primeras semanas del año hidrológico casi no llueve nunca: comparar
                 3 días con la media da porcentajes enormes y sin sentido. */
              delta: AC.hoy_pos >= 30 && mediaHastaHoy ? pctVar(lluviaAnioActual, mediaHastaHoy) : null, deltaRef: 'frente a la media a esta fecha' },
            { label: 'Año hidrológico ' + (AC.anio_anterior || '') + ' (presa)', valor: lluviaAnioAnt, formato: mm,
              delta: pctVar(lluviaAnioAnt, mediaAnual), deltaRef: 'frente a la media' },
            { label: 'Media anual (presa)', valor: mediaAnual, formato: mm },
            { label: 'Últimos 30 días (presa)', valor: lluvia30, formato: mm, serie: ultimos(LD[REF], 30) },
            { label: 'Última lluvia ≥ 1 mm' + (ultimoDiaLluvia ? ' (' + fDia(ultimoDiaLluvia.f) + ')' : ''), valor: ultimoDiaLluvia ? ultimoDiaLluvia.v : null, formato: mm }
          ],
          cards: [
            {
              titulo: 'Lluvia acumulada en el año hidrológico', sub: 'Pluviómetro de la presa, del 1 de octubre en adelante',
              chips: [CHIP_DIARIO], fuente: FUENTE_PLUVIO, ancho: 'full', alto: 'tall',
              nota: 'La media es la de los años hidrológicos completos de ' + (AC.referencia || '') + '.',
              spec: {
                type: 'line', xType: 'cat', x: (AC.x || []).map(fDiaHidro), yFormat: 'num', unidad: 'mm', desdeCero: true, zoom: false,
                series: [
                  { name: 'Media', data: AC.media },
                  { name: 'Año ' + (AC.anio_anterior || ''), data: AC.anterior },
                  { name: 'Año ' + (AC.anio_actual || ''), data: AC.actual }
                ]
              }
            },
            {
              titulo: 'Lluvia diaria en la presa', sub: 'Últimos 365 días',
              chips: [CHIP_DIARIO], fuente: FUENTE_PLUVIO, ancho: 'full',
              spec: {
                type: 'bar', xType: 'cat', x: (LD.x || []).map(fDia), yFormat: 'dec1', unidad: 'mm', zoom: false,
                series: [{ name: 'Lluvia', data: LD[REF] }]
              }
            },
            {
              titulo: 'Lluvia mensual por estación', sub: 'Últimos 36 meses',
              chips: [CHIP_MENSUAL], fuente: FUENTE_PLUVIO, ancho: 'full',
              spec: {
                type: 'line', xType: 'mes', x: (LM.x || []).slice(desde), yFormat: 'num', unidad: 'mm', desdeCero: true,
                series: ESTS.map(function (e) { return { name: e.nombre, data: (LM[e.id] || []).slice(desde) }; })
              }
            },
            {
              titulo: 'Lluvia total por año hidrológico', sub: 'Años cerrados desde ' + ((H.x || [])[0] || ''),
              chips: [CHIP_ANUAL], fuente: FUENTE_PLUVIO,
              spec: {
                type: 'line', xType: 'cat', x: H.x, yFormat: 'num', unidad: 'mm', desdeCero: true,
                series: ESTS.map(function (e) { return { name: e.nombre, data: H[e.id] }; })
              }
            },
            {
              titulo: 'Año hidrológico ' + ((H.x || [])[ultHidro] || '') + ' por estación', sub: 'Lluvia total del último año cerrado',
              chips: [CHIP_ANUAL], fuente: FUENTE_PLUVIO,
              spec: {
                type: 'barh', x: ESTS.map(function (e) { return e.nombre; }), yFormat: 'num', unidad: 'mm',
                series: [{ name: 'Lluvia', data: ESTS.map(function (e) { return (H[e.id] || [])[ultHidro]; }) }]
              }
            }
          ]
        };
      }
    },

    /* ---------------------------------------------------------- Balance --- */
    {
      id: 'balance', nombre: 'Lluvia y reserva',
      titulo: 'Cómo responde el embalse a la lluvia',
      desc: 'La misma ventana de tres años, en dos gráficas alineadas: arriba la lluvia mensual en la presa, abajo cuánto ha ganado o perdido el embalse ese mes. Se dibujan por separado porque son magnitudes distintas (mm y hm³) y el kit no superpone escalas.',
      render: function () {
        var LM = LL.mensual || {}, M = D.mensual || {};
        /* Ventana común: los últimos 36 meses presentes en las dos series. */
        var meses = (LM.x || []).filter(function (m) { return (M.x || []).indexOf(m) >= 0; }).slice(-36);
        var lluviaM = meses.map(function (m) { return (LM[REF] || [])[(LM.x || []).indexOf(m)]; });
        var varM = meses.map(function (m) { return (M.variacion || [])[(M.x || []).indexOf(m)]; });
        return {
          cards: [
            {
              titulo: 'Lluvia mensual en la presa', sub: 'Últimos 36 meses',
              chips: [CHIP_MENSUAL], fuente: FUENTE_PLUVIO, ancho: 'full',
              spec: { type: 'bar', xType: 'mes', x: meses, yFormat: 'num', unidad: 'mm', series: [{ name: 'Lluvia', data: lluviaM }] }
            },
            {
              titulo: 'Variación mensual de la reserva', sub: 'Últimos 36 meses',
              chips: [CHIP_MENSUAL], fuente: FUENTE_REDIAM, ancho: 'full',
              spec: { type: 'bar', xType: 'mes', x: meses, yFormat: 'dec1', unidad: 'hm³', yMin: sueloNeg(varM), series: [{ name: 'Variación', data: varM }] }
            }
          ]
        };
      }
    }
  ];

  /* ----------------------------------------------------------- Arranque -- */

  var GOTA = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:22px;height:22px">' +
    '<path d="M12 3.5c3.2 4 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2.8-6.5 6-10.5z"/><path d="M9 14.5a3 3 0 0 0 3 3"/></svg>';

  Obs.init({
    titulo: 'Observatorio Hídrico · Embalse de La Concepción',
    subtitulo: 'Reserva, cota y lluvia en el río Verde (Istán, Málaga) con datos oficiales actualizados cada día',
    icono: GOTA,
    secciones: SECCIONES,
    actualizado: (D.meta || {}).actualizado,
    fuentes: [FUENTE_REDIAM, FUENTE_COTA, FUENTE_RESUMEN],
    metodologia: 'Un proceso automático (<code>pipeline/build_data.py</code>) se ejecuta cada mañana en GitHub Actions: descarga la reserva diaria del visor de embalses de REDIAM y la cota y la pluviometría de la Red Hidrosur, ' +
      'y vuelca <code>data/data.js</code>. Las series de Hidrosur se guardan en una caché incremental que se completa con los últimos días en cada ejecución. ' +
      'Cada tarjeta enlaza a su fuente y permite ver los datos en tabla y descargarlos en CSV.',
    pie: 'Los datos son de las fuentes citadas; su tratamiento y presentación, de este observatorio. ' +
      'Los datos en tiempo real del SAIH son provisionales y pueden corregirse después de su publicación.'
  });

  Obs.estado('Último dato del embalse: ' + fDiaLargo(E.fecha), 'live');

})();
