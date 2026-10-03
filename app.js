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

    return {
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
          titulo: 'Volumen embalsado y precipitación',
          sub: 'Lluvia en la presa (arriba) y volumen del embalse (abajo) sobre el mismo eje de tiempo',
          chips: [CHIP], fuente: FUENTE_PLUVIO, ancho: 'full', alto: 'tall',
          nota: 'Dos paneles con su propia escala, alineados en el tiempo, en lugar de dos escalas superpuestas: así se ve qué episodios de lluvia hacen subir el embalse sin falsear ninguna de las dos magnitudes. Antes de ' + (LD.inicio || '').slice(0, 4) + ' no hay registro de lluvia.'
        }
      ]
    };
  }

  /* Comparativa: el kit no tiene gráficas de dos paneles, así que se dibuja
     aquí con ECharts y los mismos tokens de tema. Cada panel tiene SU eje Y
     (no hay doble eje sobre los mismos datos) y comparten eje X, cruceta y zoom. */
  var inst = null;
  function dibujarComparativa() {
    var card = document.querySelector('[data-card="comparativa"]');
    var nodo = card && card.querySelector('.obs-plot');
    if (!nodo || typeof echarts === 'undefined') return;
    var T = Obs.tema(), r = rango();
    var ref = LD.ref || '016P01';
    var ll = serieLluvia(ref, r), vol = serieEmbalse('volumen', r);
    var x = etiquetas(vol);

    if (inst) { inst.dispose(); inst = null; }
    var previa = echarts.getInstanceByDom(nodo);
    if (previa) previa.dispose();
    nodo.innerHTML = '';
    nodo.classList.remove('is-loading');
    inst = echarts.init(nodo, null, { renderer: 'canvas', devicePixelRatio: 2 });

    var eje = function (i, mostrar) {
      return {
        type: 'category', gridIndex: i, data: x, boundaryGap: true,
        axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
        axisLabel: { show: mostrar, color: T.mut, fontSize: 11, fontFamily: T.font, hideOverlap: true, margin: 10 },
        splitLine: { show: false }
      };
    };
    var ejeY = function (i, nombre) {
      return {
        type: 'value', gridIndex: i, min: 0, name: nombre, splitNumber: 3,
        nameTextStyle: { color: T.mut, fontSize: 11, fontFamily: T.font, align: 'left', padding: [0, 0, 4, -40] },
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: T.mut, fontSize: 11, fontFamily: T.font, formatter: function (v) { return F.num(v, 0); } },
        splitLine: { lineStyle: { color: T.grid, width: 1, type: 'solid' } }
      };
    };
    var cLl = colorLluvia();

    inst.setOption({
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 56, right: 20, top: 30, height: '26%' },
        { left: 56, right: 20, top: '44%', bottom: 86 }
      ],
      xAxis: [eje(0, false), eje(1, true)],
      yAxis: [ejeY(0, 'Lluvia (mm)'), ejeY(1, 'Volumen (hm³)')],
      tooltip: {
        trigger: 'axis', confine: true, appendToBody: true,
        backgroundColor: T.surface, borderColor: T.line, borderWidth: 1, padding: [9, 12],
        textStyle: { color: T.ink, fontSize: 12.5, fontFamily: T.font },
        extraCssText: 'box-shadow:0 6px 22px rgba(15,27,45,.14);border-radius:8px;',
        axisPointer: { type: 'line', lineStyle: { color: T.axis, width: 1 }, label: { show: false } },
        formatter: function (p) {
          var arr = Array.isArray(p) ? p : [p];
          if (!arr.length) return '';
          return '<div style="font-weight:600;margin-bottom:5px">' + arr[0].axisValueLabel + '</div>' +
            arr.map(function (it) {
              var u = it.seriesIndex === 0 ? ' mm' : ' hm³';
              var v = it.value == null ? '—' : F.num(it.value, it.seriesIndex === 0 ? 1 : 2) + u;
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
          borderColor: 'transparent', backgroundColor: T.grid,
          fillerColor: 'rgba(42,120,214,.14)', handleStyle: { color: T.surface, borderColor: T.axis },
          moveHandleStyle: { color: T.axis }, textStyle: { color: T.mut, fontSize: 10, fontFamily: T.font },
          dataBackground: { lineStyle: { color: T.axis }, areaStyle: { color: T.grid } } }
      ],
      series: [
        { name: 'Lluvia ' + (ll.mensual ? 'mensual' : 'diaria') + ' en la presa', type: 'bar',
          xAxisIndex: 0, yAxisIndex: 0, data: ll.v, barMaxWidth: 24,
          itemStyle: { color: cLl, borderRadius: [3, 3, 0, 0] } },
        { name: 'Volumen embalsado', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: vol.v,
          showSymbol: false, symbol: 'circle', symbolSize: 8,
          lineStyle: { width: 2, color: T.serie[0] }, itemStyle: { color: T.serie[0] },
          areaStyle: { color: T.serie[0], opacity: 0.10 } }
      ]
    }, true);

    /* La tabla y el CSV de la tarjeta leen esta spec, igual que en las del kit. */
    nodo.__obsSpec = {
      type: 'line', xType: 'cat', x: x, xLabel: ll.mensual ? 'Mes' : 'Día', yFormat: 'dec1',
      tablaFormato: function (v) { return v == null || !isFinite(v) ? '—' : F.num(v, 1); },
      series: [
        { name: 'Lluvia en la presa (mm)', data: ll.v, color: cLl },
        { name: 'Volumen embalsado (hm³)', data: vol.v }
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
