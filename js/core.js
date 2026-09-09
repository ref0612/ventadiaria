/* ============================================================================
   core.js — motor de datos: constantes, parsing del CSV, almacenamiento local
   y TODAS las fórmulas de cálculo (comisiones, cancelaciones, depósito).
   No toca el DOM — así lo puede usar tanto ui.js (pantalla) como export.js
   (Excel) sin duplicar ni una sola fórmula.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- constantes / alias de columnas ---------------- */
  // Mismo concepto, distinto nombre de columna según la versión del reporte.
  const COLS = {
    usuario: ['Usuario'],
    sucursal: ['Nombre de Sucursal', 'Sucursal'],
    tipo: ['Tipo'],
    monto: ['Monto Neto', 'Monto'],
    pago: ['Transacciones', 'Forma de Pago', 'Medio de Pago'],
    fecha: ['Fecha Creado', 'Fecha'],
    devoluciones: ['Devoluciones']
  };
  const OPTIONAL_COLS = ['devoluciones']; // se puede calcular igual si el reporte no las trae

  const PM_KEYS = ['efectivo', 'getnet', 'tarjeta', 'transferencia', 'otros'];
  const PM_LABEL = { efectivo: 'Efectivo', getnet: 'GetNet', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otros: 'Otros' };

  const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
  const NUM = new Intl.NumberFormat('es-CL');
  const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2})?$/;

  function fmt(n) { return CLP.format(Math.round(n || 0)); }
  function fmtNum(n) { return NUM.format(n || 0); }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function emptyPM() { return { efectivo: 0, getnet: 0, tarjeta: 0, transferencia: 0, otros: 0 }; }
  function sumPM(u) { return u.efectivo + u.getnet + u.tarjeta + u.transferencia + u.otros; }

  function parseMoney(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (s === '' || s === '-') return null;
    const neg = s.startsWith('-');
    let t = s.replace(/\$/g, '').replace(/\s/g, '').replace(/-/g, '');
    t = t.replace(/\./g, '').replace(/,/g, '.');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const v = parseFloat(t);
    return isNaN(v) ? null : (neg ? -v : v);
  }

  function normPago(v) {
    v = (v || '').toLowerCase();
    if (v.includes('efectivo')) return 'efectivo';
    if (v.includes('getnet')) return 'getnet';
    if (v.includes('tarjeta')) return 'tarjeta';
    if (v.includes('transfer')) return 'transferencia';
    return 'otros';
  }

  function isGasto(tipo) { return /gasto/i.test(tipo || ''); }

  /* ---------------- parsing del CSV ---------------- */
  function buildColIndex(headerRow) {
    const norm = headerRow.map(h => clean(h).replace(/^﻿/, ''));
    const idx = {};
    for (const key in COLS) {
      idx[key] = -1;
      for (const alias of COLS[key]) {
        const i = norm.findIndex(h => h.toLowerCase() === alias.toLowerCase());
        if (i !== -1) { idx[key] = i; break; }
      }
    }
    return idx;
  }

  function missingColumns(idx) {
    return Object.keys(idx).filter(k => idx[k] === -1 && !OPTIONAL_COLS.includes(k));
  }

  // rows: array de arrays (sin la fila de cabecera). idx: resultado de buildColIndex.
  function aggregate(rows, idx) {
    const sucursales = {}; // sucursal -> usuario -> {efectivo,getnet,tarjeta,transferencia,otros,count,devolucion,canceladas}
    const tipos = {};      // sucursal -> tipo -> {monto,count}
    const daily = {};      // fecha -> sucursal -> {efectivo,...,devolucion}
    let validRows = 0;
    const dates = [];

    for (const row of rows) {
      const usuario = clean(row[idx.usuario]);
      const sucursal = clean(row[idx.sucursal]);
      const tipo = clean(row[idx.tipo]);
      const fecha = clean(row[idx.fecha]);
      const montoRaw = row[idx.monto];
      const pagoRaw = row[idx.pago];
      const devolucionRaw = idx.devoluciones >= 0 ? row[idx.devoluciones] : null;

      if (!usuario || !sucursal) continue;
      if (/[($]/.test(usuario) || /[($]/.test(sucursal)) continue; // filas de subtotal/encabezado repetidas
      const dm = DATE_RE.exec(fecha);
      if (!dm) continue;
      const monto = parseMoney(montoRaw);
      if (monto === null) continue;
      const devolucion = parseMoney(devolucionRaw) || 0; // valor no numérico (o columna ausente) = sin devolución

      validRows++;
      const dkey = `${dm[3]}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
      dates.push(dkey);

      if (!sucursales[sucursal]) sucursales[sucursal] = {};
      if (!sucursales[sucursal][usuario]) {
        sucursales[sucursal][usuario] = { efectivo: 0, getnet: 0, tarjeta: 0, transferencia: 0, otros: 0, count: 0, devolucion: 0, canceladas: 0 };
      }
      const pkey = normPago(pagoRaw);
      sucursales[sucursal][usuario][pkey] += monto;
      sucursales[sucursal][usuario].count += 1;
      if (devolucion > 0) {
        sucursales[sucursal][usuario].devolucion += devolucion;
        sucursales[sucursal][usuario].canceladas += 1;
      }

      if (!tipos[sucursal]) tipos[sucursal] = {};
      if (!tipos[sucursal][tipo]) tipos[sucursal][tipo] = { monto: 0, count: 0 };
      tipos[sucursal][tipo].monto += monto;
      tipos[sucursal][tipo].count += 1;

      if (!daily[dkey]) daily[dkey] = {};
      if (!daily[dkey][sucursal]) daily[dkey][sucursal] = { efectivo: 0, getnet: 0, tarjeta: 0, transferencia: 0, otros: 0, devolucion: 0 };
      daily[dkey][sucursal][pkey] += monto;
      if (devolucion > 0) daily[dkey][sucursal].devolucion += devolucion;
    }

    dates.sort();
    return {
      sucursales, tipos, daily,
      meta: {
        totalRowsRaw: rows.length, validRows, skipped: rows.length - validRows,
        dateMin: dates[0] || '—', dateMax: dates[dates.length - 1] || '—'
      }
    };
  }

  /* ---------------- almacenamiento local (comisiones / venta web) ---------------- */
  const KEYS = {
    comisiones: 'pasajebus_comisiones_v1',
    comisionesPago: 'pasajebus_comisiones_pago_v1',
    web: 'pasajebus_venta_web_v1'
  };
  function loadJSON(key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }
  function saveJSON(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* modo privado, etc. */ } }

  const Storage = {
    loadCommissions: () => loadJSON(KEYS.comisiones),
    saveCommissions: (m) => saveJSON(KEYS.comisiones, m),
    loadPmCommissions: () => loadJSON(KEYS.comisionesPago),
    savePmCommissions: (m) => saveJSON(KEYS.comisionesPago, m),
    loadWebFlags: () => loadJSON(KEYS.web),
    saveWebFlags: (m) => saveJSON(KEYS.web, m)
  };

  /* ============================================================================
     Calc — todas las fórmulas de negocio en un solo lugar.
     `config` = { commissions:{suc:pct}, pmCommissions:{pm:pct}, webFlags:{suc:bool} }
     ========================================================================== */
  function pctFor(config, s) { return (config.commissions || {})[s] || 0; }
  function pmPctFor(config, k) { return (config.pmCommissions || {})[k] || 0; }
  function isWeb(config, s) { return !!(config.webFlags || {})[s]; }

  function sucNames(state) {
    return Object.keys(state.sucursales).sort((a, b) => sucTotal(state, b) - sucTotal(state, a));
  }
  function sucTotal(state, s) {
    return Object.values(state.sucursales[s]).reduce((a, u) => a + sumPM(u), 0);
  }
  function sucDevolucion(state, s) {
    return Object.values(state.sucursales[s]).reduce((a, u) => a + (u.devolucion || 0), 0);
  }
  function sucCanceladas(state, s) {
    return Object.values(state.sucursales[s]).reduce((a, u) => a + (u.canceladas || 0), 0);
  }
  function sucPM(state, s) {
    const pm = emptyPM();
    Object.values(state.sucursales[s]).forEach(u => PM_KEYS.forEach(k => pm[k] += u[k]));
    return pm;
  }

  // Desglose de comisiones/depósito para una sucursal (o para un usuario individual,
  // pasando `entry` = el objeto {efectivo,...,devolucion} de ese usuario en vez de sumar todos).
  //
  // Importante: la comisión por medio de pago (GetNet/Tarjeta/etc.) es un GASTO de la
  // empresa frente al procesador/adquirente — nunca sale de la caja física de la sucursal,
  // así que NO se descuenta del efectivo a depositar. Solo la comisión de sucursal reduce
  // ese monto. La comisión por medio de pago sigue existiendo como gasto (ver comisionPago,
  // comisionTotal) pero se liquida aparte, con lo recaudado por esos medios electrónicos.
  function breakdownFor(entry, pct, config) {
    const bruto = sumPM(entry);
    const devolucion = entry.devolucion || 0;
    const ventaNeta = bruto - devolucion;
    const comisionSuc = ventaNeta * pct / 100;
    const comisionPago = PM_KEYS.reduce((a, k) => a + entry[k] * pmPctFor(config, k) / 100, 0);
    const comisionTotal = comisionSuc + comisionPago;
    const neto = ventaNeta - comisionTotal;
    const brutoADepositar = entry.efectivo; // caja física, sin descuentos
    const disponible = brutoADepositar - comisionSuc; // solo la comisión de sucursal afecta el efectivo a depositar
    return { bruto, devolucion, ventaNeta, comisionSuc, comisionPago, comisionTotal, neto, brutoADepositar, disponible };
  }

  function sucBreakdown(state, config, s) {
    const pm = sucPM(state, s);
    const count = Object.values(state.sucursales[s]).reduce((a, u) => a + u.count, 0);
    const canceladas = sucCanceladas(state, s);
    const pct = pctFor(config, s);
    const b = breakdownFor(Object.assign({ devolucion: sucDevolucion(state, s) }, pm), pct, config);
    return Object.assign({ sucursal: s, pm, count, canceladas, pct }, b);
  }

  function userBreakdown(state, config, s, u) {
    const entry = state.sucursales[s][u];
    const pct = pctFor(config, s);
    const b = breakdownFor(entry, pct, config);
    return Object.assign({ sucursal: s, usuario: u, entry, pct }, b);
  }

  // Totales generales. `grandNonWeb` excluye sucursales marcadas como Venta Web
  // (para no mezclar venta online, registrada como Efectivo, con caja física real).
  function grandBreakdown(state, config) {
    const names = sucNames(state);
    const grand = emptyPM();
    const grandNonWeb = emptyPM();
    let grandTotal = 0, grandCount = 0, grandDevolucion = 0, grandCanceladas = 0;
    let comisionSucTotal = 0, comisionSucTotalNonWeb = 0;
    let grandWeb = 0, webSucCount = 0;

    names.forEach(s => {
      const sb = sucBreakdown(state, config, s);
      grandDevolucion += sb.devolucion;
      grandCanceladas += sb.canceladas;
      comisionSucTotal += sb.comisionSuc;
      const web = isWeb(config, s);
      if (web) { grandWeb += sb.bruto; webSucCount++; }
      else comisionSucTotalNonWeb += sb.comisionSuc;
      PM_KEYS.forEach(k => {
        grand[k] += sb.pm[k];
        if (!web) grandNonWeb[k] += sb.pm[k];
      });
      grandTotal += sb.bruto;
      grandCount += sb.count;
    });

    const ventaNetaTotal = grandTotal - grandDevolucion;
    const comisionPagoTotal = PM_KEYS.reduce((a, k) => a + grand[k] * pmPctFor(config, k) / 100, 0);
    const comisionTotal = comisionSucTotal + comisionPagoTotal;
    const netoTotal = ventaNetaTotal - comisionTotal;

    // Bruto/disponible de caja: SOLO la comisión de sucursal toca el efectivo físico
    // (sin venta web). La comisión por medio de pago es un gasto de la empresa frente
    // al procesador — se liquida contra lo recaudado por esos medios, no contra la caja.
    const brutoADepositar = grandNonWeb.efectivo;
    const disponibleCaja = brutoADepositar - comisionSucTotalNonWeb;

    // Colección de medios de pago (todo lo no-efectivo, de todas las sucursales incluida
    // venta web): acá sí se aplica su comisión, para saber cuánto llega neto del procesador.
    const pmKeysNoCash = PM_KEYS.filter(k => k !== 'efectivo');
    const coleccionMediosPago = pmKeysNoCash.reduce((a, k) => a + grand[k] - grand[k] * pmPctFor(config, k) / 100, 0);
    const comisionMediosPagoNoCash = pmKeysNoCash.reduce((a, k) => a + grand[k] * pmPctFor(config, k) / 100, 0);

    // Total disponible de la empresa = caja física neta de su comisión + medios de pago netos de la suya.
    const totalDisponible = disponibleCaja + coleccionMediosPago;

    return {
      names, grand, grandNonWeb, grandTotal, grandCount, grandDevolucion, grandCanceladas,
      comisionSucTotal, comisionSucTotalNonWeb, comisionPagoTotal, comisionTotal, ventaNetaTotal, netoTotal,
      brutoADepositar, disponibleCaja, coleccionMediosPago, comisionMediosPagoNoCash, totalDisponible,
      grandWeb, webSucCount
    };
  }

  function dayKeys(state) { return Object.keys(state.daily).sort(); }

  // Desglose de un día para un conjunto de sucursales (usado por el filtro simple
  // y por la comparación multi-sucursal). `sucList` = array de nombres, o '__all__'.
  function dayDetail(state, config, dkey, sucList) {
    const day = state.daily[dkey] || {};
    const list = sucList === '__all__' ? Object.keys(day) : sucList.filter(s => day[s]);
    const pm = emptyPM();
    let devolucion = 0, comisionSuc = 0;
    list.forEach(s => {
      const dayObj = day[s];
      devolucion += dayObj.devolucion || 0;
      comisionSuc += (sumPM(dayObj) - (dayObj.devolucion || 0)) * pctFor(config, s) / 100;
      PM_KEYS.forEach(k => pm[k] += dayObj[k]);
    });
    const comisionPago = PM_KEYS.reduce((a, k) => a + pm[k] * pmPctFor(config, k) / 100, 0);
    const comisionTotal = comisionSuc + comisionPago;
    const brutoADepositar = pm.efectivo;
    // Solo la comisión de sucursal descuenta el efectivo — la de medio de pago es gasto
    // de la empresa frente al procesador, no sale de la caja.
    const disponible = brutoADepositar - comisionSuc;
    return { pm, devolucion, comisionSuc, comisionPago, comisionTotal, brutoADepositar, disponible, total: sumPM(pm) };
  }

  /* ---------------- export ---------------- */
  global.Core = {
    COLS, OPTIONAL_COLS, PM_KEYS, PM_LABEL, DATE_RE,
    fmt, fmtNum, clean, esc, emptyPM, sumPM, parseMoney, normPago, isGasto,
    buildColIndex, missingColumns, aggregate,
    Storage,
    Calc: {
      pctFor, pmPctFor, isWeb, sucNames, sucTotal, sucDevolucion, sucCanceladas, sucPM,
      sucBreakdown, userBreakdown, grandBreakdown, dayKeys, dayDetail
    }
  };
})(window);
