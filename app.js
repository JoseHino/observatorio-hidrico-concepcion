/* ============================================================================
   app.js — Observatorio Hídrico del embalse de La Concepción (Istán, Málaga).
   Una sola vista: recuadro de situación, cuatro gráficas con un dato por hora
   que comparten los selectores de periodo y de pluviómetro, y la previsión.

   Los datos horarios (Red Hidrosur, desde 2000) van en un fichero por año
   (data/horario/AAAA.js) y solo se descargan los del periodo elegido. Antes de
   2000 no hay registro horario: el volumen sale de la reserva diaria de REDIAM.

   El kit dibuja con eje de categorías y no está pensado para cientos de miles
   de puntos, así que las gráficas horarias se dibujan aquí con ECharts y los
   mismos tokens de tema; el kit sigue montando tarjetas, tabla, CSV y PNG.
   ========================================================================== */
(function () {
  'use strict';

  var D = window.DATOS || {};
  var F = Obs.fmt;
  var E = D.embalse || {};
  var ED = D.embalse_diario || {};
  var LD = D.lluvia_diaria || {};
  var SECCION = 'embalse';

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* ---------------------------------------------------------- Fechas */

  var HORA = 3600000, DIA = 86400000;
  var aMs = function (iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); };
  var aIso = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
  var sumarDias = function (iso, n) { return aIso(aMs(iso) + n * DIA); };
  var fDia = function (iso) { return (+iso.slice(8, 10)) + ' ' + MESES[+iso.slice(5, 7) - 1] + ' ' + iso.slice(2, 4); };
  var fLargo = function (iso) {
    return iso ? (+iso.slice(8, 10)) + ' de ' + MESES_L[+iso.slice(5, 7) - 1] + ' de ' + iso.slice(0, 4) : '—';
  };
  /* Las horas del SAIH se tratan como UTC para que nada las mueva de zona. */
  var fHora = function (ms) {
    var d = new Date(ms);
    return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' +
      ('0' + d.getUTCHours()).slice(-2) + ':00';
  };

  /* ---------------------------------------------------------- Estado */

  var PERIODOS = [
    { v: '7', txt: 'Últimos 7 días' },
    { v: '30', txt: 'Últimos 30 días' },
    { v: '90', txt: 'Últimos 3 meses' },
    { v: '182', txt: 'Últimos 6 meses' },
    { v: '365', txt: 'Último año' },
    { v: '1096', txt: 'Últimos 3 años' },
    { v: '1826', txt: 'Últimos 5 años' },
    { v: '3653', txt: 'Últimos 10 años' },
    { v: '9131', txt: 'Últimos 25 años' },
    { v: 'todo', txt: 'Toda la serie (desde ' + (ED.inicio || '').slice(0, 4) + ')' }
  ];
  /* Hasta 3 años la tabla y el CSV van hora a hora (unas 26.000 filas); en
     periodos más largos se resumen por días para que el navegador no se ahogue. */
  var TABLA_HORARIA_DIAS = 1100;

  var ESTACIONES = LD.estaciones || [];
  var estado = { periodo: '30', estacion: LD.ref || '016P01' };
  try {
    var g = localStorage.getItem('hidrico-periodo');
    if (PERIODOS.some(function (p) { return p.v === g; })) estado.periodo = g;
    var ge = localStorage.getItem('hidrico-estacion');
    if (ESTACIONES.some(function (e) { return e.id === ge; })) estado.estacion = ge;
  } catch (e) {}

  var nombreEstacion = function (id) {
    var e = ESTACIONES.filter(function (x) { return x.id === id; })[0];
    return e ? e.nombre : id;
  };

  function rango() {
    var hasta = E.fecha;
    var desde = estado.periodo === 'todo' ? ED.inicio : sumarDias(hasta, -(+estado.periodo - 1));
    if (desde < ED.inicio) desde = ED.inicio;
    var dias = Math.round((aMs(hasta) - aMs(desde)) / DIA) + 1;
    return { desde: desde, hasta: hasta, t0: aMs(desde), t1: aMs(hasta) + 23 * HORA, dias: dias };
  }

  function valorEn(inicio, valores, iso) {
    var i = Math.round((aMs(iso) - aMs(inicio)) / DIA);
    return i >= 0 && i < valores.length ? valores[i] : null;
  }

  function capacidadEn(ms) {
    var iso = aIso(ms), c = null;
    (ED.capacidad || []).forEach(function (tr) { if (tr.desde <= iso) c = tr.capacidad; });
    return c;
  }

  /* ------------------------------------------------- Carga de datos horarios */

  var cargados = {};
  function cargarAnio(a) {
    if (!cargados[a]) {
      cargados[a] = new Promise(function (ok) {
        if (window.HORARIO && window.HORARIO[a]) return ok();
        var s = document.createElement('script');
        s.src = 'data/horario/' + a + '.js';
        s.onload = function () { ok(); };
        s.onerror = function () { ok(); };      /* un año que falta no tumba las gráficas */
        document.head.appendChild(s);
      });
    }
    return cargados[a];
  }

  /* Series del periodo como pares [ms, valor]. El volumen anterior al primer
     dato horario se completa con la reserva diaria de REDIAM (lectura de las 8:00). */
  function series(r) {
    var anios = ((D.horario || {}).anios || []).filter(function (a) {
      return a >= r.desde.slice(0, 4) && a <= r.hasta.slice(0, 4);
    });
    var vol = [], ll = [], primera = Infinity;
    anios.forEach(function (a) {
      var H = (window.HORARIO || {})[a];
      if (!H) return;
      var base = Date.UTC(+a, 0, 1);
      var lluvia = Array.isArray(H.lluvia) ? (estado.estacion === LD.ref ? H.lluvia : []) : (H.lluvia[estado.estacion] || []);
      var n = Math.max(H.vol.length, lluvia.length);
      for (var i = 0; i < n; i++) {
        var t = base + i * HORA;
        if (t < r.t0 || t > r.t1) continue;
        if (H.vol[i] != null) { vol.push([t, H.vol[i]]); if (t < primera) primera = t; }
        if (lluvia[i] != null) ll.push([t, lluvia[i]]);
      }
    });
    var previo = [];
    for (var t = r.t0; t <= r.t1 && t < primera; t += DIA) {
      var v = valorEn(ED.inicio, ED.volumen || [], aIso(t));
      if (v != null) previo.push([t + 8 * HORA, v]);
    }
    vol = previo.concat(vol);
    var pct = vol.map(function (p) {
      var c = capacidadEn(p[0]);
      return [p[0], c ? Math.round(p[1] / c * 1000) / 10 : null];
    });
    /* Capacidad máxima en escalón: un punto al inicio, en cada revisión y al final. */
    var cap = [[r.t0, capacidadEn(r.t0)]];
    (ED.capacidad || []).forEach(function (tr) {
      var t = aMs(tr.desde);
      if (t > r.t0 && t <= r.t1) { cap.push([t - HORA, cap[cap.length - 1][1]]); cap.push([t, tr.capacidad]); }
    });
    cap.push([r.t1, capacidadEn(r.t1)]);
    return { vol: vol, pct: pct, lluvia: ll, cap: cap, horaria: primera !== Infinity ? primera : null };
  }

  /* ---------------------------------------------------------- Fuentes */

  var URL_HIDROSUR = 'https://www.redhidrosurmedioambiente.es/saih/datos/a/la/carta';
  var FUENTE_REDIAM = { txt: 'REDIAM · Visor de embalses de Andalucía', url: 'https://portalrediam.cica.es/embalses/' };
  var FUENTE_VOL = { txt: 'Red Hidrosur · SAIH 016E01 (horario) y REDIAM (diario, antes de 2000)', url: URL_HIDROSUR };
  var FUENTE_PLUVIO = { txt: 'Red Hidrosur · SAIH, pluviómetros (horario)', url: URL_HIDROSUR };
  var FUENTE_COTA = { txt: 'Red Hidrosur · SAIH, cota 016E01', url: URL_HIDROSUR };
  var CHIP = { txt: 'Horario', tipo: 'live' };

  var colorLluvia = function () { return Obs.tema().serie[6]; };
  var hm3 = function (v) { return v == null ? '—' : F.num(v, 2) + ' hm³'; };

  /* ------------------------------------------------- Ecuación lluvia-volumen
     Número de curva del SCS ajustado por temporales con datos horarios
     (pipeline/ajustar_modelo.py):
       S  = S0 · e^(−P90/β)                         retención del suelo (mm)
       Q  = (P − λS)² / (P + (1−λ)S)   si P > λS   escorrentía (mm)
       ΔV = a · Q                                   subida del embalse (hm³)
     P: lluvia del temporal en la presa · P90: lluvia de los 90 días previos. */
  var MOD = D.modelo || null;
  var MP = MOD ? MOD.parametros : null;

  function subida(P, P90) {
    if (!MP) return null;
    var S = MP.S0 * Math.exp(-P90 / MP.beta), Ia = MP.lambda * S;
    var Q = P > Ia ? (P - Ia) * (P - Ia) / (P + (1 - MP.lambda) * S) : 0;
    return MP.a * Q;
  }

  function lluvia90() {
    var s = (LD.series || {})[LD.ref] || [], tot = 0, n = 0;
    for (var i = 1; i <= 90; i++) {
      var v = valorEn(LD.inicio, s, sumarDias(E.fecha, -i + 1));
      if (v != null) { tot += v; n++; }
    }
    return n >= 80 ? tot : null;
  }

  function techo() { return Math.min(MP.Vtecho, E.capacidad); }

  function lluviaParaLlenar(P90) {
    var falta = techo() - E.volumen;
    if (falta <= 0) return 0;
    var lo = 0, hi = 3000;
    if (subida(hi, P90) < falta) return null;
    for (var i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (subida(m, P90) < falta) lo = m; else hi = m; }
    return hi;
  }

  var dias = function (h) { return F.num(h / 24, 0); };

  function tarjetaPrevision() {
    if (!MP) return null;
    var P90 = lluvia90() || 0, tp = techo();
    var lim = function (v) { return Math.round(Math.min(tp, E.volumen + v) * 100) / 100; };
    var xs = [], hoy = [], humedo = [];
    for (var P = 0; P <= 400; P += 10) {
      xs.push(P + ' mm');
      hoy.push(lim(subida(P, P90)));
      humedo.push(lim(subida(P, 300)));
    }
    return {
      id: 'prevision',
      titulo: 'Previsión: volumen tras un temporal',
      sub: 'Volumen esperado a partir del actual (' + F.num(E.volumen, 1) + ' hm³) según la lluvia total del temporal en la presa',
      chips: [{ txt: 'Modelo' }], fuente: FUENTE_VOL, ancho: 'full',
      nota: 'Las curvas se aplanan al llegar al techo de explotación (' + F.num(tp, 1) + ' hm³): a partir de ahí la presa desembalsa en lugar de seguir llenándose. El embalse alcanza su pico, de mediana, unos ' + dias(MOD.retardo_mediano_h || 130) + ' días después de que empiece a llover.',
      spec: {
        type: 'line', xType: 'cat', x: xs, yFormat: 'dec1', unidad: 'hm³', desdeCero: true, zoom: false,
        xLabel: 'Lluvia del temporal', yMax: Math.ceil(E.capacidad / 10) * 10,
        series: [
          { name: 'Con la humedad actual del suelo (' + F.num(P90, 0) + ' mm en 90 días)', data: hoy },
          { name: 'Con el suelo empapado (300 mm en 90 días)', data: humedo }
        ]
      }
    };
  }

  function bloqueSimulador() {
    if (!MP) return '';
    var P90 = lluvia90() || 0;
    var pLlenar = lluviaParaLlenar(P90);
    return '<div class="obs-grid"><article class="obs-card span-2 hidrico-sim">' +
      '<div class="obs-card-head"><div class="t"><h3>Calculadora de riesgo de llenado</h3>' +
      '<div class="cs">Escribe la lluvia total prevista para el temporal en la presa (por ejemplo, la de un aviso de AEMET)</div></div></div>' +
      '<div class="hidrico-sim-in">' +
        '<label><span>Lluvia prevista</span>' +
        '<span class="hidrico-sim-campo"><input type="number" id="sim-mm" min="0" max="1000" step="5" value="100"> mm</span></label>' +
        '<input type="range" id="sim-rango" min="0" max="400" step="5" value="100" aria-label="Lluvia prevista">' +
      '</div>' +
      '<div class="hidrico-sim-out" id="sim-out"></div>' +
      '<div class="hidrico-sim-ecu">' +
        '<b>Ecuación</b> (número de curva del SCS, ajustada hora a hora con ' + MOD.episodios + ' temporales de ' + MOD.umbral_mm + ' mm o más entre ' + MOD.desde.slice(0, 4) + ' y ' + MOD.hasta.slice(0, 4) + '):<br>' +
        '<code>S = ' + F.num(MP.S0, 0) + ' · e<sup>−P90/' + F.num(MP.beta, 1) + '</sup></code> &nbsp;·&nbsp; ' +
        '<code>Q = (P − ' + F.num(MP.lambda, 2) + '·S)² / (P + ' + F.num(1 - MP.lambda, 2) + '·S)</code> &nbsp;·&nbsp; ' +
        '<code>ΔV = ' + F.num(MP.a, 3) + ' · Q</code> hm³<br>' +
        'P: lluvia del temporal (mm) · P90: lluvia de los 90 días anteriores (mm), que mide lo húmedo que está el suelo · S: agua que el suelo es capaz de retener (mm) · Q: escorrentía (mm). ' +
        F.num(MP.a, 3) + ' hm³ por mm de escorrentía equivale a unos ' + F.num(MP.a * 1000, 0) + ' km² de cuenca aportando. ' +
        (pLlenar == null ? '' : 'Con la humedad actual del suelo haría falta un temporal de unos <b>' + F.num(pLlenar, 0) + ' mm</b> para llevar el embalse a su techo. ') +
        'Validada dejando fuera cada año y prediciéndolo con el resto: explica el ' + F.num(MOD.r2_validacion * 100, 0) + ' % de la subida del embalse en cada temporal, con un error medio de ±' + F.num(MOD.error_medio_validacion_hm3, 1) + ' hm³. Sirve para estimar el orden de magnitud; no sustituye a los avisos oficiales.' +
      '</div></article></div>';
  }

  function calcularSimulador() {
    var inp = document.getElementById('sim-mm'), out = document.getElementById('sim-out');
    if (!inp || !out || !MP) return;
    var P = Math.max(0, +inp.value || 0), P90 = lluvia90() || 0;
    var dv = subida(P, P90), tp = techo(), fin = E.volumen + dv;
    var bajo = Math.max(0, dv + MOD.error_p10), alto = dv + MOD.error_p90;
    var nivel, cls;
    if (fin >= tp) { nivel = 'Superaría el techo de explotación: la presa tendría que desembalsar o verter. Conviene vigilar el río Verde aguas abajo.'; cls = 'crit'; }
    else if (E.volumen + alto >= tp) { nivel = 'Podría acercarse al techo: es probable que haya desembalses preventivos.'; cls = 'warn'; }
    else { nivel = 'Sin riesgo de llenado: el embalse absorbería el agua.'; cls = 'ok'; }
    out.innerHTML =
      '<div><div class="v">+' + F.num(dv, 1) + ' hm³</div><div class="l">Subida esperada (entre ' + F.num(bajo, 1) + ' y ' + F.num(alto, 1) + '), con el pico unos ' + dias(MOD.retardo_mediano_h || 130) + ' días después</div></div>' +
      '<div><div class="v">' + F.num(Math.min(fin, tp), 1) + ' hm³</div><div class="l">Volumen final · ' + F.pct(Math.min(fin, tp) / E.capacidad * 100) + ' de llenado</div></div>' +
      '<div><div class="v">' + F.num(Math.max(0, fin - tp), 1) + ' hm³</div><div class="l">Agua que tendría que desembalsarse</div></div>' +
      '<div class="hidrico-sim-nivel ' + cls + '">' + nivel + '</div>';
  }

  function engancharSimulador() {
    var inp = document.getElementById('sim-mm'), rng = document.getElementById('sim-rango');
    if (!inp || !rng) return;
    inp.addEventListener('input', function () { rng.value = Math.min(400, +inp.value || 0); calcularSimulador(); });
    rng.addEventListener('input', function () { inp.value = rng.value; calcularSimulador(); });
    calcularSimulador();
  }

  /* ---------------------------------------------------------- Sección */

  function seccion() {
    var notaHoras = 'Un dato por hora de la Red Hidrosur desde ' + ((D.horario || {}).anios || ['2000'])[0] +
      ' (horas del SAIH, sin cambio de hora de verano). La tabla y el CSV van hora a hora hasta 3 años; en periodos más largos, por días.';
    var res = {
      hero: {
        valor: E.volumen, label: 'Volumen embalsado a ' + fLargo(E.fecha), formato: hm3,
        extra: [
          { label: 'Capacidad máxima del embalse', valor: E.capacidad, formato: hm3 },
          { label: 'Porcentaje de llenado', valor: E.porcentaje, formato: function (v) { return F.pct(v); } },
          { label: 'Cota de la lámina de agua', valor: E.cota, formato: function (v) { return v == null ? '—' : F.num(v, 2) + ' m s. n. m.'; } }
        ]
      },
      cards: [
        { id: 'g-volumen', titulo: 'Volumen embalsado', sub: 'Hectómetros cúbicos, hora a hora', chips: [CHIP], fuente: FUENTE_VOL,
          nota: 'La línea discontinua es la capacidad máxima oficial en cada momento (se revisó de 61,85 a 57,5 hm³). Antes de 2000 no hay registro horario y se usa la reserva diaria de REDIAM.' },
        { id: 'g-llenado', titulo: 'Porcentaje de llenado', sub: 'Volumen sobre capacidad máxima, hora a hora', chips: [CHIP], fuente: FUENTE_VOL,
          nota: notaHoras },
        { id: 'g-lluvia', titulo: 'Precipitación · ' + nombreEstacion(estado.estacion), sub: 'Lluvia de cada hora, en milímetros (l/m²)', chips: [CHIP], fuente: FUENTE_PLUVIO, ancho: 'full',
          nota: 'Cambia de pluviómetro en el selector de arriba. Registros desde 2000 (el del río Guadaiza, desde 2024). ' + notaHoras },
        { id: 'g-comparativa', titulo: 'Volumen embalsado y precipitación', sub: 'Lluvia en ' + nombreEstacion(estado.estacion) + ' (arriba) y volumen del embalse (abajo), hora a hora y sobre el mismo eje de tiempo',
          chips: [CHIP], fuente: FUENTE_PLUVIO, ancho: 'full', alto: 'tall',
          nota: 'Dos paneles con su propia escala, alineados en el tiempo, en lugar de dos escalas superpuestas: así se ve qué temporales hacen subir el embalse sin falsear ninguna de las dos magnitudes.' },
        tarjetaPrevision()
      ],
      extra: bloqueSimulador()
    };
    res.cards = res.cards.filter(Boolean);
    return res;
  }

  /* ---------------------------------------------- Dibujo de gráficas horarias */

  function rotuloTiempo(span) {
    return function (ms) {
      var d = new Date(ms), dia = d.getUTCDate(), mes = MESES[d.getUTCMonth()], an = d.getUTCFullYear();
      if (span <= 4 * DIA) return ('0' + d.getUTCHours()).slice(-2) + ':00' + (d.getUTCHours() === 0 ? '\n' + dia + ' ' + mes : '');
      if (span <= 120 * DIA) return dia + ' ' + mes;
      if (span <= 4 * 365 * DIA) return mes + ' ' + String(an).slice(2);
      return String(an);
    };
  }

  var instancias = {};

  /* paneles: [{ nombreY, yMax, series: [{ name, tipo:'line'|'bar', area, dashed, color, data, dec, unidad }] }] */
  function pintar(id, r, paneles, tabla) {
    var card = document.querySelector('[data-card="' + id + '"]');
    var nodo = card && card.querySelector('.obs-plot');
    if (!nodo || typeof echarts === 'undefined') return;
    var T = Obs.tema();
    if (instancias[id]) { instancias[id].dispose(); delete instancias[id]; }
    var previa = echarts.getInstanceByDom(nodo);
    if (previa) previa.dispose();
    nodo.innerHTML = '';
    nodo.classList.remove('is-loading');
    var hay = paneles.some(function (p) { return p.series.some(function (s) { return s.data.length && !s.aux; }); });
    if (!hay) { Obs.mensaje(nodo, 'vacio', 'Sin registros en el periodo elegido.'); nodo.__obsSpec = null; return; }
    var inst = instancias[id] = echarts.init(nodo, null, { renderer: 'canvas', devicePixelRatio: 2 });

    var n = paneles.length;
    var grids = n === 1
      ? [{ left: 56, right: 20, top: 30, bottom: 62 }]
      : [{ left: 56, right: 20, top: 30, height: '26%' }, { left: 56, right: 20, top: '44%', bottom: 86 }];
    var leyendaNombres = [];
    var series = [];
    paneles.forEach(function (p, i) {
      p.series.forEach(function (s) {
        if (!s.aux || s.leyenda) leyendaNombres.push(s.name);
        var base = { name: s.name, xAxisIndex: i, yAxisIndex: i, data: s.data, z: s.aux ? 2 : 3 };
        if (s.tipo === 'bar') {
          series.push(Object.assign(base, { type: 'bar', barMaxWidth: 6, barMinWidth: 1, large: true, largeThreshold: 3000,
            itemStyle: { color: s.color } }));
        } else {
          series.push(Object.assign(base, { type: 'line', showSymbol: false, symbol: 'circle', symbolSize: 8,
            sampling: s.data.length > 20000 ? 'lttb' : undefined,
            lineStyle: { width: s.aux ? 1.5 : 2, color: s.color, type: s.dashed ? 'dashed' : 'solid' },
            itemStyle: { color: s.color },
            areaStyle: s.area ? { color: s.color, opacity: 0.10 } : undefined }));
        }
      });
    });
    var porNombre = {};
    paneles.forEach(function (p) { p.series.forEach(function (s) { porNombre[s.name] = s; }); });

    inst.setOption({
      animation: false,
      useUTC: true,
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: grids,
      xAxis: paneles.map(function (p, i) {
        return {
          type: 'time', gridIndex: i, min: r.t0, max: r.t1,
          axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
          axisLabel: { show: i === n - 1, color: T.mut, fontSize: 11, fontFamily: T.font, hideOverlap: true, margin: 10,
                       formatter: rotuloTiempo(r.t1 - r.t0) },
          splitLine: { show: false }
        };
      }),
      yAxis: paneles.map(function (p, i) {
        return {
          type: 'value', gridIndex: i, min: 0, max: p.yMax, interval: p.intervalo, name: p.nombreY, splitNumber: n === 1 ? 4 : 3,
          nameTextStyle: { color: T.mut, fontSize: 11, fontFamily: T.font, align: 'left', padding: [0, 0, 4, -40] },
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: T.mut, fontSize: 11, fontFamily: T.font, formatter: function (v) { return F.num(v, v % 1 ? 1 : 0); } },
          splitLine: { lineStyle: { color: T.grid, width: 1, type: 'solid' } }
        };
      }),
      tooltip: {
        trigger: 'axis', confine: true, appendToBody: true,
        backgroundColor: T.surface, borderColor: T.line, borderWidth: 1, padding: [9, 12],
        textStyle: { color: T.ink, fontSize: 12.5, fontFamily: T.font },
        extraCssText: 'box-shadow:0 6px 22px rgba(15,27,45,.14);border-radius:8px;',
        axisPointer: { type: 'line', lineStyle: { color: T.axis, width: 1 }, label: { show: false } },
        formatter: function (ps) {
          var arr = Array.isArray(ps) ? ps : [ps];
          if (!arr.length) return '';
          return '<div style="font-weight:600;margin-bottom:5px">' + fHora(arr[0].value[0]) + '</div>' +
            arr.map(function (it) {
              var s = porNombre[it.seriesName] || {};
              var v = it.value[1] == null ? '—' : F.num(it.value[1], s.dec == null ? 1 : s.dec) + (s.unidad ? ' ' + s.unidad : '');
              return '<div style="display:flex;gap:10px;align-items:center;margin:2px 0">' +
                '<span style="width:9px;height:9px;border-radius:2px;background:' + it.color + ';flex:none"></span>' +
                '<span style="color:' + T.ink2 + ';flex:1 1 auto">' + it.seriesName + '</span>' +
                '<b style="font-variant-numeric:tabular-nums">' + v + '</b></div>';
            }).join('');
        }
      },
      legend: {
        show: leyendaNombres.length > 1, data: leyendaNombres, bottom: 0, left: 'center',
        itemWidth: 11, itemHeight: 11, itemGap: 14, icon: 'roundRect',
        textStyle: { color: T.ink2, fontSize: 11.5, fontFamily: T.font }
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: paneles.map(function (_, i) { return i; }), start: 0, end: 100 },
        { type: 'slider', xAxisIndex: paneles.map(function (_, i) { return i; }), height: 18,
          bottom: leyendaNombres.length > 1 ? 30 : 8, start: 0, end: 100,
          labelFormatter: function (v) { return fHora(v); },
          borderColor: 'transparent', backgroundColor: T.grid,
          fillerColor: 'rgba(42,120,214,.14)', handleStyle: { color: T.surface, borderColor: T.axis },
          moveHandleStyle: { color: T.axis }, textStyle: { color: T.mut, fontSize: 10, fontFamily: T.font },
          dataBackground: { lineStyle: { color: T.axis }, areaStyle: { color: T.grid } } }
      ],
      series: series
    }, true);
    if (n === 1) inst.setOption({ grid: [{ bottom: leyendaNombres.length > 1 ? 86 : 62 }] });

    /* Al acercar el zoom, los rótulos del eje ganan detalle (de años a horas). */
    inst.on('datazoom', function () {
      var z = inst.getOption().dataZoom[0], span = (r.t1 - r.t0) * ((z.end - z.start) / 100);
      inst.setOption({ xAxis: paneles.map(function () { return { axisLabel: { formatter: rotuloTiempo(span) } }; }) });
    });

    nodo.__obsSpec = especTabla(r, tabla);
  }

  /* Tabla y CSV de la tarjeta (los leen las herramientas del kit). */
  function especTabla(r, tabla) {
    var horaria = r.dias <= TABLA_HORARIA_DIAS;
    var mapas = tabla.series.map(function (s) {
      var m = {};
      s.data.forEach(function (p) { m[p[0]] = p[1]; });
      return m;
    });
    var x = [], cols = tabla.series.map(function () { return []; });
    if (horaria) {
      for (var t = r.t0; t <= r.t1; t += HORA) {
        x.push(fHora(t));
        mapas.forEach(function (m, i) { cols[i].push(t in m ? m[t] : null); });
      }
    } else {
      for (var d = r.t0; d <= r.t1; d += DIA) {
        x.push(fDia(aIso(d)));
        tabla.series.forEach(function (s, i) {
          var m = mapas[i];
          if (s.suma) {
            var tot = 0, k = 0;
            for (var h = 0; h < 24; h++) { var v = m[d + h * HORA]; if (v != null) { tot += v; k++; } }
            cols[i].push(k ? Math.round(tot * 10) / 10 : null);
          } else {
            var v8 = m[d + 8 * HORA];
            cols[i].push(v8 != null ? v8 : null);
          }
        });
      }
    }
    return {
      type: 'line', xType: 'cat', x: x, xLabel: horaria ? 'Hora' : 'Día', yFormat: 'dec1',
      tablaFormato: function (v) { return v == null || !isFinite(v) ? '—' : F.num(v, 2); },
      series: tabla.series.map(function (s, i) {
        return { name: horaria ? s.name : (s.suma ? s.nameDia || s.name : s.name + ' a las 8:00'), data: cols[i], color: s.color };
      })
    };
  }

  var turno = 0;
  function dibujarHorarias() {
    var r = rango(), mio = ++turno;
    ['g-volumen', 'g-llenado', 'g-lluvia', 'g-comparativa'].forEach(function (id) {
      var c = document.querySelector('[data-card="' + id + '"] .obs-plot');
      if (c) Obs.cargando(c);
    });
    var anios = ((D.horario || {}).anios || []).filter(function (a) {
      return a >= r.desde.slice(0, 4) && a <= r.hasta.slice(0, 4);
    });
    Promise.all(anios.map(cargarAnio)).then(function () {
      if (mio !== turno) return;                 /* el usuario ya cambió de periodo */
      var s = series(r), T = Obs.tema(), cLl = colorLluvia(), est = nombreEstacion(estado.estacion);
      var volS = { name: 'Volumen embalsado', data: s.vol, color: T.serie[0], area: true, dec: 2, unidad: 'hm³' };
      var capS = { name: 'Capacidad máxima', data: s.cap, color: T.mut, dashed: true, aux: true, leyenda: true, dec: 2, unidad: 'hm³' };
      var llS = { name: 'Lluvia por hora · ' + est, tipo: 'bar', data: s.lluvia, color: cLl, dec: 1, unidad: 'mm' };

      pintar('g-volumen', r, [{ nombreY: 'hm³', series: [volS, capS] }],
        { series: [{ name: 'Volumen (hm³)', data: s.vol }] });
      pintar('g-llenado', r, [{ nombreY: '%', yMax: 100, intervalo: 20, series: [{ name: 'Llenado', data: s.pct, color: T.serie[0], area: true, dec: 1, unidad: '%' }] }],
        { series: [{ name: 'Llenado (%)', data: s.pct }] });
      pintar('g-lluvia', r, [{ nombreY: 'mm/h', series: [llS] }],
        { series: [{ name: 'Lluvia (mm/h)', nameDia: 'Lluvia (mm/día)', data: s.lluvia, suma: true, color: cLl }] });
      pintar('g-comparativa', r, [
        { nombreY: 'Lluvia (mm/h)', series: [llS] },
        { nombreY: 'Volumen (hm³)', series: [volS] }
      ], { series: [
        { name: 'Lluvia ' + est + ' (mm/h)', nameDia: 'Lluvia ' + est + ' (mm/día)', data: s.lluvia, suma: true, color: cLl },
        { name: 'Volumen (hm³)', data: s.vol }
      ] });
    });
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () {
      Object.keys(instancias).forEach(function (k) { instancias[k].resize(); });
    }).observe(document.body);
  }

  function redibujar() {
    Obs.refrescar(SECCION);
    dibujarHorarias();
    engancharSimulador();
  }

  /* ----------------------------------------------------------- Arranque -- */

  var GOTA = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:22px;height:22px">' +
    '<path d="M12 3.5c3.2 4 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2.8-6.5 6-10.5z"/><path d="M9 14.5a3 3 0 0 0 3 3"/></svg>';

  var opciones = function (lista, valor) {
    return lista.map(function (o) {
      return '<option value="' + o.v + '"' + (o.v === valor ? ' selected' : '') + '>' + o.txt + '</option>';
    }).join('');
  };
  var controles =
    '<label class="obs-card-ctrl"><span>Periodo</span><select class="obs-select" id="hidrico-periodo">' +
      opciones(PERIODOS, estado.periodo) + '</select></label>' +
    '<label class="obs-card-ctrl"><span>Pluviómetro</span><select class="obs-select" id="hidrico-estacion">' +
      opciones(ESTACIONES.map(function (e) { return { v: e.id, txt: e.nombre }; }), estado.estacion) + '</select></label>';

  function arrancar() {
    Obs.init({
      titulo: 'Observatorio Hídrico · Embalse de La Concepción',
      subtitulo: 'Volumen, llenado y lluvia hora a hora en el río Verde (Istán, Málaga) con datos oficiales actualizados cada día',
      icono: GOTA,
      controles: controles,
      secciones: [{
        id: SECCION, nombre: 'Embalse',
        titulo: 'Embalse de La Concepción',
        desc: 'Todas las gráficas muestran un dato por hora. Elige arriba el periodo (de los últimos 7 días a toda la serie) y el pluviómetro. Dentro de cada gráfica puedes acercarte hasta la hora con la barra inferior o con la rueda del ratón.',
        render: seccion
      }],
      actualizado: (D.meta || {}).actualizado,
      fuentes: [FUENTE_VOL, FUENTE_PLUVIO, FUENTE_REDIAM, FUENTE_COTA],
      metodologia: 'Cada mañana un proceso automático en GitHub Actions descarga de la Red Hidrosur el volumen del embalse y la lluvia de cada pluviómetro hora a hora (desde 2000), y de REDIAM la reserva diaria (desde 1970), y publica la serie completa. ' +
        'Cada gráfica permite ver sus datos en tabla y descargarlos en CSV.',
      pie: 'Los datos son de las fuentes citadas; su tratamiento y presentación, de este observatorio. ' +
        'Los datos en tiempo real del SAIH son provisionales y pueden corregirse después de su publicación.'
    });

    dibujarHorarias();
    engancharSimulador();
    Obs.estado('Último dato: ' + fLargo(E.fecha), 'live');

    document.getElementById('hidrico-periodo').addEventListener('change', function () {
      estado.periodo = this.value;
      try { localStorage.setItem('hidrico-periodo', this.value); } catch (e) {}
      redibujar();
    });
    document.getElementById('hidrico-estacion').addEventListener('change', function () {
      estado.estacion = this.value;
      try { localStorage.setItem('hidrico-estacion', this.value); } catch (e) {}
      redibujar();
    });
    /* Al cambiar de tema se repintan las gráficas propias con los tokens nuevos. */
    document.getElementById('obs-tema-btn').addEventListener('click', redibujar);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redibujar);
  }

  /* ECharts mide y cachea el ancho de los rótulos la primera vez que los
     dibuja: si lo hace con la fuente de respaldo, las leyendas se montan.
     Se espera a Montserrat (como mucho 1,5 s) antes de montar nada. */
  var fuente = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('400 12px Montserrat'), document.fonts.load('600 12px Montserrat')])
    : Promise.resolve();
  var tope = new Promise(function (ok) { setTimeout(ok, 1500); });
  var arrancado = false;
  Promise.race([fuente, tope]).then(null, function () {}).then(function () {
    if (!arrancado) { arrancado = true; arrancar(); }
  });

})();
