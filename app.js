/* ============================================================================
   app.js — Observatorio Hídrico del embalse de La Concepción (Istán, Málaga).
   Una sola vista: recuadro de situación y cuatro gráficas que comparten el
   selector de periodo. Toda la serie histórica viaja en data.js; aquí se
   recorta y se agrega según el periodo elegido.
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

  var DIA = 86400000;
  var aMs = function (iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); };
  var aIso = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
  var sumarDias = function (iso, n) { return aIso(aMs(iso) + n * DIA); };
  var fDia = function (iso) { return (+iso.slice(8, 10)) + ' ' + MESES[+iso.slice(5, 7) - 1] + ' ' + iso.slice(2, 4); };
  var fMes = function (ym) { return MESES[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); };
  var fLargo = function (iso) {
    return iso ? (+iso.slice(8, 10)) + ' de ' + MESES_L[+iso.slice(5, 7) - 1] + ' de ' + iso.slice(0, 4) : '—';
  };

  /* ---------------------------------------------------------- Periodo */

  var PERIODOS = [
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
  var LIMITE_DIARIO = 400;          /* hasta ~1 año se ve día a día; más, por meses */

  var estado = { periodo: '365', estacion: LD.ref || '016P01' };
  try {
    var guardado = localStorage.getItem('hidrico-periodo');
    if (PERIODOS.some(function (p) { return p.v === guardado; })) estado.periodo = guardado;
  } catch (e) {}

  function rango() {
    var hasta = E.fecha;
    var desde = estado.periodo === 'todo' ? ED.inicio : sumarDias(hasta, -(+estado.periodo - 1));
    if (desde < ED.inicio) desde = ED.inicio;
    var dias = Math.round((aMs(hasta) - aMs(desde)) / DIA) + 1;
    return { desde: desde, hasta: hasta, diario: dias <= LIMITE_DIARIO };
  }

  /* Valor de una serie {inicio, valores[]} en una fecha ISO. */
  function valorEn(inicio, valores, iso) {
    var i = Math.round((aMs(iso) - aMs(inicio)) / DIA);
    return i >= 0 && i < valores.length ? valores[i] : null;
  }

  function diasEntre(desde, hasta) {
    var xs = [];
    for (var t = aMs(desde), fin = aMs(hasta); t <= fin; t += DIA) xs.push(aIso(t));
    return xs;
  }

  function capacidadEn(iso) {
    var c = null;
    (ED.capacidad || []).forEach(function (tr) { if (tr.desde <= iso) c = tr.capacidad; });
    return c;
  }

  /* La reserva es una magnitud continua: un hueco de 1 a 3 días sin publicar
     se interpola en línea recta para que la línea no se corte. Huecos mayores
     se dejan en blanco, porque ahí ya no se sabe qué pasó. */
  var HUECO_MAX = 3;
  function rellenarHuecos(v) {
    var out = v.slice(), i = 0;
    while (i < out.length) {
      if (out[i] != null) { i++; continue; }
      var j = i;
      while (j < out.length && out[j] == null) j++;
      var a = out[i - 1], b = out[j];
      if (i > 0 && j < out.length && j - i <= HUECO_MAX && a != null && b != null) {
        for (var k = i; k < j; k++) out[k] = Math.round((a + (b - a) * (k - i + 1) / (j - i + 1)) * 100) / 100;
      }
      i = j;
    }
    return out;
  }

  /* Serie de embalse en el periodo: diaria o, en periodos largos, el último
     día con dato de cada mes (la reserva es un nivel, no se suma). */
  function serieEmbalse(clave, r) {
    var dias = diasEntre(r.desde, r.hasta);
    var vals = rellenarHuecos(dias.map(function (f) { return valorEn(ED.inicio, ED[clave] || [], f); }));
    if (r.diario) return { x: dias, v: vals, mensual: false };
    var x = [], v = [];
    dias.forEach(function (f, i) {
      var m = f.slice(0, 7);
      if (x[x.length - 1] !== m) { x.push(m); v.push(null); }
      if (vals[i] != null) v[v.length - 1] = vals[i];
    });
    return { x: x, v: v, mensual: true };
  }

  /* Lluvia en el periodo: diaria, o total mensual. Un mes con menos del 90 %
     de días registrados no se suma (un día sin dato no es un día seco). */
  function serieLluvia(id, r) {
    var dias = diasEntre(r.desde, r.hasta);
    var s = (LD.series || {})[id] || [];
    var vals = dias.map(function (f) { return valorEn(LD.inicio, s, f); });
    if (r.diario) return { x: dias, v: vals, mensual: false };
    var x = [], v = [], n = [], tot = [];
    dias.forEach(function (f, i) {
      var m = f.slice(0, 7);
      if (x[x.length - 1] !== m) { x.push(m); v.push(0); n.push(0); tot.push(0); }
      var k = x.length - 1;
      tot[k]++;
      if (vals[i] != null) { v[k] += vals[i]; n[k]++; }
    });
    return {
      x: x, mensual: true,
      v: v.map(function (s, k) { return n[k] >= 0.9 * tot[k] ? Math.round(s * 10) / 10 : null; })
    };
  }

  var etiquetas = function (serie) { return serie.x.map(serie.mensual ? fMes : fDia); };
  var hm3 = function (v) { return v == null ? '—' : F.num(v, 2) + ' hm³'; };

  /* ---------------------------------------------------------- Fuentes */

  var FUENTE_REDIAM = { txt: 'REDIAM · Visor de embalses de Andalucía', url: 'https://portalrediam.cica.es/embalses/' };
  var FUENTE_PLUVIO = { txt: 'Red Hidrosur · SAIH, pluviómetros', url: 'https://www.redhidrosurmedioambiente.es/saih/datos/a/la/carta' };
  var FUENTE_HORARIO = { txt: 'Red Hidrosur · SAIH, datos horarios (016E01 y 016P01)', url: 'https://www.redhidrosurmedioambiente.es/saih/datos/a/la/carta' };
  var FUENTE_COTA = { txt: 'Red Hidrosur · SAIH, cota 016E01', url: 'https://www.redhidrosurmedioambiente.es/saih/datos/a/la/carta' };
  var chip = function (r) { return { txt: r.diario ? 'Diario' : 'Mensual', tipo: 'live' }; };

  /* Color propio de la lluvia, el mismo en su gráfica y en la comparativa,
     para que no se confunda con el azul del volumen. */
  var colorLluvia = function () { return Obs.tema().serie[6]; };

  /* ---------------------------------------------------------- Gráficas */

  function specLluvia(id) {
    var r = rango(), s = serieLluvia(id, r);
    return {
      type: 'bar', xType: 'cat', x: etiquetas(s), yFormat: 'dec1', unidad: 'mm',
      zoom: true, zoomDesde: 0, xLabel: s.mensual ? 'Mes' : 'Día',
      vacioTxt: 'Sin registros de esta estación en el periodo elegido.',
      series: [{ name: s.mensual ? 'Lluvia mensual' : 'Lluvia diaria', data: s.v, color: colorLluvia() }]
    };
  }

  function seccion() {
    var r = rango();
    var vol = serieEmbalse('volumen', r);
    var pct = serieEmbalse('porcentaje', r);
    var cap = vol.x.map(function (x) { return capacidadEn(vol.mensual ? x + '-28' : x); });
    var gran = r.diario ? 'datos diarios' : 'último dato de cada mes';
    var CHIP = chip(r);
    var opcionesEst = (LD.estaciones || []).map(function (e) { return { v: e.id, txt: e.nombre }; });

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
        {
          titulo: 'Volumen embalsado', sub: 'Hectómetros cúbicos · ' + gran,
          chips: [CHIP], fuente: FUENTE_REDIAM,
          nota: 'La línea discontinua es la capacidad máxima oficial en cada momento; se revisó de 61,85 a 57,5 hm³ al actualizar la curva del embalse.',
          spec: {
            type: 'line', xType: 'cat', x: etiquetas(vol), yFormat: 'dec1', unidad: 'hm³', desdeCero: true,
            zoom: true, zoomDesde: 0, xLabel: vol.mensual ? 'Mes' : 'Día',
            series: [
              { name: 'Volumen embalsado', data: vol.v },
              { name: 'Capacidad máxima', data: cap, dashed: true, color: Obs.tema().mut }
            ]
          }
        },
        {
          titulo: 'Porcentaje de llenado', sub: 'Volumen sobre capacidad máxima · ' + gran,
          chips: [CHIP], fuente: FUENTE_REDIAM,
          spec: {
            type: 'area', xType: 'cat', x: etiquetas(pct), yFormat: 'pct', yMax: 100,
            zoom: true, zoomDesde: 0, xLabel: pct.mensual ? 'Mes' : 'Día',
            series: [{ name: 'Llenado', data: pct.v }]
          }
        },
        {
          titulo: 'Precipitación', sub: (r.diario ? 'Lluvia diaria' : 'Lluvia total de cada mes') + ' · milímetros (l/m²)',
          chips: [CHIP], fuente: FUENTE_PLUVIO, ancho: 'full',
          nota: 'Los registros de lluvia empiezan en ' + (LD.inicio || '').slice(0, 4) + ' (el del río Guadaiza, en 2024). Un mes con menos del 90 % de días registrados se deja en blanco.',
          control: {
            label: 'Estación', valor: estado.estacion, opciones: opcionesEst,
            spec: function (id) { estado.estacion = id; return specLluvia(id); }
          },
          spec: specLluvia(estado.estacion)
        },
        {
          id: 'comparativa',
          titulo: 'Volumen embalsado y precipitación, hora a hora',
          sub: 'Lluvia en la presa (arriba) y volumen del embalse (abajo) sobre el mismo eje de tiempo',
          chips: [{ txt: 'Horario', tipo: 'live' }], fuente: FUENTE_HORARIO, ancho: 'full', alto: 'tall',
          nota: 'Datos de cada hora de la Red Hidrosur (desde ' + ((D.horario || {}).anios || ['2000'])[0] + '; antes, volumen diario de REDIAM). Horas del SAIH, sin cambio de hora de verano. Dos paneles con su propia escala, alineados en el tiempo, en lugar de dos escalas superpuestas. En periodos de más de un año, la tabla y el CSV se resumen por días.'
        },
        tarjetaPrevision()
      ],
      extra: bloqueSimulador()
    };
    res.cards = res.cards.filter(Boolean);
    return res;
  }

  /* ------------------------------------------------- Ecuación lluvia-volumen
     Modelo del número de curva (SCS) ajustado por episodios de lluvia con la
     serie histórica (pipeline/ajustar_modelo.py):
       S  = S0 · e^(−P90/β)                         retención del suelo (mm)
       Q  = (P − λS)² / (P + (1−λ)S)   si P > λS   escorrentía (mm)
       ΔV = a · Q                                   subida del embalse (hm³)
     con P la lluvia de una semana en la presa y P90 la de los 90 días previos. */
  var MOD = D.modelo || null;
  var MP = MOD ? MOD.parametros : null;

  function subida(P, P90) {
    if (!MP) return null;
    var S = MP.S0 * Math.exp(-P90 / MP.beta), Ia = MP.lambda * S;
    var Q = P > Ia ? (P - Ia) * (P - Ia) / (P + (1 - MP.lambda) * S) : 0;
    return MP.a * Q;
  }

  /* Lluvia de los 90 días anteriores al último dato, en la presa. */
  function lluvia90() {
    var s = (LD.series || {})[LD.ref] || [], tot = 0, n = 0;
    for (var i = 1; i <= 90; i++) {
      var v = valorEn(LD.inicio, s, sumarDias(E.fecha, -i + 1));
      if (v != null) { tot += v; n++; }
    }
    return n >= 80 ? tot : null;
  }

  /* Lluvia semanal que llevaría el embalse a su techo de explotación. */
  function lluviaParaLlenar(P90) {
    var falta = Math.min(MP.Vtecho, E.capacidad) - E.volumen;
    if (falta <= 0) return 0;
    var lo = 0, hi = 3000;
    if (subida(hi, P90) < falta) return null;
    for (var i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (subida(m, P90) < falta) lo = m; else hi = m; }
    return hi;
  }

  function tarjetaPrevision() {
    if (!MP) return null;
    var P90 = lluvia90() || 0;
    /* El volumen no puede pasar del techo: lo que sobra se desembalsa. La
       meseta de cada curva marca la lluvia a partir de la cual se llena. */
    var techo = Math.min(MP.Vtecho, E.capacidad);
    var lim = function (v) { return Math.round(Math.min(techo, E.volumen + v) * 100) / 100; };
    var xs = [], hoy = [], humedo = [];
    for (var P = 0; P <= 400; P += 10) {
      xs.push(P + ' mm');
      hoy.push(lim(subida(P, P90)));
      humedo.push(lim(subida(P, 300)));
    }
    return {
      id: 'prevision',
      titulo: 'Previsión: volumen tras una semana de lluvia',
      sub: 'Volumen esperado a partir del actual (' + F.num(E.volumen, 1) + ' hm³) según la lluvia que caiga en 7 días',
      chips: [{ txt: 'Modelo' }], fuente: FUENTE_REDIAM, ancho: 'full',
      nota: 'Las curvas se aplanan al llegar al techo de explotación (' + F.num(techo, 1) + ' hm³): a partir de ahí la presa desembalsa en lugar de seguir llenándose y el agua que entra sale hacia el río Verde. La misma lluvia llena mucho más el embalse con el suelo empapado que con el suelo seco.',
      spec: {
        type: 'line', xType: 'cat', x: xs, yFormat: 'dec1', unidad: 'hm³', desdeCero: true, zoom: false,
        xLabel: 'Lluvia en 7 días', yMax: Math.ceil(E.capacidad / 10) * 10,
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
      '<div class="cs">Escribe la lluvia prevista para los próximos 7 días en la presa (por ejemplo, la de un aviso de AEMET)</div></div></div>' +
      '<div class="hidrico-sim-in">' +
        '<label><span>Lluvia prevista en 7 días</span>' +
        '<span class="hidrico-sim-campo"><input type="number" id="sim-mm" min="0" max="1000" step="5" value="100"> mm</span></label>' +
        '<input type="range" id="sim-rango" min="0" max="400" step="5" value="100" aria-label="Lluvia prevista en 7 días">' +
      '</div>' +
      '<div class="hidrico-sim-out" id="sim-out"></div>' +
      '<div class="hidrico-sim-ecu">' +
        '<b>Ecuación</b> (número de curva del SCS, ajustada con ' + MOD.episodios + ' episodios de lluvia entre ' + MOD.desde.slice(0, 4) + ' y ' + MOD.hasta.slice(0, 4) + '):<br>' +
        '<code>S = ' + F.num(MP.S0, 0) + ' · e<sup>−P90/' + F.num(MP.beta, 1) + '</sup></code> &nbsp;·&nbsp; ' +
        '<code>Q = (P − ' + F.num(MP.lambda, 2) + '·S)² / (P + ' + F.num(1 - MP.lambda, 2) + '·S)</code> &nbsp;·&nbsp; ' +
        '<code>ΔV = ' + F.num(MP.a, 3) + ' · Q</code> hm³<br>' +
        'P: lluvia de la semana (mm) · P90: lluvia de los 90 días anteriores (mm), que mide lo húmedo que está el suelo · S: agua que el suelo es capaz de retener (mm) · Q: escorrentía (mm). ' +
        F.num(MP.a, 3) + ' hm³ por mm de escorrentía equivale a unos ' + F.num(MP.a * 1000, 0) + ' km² de cuenca aportando. ' +
        (pLlenar == null ? '' : 'Con la humedad actual del suelo harían falta unos <b>' + F.num(pLlenar, 0) + ' mm en una semana</b> para llevar el embalse a su techo. ') +
        'En los años que no se usaron para ajustarla (desde 2018) explica el ' + F.num(MOD.r2_validacion * 100, 0) + ' % de la subida del embalse en cada episodio, con un error medio de ±' + F.num(MOD.error_medio_validacion_hm3, 1) + ' hm³: sirve para estimar el orden de magnitud, no sustituye a los avisos oficiales.' +
      '</div></article></div>';
  }

  function calcularSimulador() {
    var inp = document.getElementById('sim-mm'), out = document.getElementById('sim-out');
    if (!inp || !out || !MP) return;
    var P = Math.max(0, +inp.value || 0), P90 = lluvia90() || 0;
    var dv = subida(P, P90);
    var techo = Math.min(MP.Vtecho, E.capacidad);
    var fin = E.volumen + dv;
    var bajo = Math.max(0, dv + MOD.error_p10), alto = dv + MOD.error_p90;
    var nivel, cls;
    if (fin >= techo) { nivel = 'Superaría el techo de explotación: la presa tendría que desembalsar o verter. Conviene vigilar el río Verde aguas abajo.'; cls = 'crit'; }
    else if (E.volumen + alto >= techo) { nivel = 'Podría acercarse al techo: es probable que haya desembalses preventivos.'; cls = 'warn'; }
    else { nivel = 'Sin riesgo de llenado: el embalse absorbería el agua.'; cls = 'ok'; }
    out.innerHTML =
      '<div><div class="v">+' + F.num(dv, 1) + ' hm³</div><div class="l">Subida esperada (entre ' + F.num(bajo, 1) + ' y ' + F.num(alto, 1) + ')</div></div>' +
      '<div><div class="v">' + F.num(Math.min(fin, techo), 1) + ' hm³</div><div class="l">Volumen final · ' + F.pct(Math.min(fin, techo) / E.capacidad * 100) + ' de llenado</div></div>' +
      '<div><div class="v">' + F.num(Math.max(0, fin - techo), 1) + ' hm³</div><div class="l">Agua que tendría que desembalsarse</div></div>' +
      '<div class="hidrico-sim-nivel ' + cls + '">' + nivel + '</div>';
  }

  function engancharSimulador() {
    var inp = document.getElementById('sim-mm'), rng = document.getElementById('sim-rango');
    if (!inp || !rng) return;
    inp.addEventListener('input', function () { rng.value = Math.min(400, +inp.value || 0); calcularSimulador(); });
    rng.addEventListener('input', function () { inp.value = rng.value; calcularSimulador(); });
    calcularSimulador();
  }

  /* ----------------------------------------------- Comparativa hora a hora
     El kit no tiene gráficas de dos paneles, así que se dibuja aquí con
     ECharts y los mismos tokens de tema. Cada panel tiene SU eje Y (no hay
     doble eje sobre los mismos datos) y comparten eje de tiempo, cruceta y
     zoom. Los datos horarios van en un fichero por año (data/horario/AAAA.js)
     y solo se descargan los del periodo elegido. */
  var HORA = 3600000;
  var cargados = {};
  function cargarAnio(a) {
    if (!cargados[a]) {
      cargados[a] = new Promise(function (ok) {
        if (window.HORARIO && window.HORARIO[a]) return ok();
        var s = document.createElement('script');
        s.src = 'data/horario/' + a + '.js';
        s.onload = function () { ok(); };
        s.onerror = function () { ok(); };      /* un año que falta no tumba la gráfica */
        document.head.appendChild(s);
      });
    }
    return cargados[a];
  }

  var fHora = function (ms) {
    var d = new Date(ms);
    return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' +
      ('0' + d.getUTCHours()).slice(-2) + ':00';
  };

  /* Rótulos del eje de tiempo en español, con el detalle que pida el tramo visible. */
  function rotuloTiempo(span) {
    return function (ms) {
      var d = new Date(ms), dia = d.getUTCDate(), mes = MESES[d.getUTCMonth()], an = d.getUTCFullYear();
      if (span <= 3 * 86400000) return ('0' + d.getUTCHours()).slice(-2) + ':00' + (d.getUTCHours() === 0 ? '\n' + dia + ' ' + mes : '');
      if (span <= 120 * 86400000) return dia + ' ' + mes;
      if (span <= 4 * 365 * 86400000) return mes + ' ' + String(an).slice(2);
      return String(an);
    };
  }

  var inst = null, turno = 0;
  function dibujarComparativa() {
    var card = document.querySelector('[data-card="comparativa"]');
    var nodo = card && card.querySelector('.obs-plot');
    if (!nodo || typeof echarts === 'undefined') return;
    var r = rango(), mio = ++turno;
    var anios = ((D.horario || {}).anios || []).filter(function (a) {
      return a >= r.desde.slice(0, 4) && a <= r.hasta.slice(0, 4);
    });
    if (inst) { inst.dispose(); inst = null; }
    Obs.cargando(nodo);
    Promise.all(anios.map(cargarAnio)).then(function () {
      if (mio !== turno) return;                 /* el usuario ya cambió de periodo */
      pintarComparativa(nodo, r, anios);
    });
  }

  function pintarComparativa(nodo, r, anios) {
    var T = Obs.tema();
    var t0 = aMs(r.desde), t1 = aMs(r.hasta) + 23 * HORA;
    var lluvia = [], vol = [], primeraHora = Infinity;
    anios.forEach(function (a) {
      var H = (window.HORARIO || {})[a];
      if (!H) return;
      var base = Date.UTC(+a, 0, 1);
      for (var i = 0; i < H.vol.length; i++) {
        var t = base + i * HORA;
        if (t < t0 || t > t1) continue;
        if (H.vol[i] != null) { vol.push([t, H.vol[i]]); if (t < primeraHora) primeraHora = t; }
        if (H.lluvia[i] != null) lluvia.push([t, H.lluvia[i]]);
      }
    });
    /* Antes del primer dato horario, el volumen diario de REDIAM (lectura de las 8:00). */
    var previo = [];
    diasEntre(r.desde, r.hasta).forEach(function (f) {
      var t = aMs(f) + 8 * HORA;
      if (t >= primeraHora) return;
      var v = valorEn(ED.inicio, ED.volumen || [], f);
      if (v != null) previo.push([t, v]);
    });
    vol = previo.concat(vol);

    var previa = echarts.getInstanceByDom(nodo);
    if (previa) previa.dispose();
    nodo.innerHTML = '';
    nodo.classList.remove('is-loading');
    if (!vol.length && !lluvia.length) { Obs.mensaje(nodo, 'vacio', 'Sin datos en el periodo elegido.'); return; }
    inst = echarts.init(nodo, null, { renderer: 'canvas', devicePixelRatio: 2 });

    var eje = function (i, mostrar) {
      return {
        type: 'time', gridIndex: i, min: t0, max: t1,
        axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
        axisLabel: { show: mostrar, color: T.mut, fontSize: 11, fontFamily: T.font, hideOverlap: true, margin: 10,
                     formatter: rotuloTiempo(t1 - t0) },
        splitLine: { show: false }
      };
    };
    var ejeY = function (i, nombre) {
      return {
        type: 'value', gridIndex: i, min: 0, name: nombre, splitNumber: 3,
        nameTextStyle: { color: T.mut, fontSize: 11, fontFamily: T.font, align: 'left', padding: [0, 0, 4, -40] },
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: T.mut, fontSize: 11, fontFamily: T.font, formatter: function (v) { return F.num(v, v % 1 ? 1 : 0); } },
        splitLine: { lineStyle: { color: T.grid, width: 1, type: 'solid' } }
      };
    };
    var cLl = colorLluvia();
    var muchos = vol.length > 20000;

    inst.setOption({
      animation: false,
      useUTC: true,                 /* las horas del SAIH se muestran tal cual */
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 56, right: 20, top: 30, height: '26%' },
        { left: 56, right: 20, top: '44%', bottom: 86 }
      ],
      xAxis: [eje(0, false), eje(1, true)],
      yAxis: [ejeY(0, 'Lluvia (mm/h)'), ejeY(1, 'Volumen (hm³)')],
      tooltip: {
        trigger: 'axis', confine: true, appendToBody: true,
        backgroundColor: T.surface, borderColor: T.line, borderWidth: 1, padding: [9, 12],
        textStyle: { color: T.ink, fontSize: 12.5, fontFamily: T.font },
        extraCssText: 'box-shadow:0 6px 22px rgba(15,27,45,.14);border-radius:8px;',
        axisPointer: { type: 'line', lineStyle: { color: T.axis, width: 1 }, label: { show: false } },
        formatter: function (p) {
          var arr = Array.isArray(p) ? p : [p];
          if (!arr.length) return '';
          return '<div style="font-weight:600;margin-bottom:5px">' + fHora(arr[0].value[0]) + '</div>' +
            arr.map(function (it) {
              var u = it.seriesIndex === 0 ? ' mm' : ' hm³';
              var v = it.value[1] == null ? '—' : F.num(it.value[1], it.seriesIndex === 0 ? 1 : 2) + u;
              return '<div style="display:flex;gap:10px;align-items:center;margin:2px 0">' +
                '<span style="width:9px;height:9px;border-radius:2px;background:' + it.color + ';flex:none"></span>' +
                '<span style="color:' + T.ink2 + ';flex:1 1 auto">' + it.seriesName + '</span>' +
                '<b style="font-variant-numeric:tabular-nums">' + v + '</b></div>';
            }).join('');
        }
      },
      legend: {
        show: true, bottom: 0, left: 'center', itemWidth: 11, itemHeight: 11, itemGap: 14, icon: 'roundRect',
        textStyle: { color: T.ink2, fontSize: 11.5, fontFamily: T.font }
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
        { type: 'slider', xAxisIndex: [0, 1], height: 18, bottom: 30, start: 0, end: 100,
          labelFormatter: function (v) { return fHora(v); },
          borderColor: 'transparent', backgroundColor: T.grid,
          fillerColor: 'rgba(42,120,214,.14)', handleStyle: { color: T.surface, borderColor: T.axis },
          moveHandleStyle: { color: T.axis }, textStyle: { color: T.mut, fontSize: 10, fontFamily: T.font },
          dataBackground: { lineStyle: { color: T.axis }, areaStyle: { color: T.grid } } }
      ],
      series: [
        { name: 'Lluvia por hora en la presa', type: 'bar', xAxisIndex: 0, yAxisIndex: 0, data: lluvia,
          barMaxWidth: 6, barMinWidth: 1, large: true, largeThreshold: 3000,
          itemStyle: { color: cLl } },
        { name: 'Volumen embalsado', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: vol,
          showSymbol: false, symbol: 'circle', symbolSize: 8, sampling: muchos ? 'lttb' : undefined,
          lineStyle: { width: 2, color: T.serie[0] }, itemStyle: { color: T.serie[0] },
          areaStyle: { color: T.serie[0], opacity: 0.10 } }
      ]
    }, true);
    inst.on('datazoom', function () {
      var z = inst.getOption().dataZoom[0], span = (t1 - t0) * ((z.end - z.start) / 100);
      inst.setOption({ xAxis: [{ axisLabel: { formatter: rotuloTiempo(span) } }, { axisLabel: { formatter: rotuloTiempo(span) } }] });
    });

    /* Tabla y CSV de la tarjeta: hora a hora hasta un año; en periodos más
       largos, por días (lluvia sumada, volumen de las 8:00), para no generar
       cientos de miles de filas. */
    var porHora = r.diario, x = [], sL = [], sV = [];
    var mapL = {}, mapV = {};
    lluvia.forEach(function (p) { mapL[p[0]] = p[1]; });
    vol.forEach(function (p) { mapV[p[0]] = p[1]; });
    if (porHora) {
      for (var t = t0; t <= t1; t += HORA) {
        x.push(fHora(t)); sL.push(t in mapL ? mapL[t] : null); sV.push(t in mapV ? mapV[t] : null);
      }
    } else {
      diasEntre(r.desde, r.hasta).forEach(function (f) {
        var b = aMs(f), tot = 0, n = 0;
        for (var h = 0; h < 24; h++) { var v = mapL[b + h * HORA]; if (v != null) { tot += v; n++; } }
        x.push(fDia(f)); sL.push(n ? Math.round(tot * 10) / 10 : null);
        sV.push(mapV[b + 8 * HORA] != null ? mapV[b + 8 * HORA] : null);
      });
    }
    nodo.__obsSpec = {
      type: 'line', xType: 'cat', x: x, xLabel: porHora ? 'Hora' : 'Día', yFormat: 'dec1',
      tablaFormato: function (v) { return v == null || !isFinite(v) ? '—' : F.num(v, 2); },
      series: [
        { name: porHora ? 'Lluvia en la presa (mm/h)' : 'Lluvia en la presa (mm/día)', data: sL, color: cLl },
        { name: 'Volumen embalsado (hm³)', data: sV }
      ]
    };
  }

  /* El kit solo reajusta sus propias gráficas; esta se vigila aparte. */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () { if (inst) inst.resize(); }).observe(document.body);
  }

  function redibujar() {
    Obs.refrescar(SECCION);
    dibujarComparativa();
    engancharSimulador();
  }

  /* ----------------------------------------------------------- Arranque -- */

  var GOTA = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:22px;height:22px">' +
    '<path d="M12 3.5c3.2 4 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2.8-6.5 6-10.5z"/><path d="M9 14.5a3 3 0 0 0 3 3"/></svg>';

  var selector = '<label class="obs-card-ctrl"><span>Periodo</span>' +
    '<select class="obs-select" id="hidrico-periodo">' +
    PERIODOS.map(function (p) {
      return '<option value="' + p.v + '"' + (p.v === estado.periodo ? ' selected' : '') + '>' + p.txt + '</option>';
    }).join('') + '</select></label>';

  /* ECharts mide y cachea el ancho de los rótulos la primera vez que los
     dibuja: si lo hace con la fuente de respaldo, las leyendas se montan.
     Se espera a Montserrat (como mucho 1,5 s) antes de montar nada. */
  function arrancar() {
    Obs.init({
      titulo: 'Observatorio Hídrico · Embalse de La Concepción',
      subtitulo: 'Volumen, llenado y lluvia en el río Verde (Istán, Málaga) con datos oficiales actualizados cada día',
      icono: GOTA,
      controles: selector,
      secciones: [{
        id: SECCION, nombre: 'Embalse',
        titulo: 'Embalse de La Concepción',
        desc: 'Elige el periodo arriba: de los últimos 30 días a toda la serie histórica. Hasta un año las gráficas van día a día; en periodos más largos, por meses. Dentro de cada gráfica puedes acotar aún más con la barra inferior o con la rueda del ratón.',
        render: seccion
      }],
      actualizado: (D.meta || {}).actualizado,
      fuentes: [FUENTE_REDIAM, FUENTE_PLUVIO, FUENTE_COTA],
      metodologia: 'Cada mañana un proceso automático en GitHub Actions descarga la reserva diaria del visor de embalses de REDIAM (desde 1970) y la cota y la pluviometría de la Red Hidrosur (desde 2000), y publica la serie completa. Los huecos de hasta tres días en la reserva se interpolan en línea recta. ' +
        'Cada gráfica permite ver sus datos en tabla y descargarlos en CSV.',
      pie: 'Los datos son de las fuentes citadas; su tratamiento y presentación, de este observatorio. ' +
        'Los datos en tiempo real del SAIH son provisionales y pueden corregirse después de su publicación.'
    });

    dibujarComparativa();
    engancharSimulador();
    Obs.estado('Último dato: ' + fLargo(E.fecha), 'live');
    enganchar();
  }

  function enganchar() {
    document.getElementById('hidrico-periodo').addEventListener('change', function () {
      estado.periodo = this.value;
      try { localStorage.setItem('hidrico-periodo', this.value); } catch (e) {}
      redibujar();
    });
    /* Al cambiar de tema el kit repinta sus gráficas; la comparativa y los
       colores fijados a mano (lluvia, capacidad) se recalculan aquí. */
    document.getElementById('obs-tema-btn').addEventListener('click', redibujar);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redibujar);
  }

  var fuente = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('400 12px Montserrat'), document.fonts.load('600 12px Montserrat')])
    : Promise.resolve();
  var tope = new Promise(function (ok) { setTimeout(ok, 1500); });
  var arrancado = false;
  Promise.race([fuente, tope]).then(null, function () {}).then(function () {
    if (!arrancado) { arrancado = true; arrancar(); }
  });

})();
