/* ============================================================================
   export.js — exporta el resumen y el detalle diario a un libro de Excel
   (.xlsx) usando SheetJS. Reutiliza únicamente fórmulas de Core.Calc: nunca
   recalcula nada por su cuenta, así el Excel siempre cuadra con la pantalla.
   ========================================================================== */
(function (global) {
  'use strict';
  const { PM_KEYS, PM_LABEL, fmtNum } = Core;
  const { sucNames, sucBreakdown, userBreakdown, grandBreakdown, dayKeys, dayDetail, isWeb, pctFor } = Core.Calc;

  function round(n) { return Math.round((n || 0) * 100) / 100; }
  function todayStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }
  function sheetSafeName(name) {
    return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja';
  }

  function autoWidths(rows) {
    const widths = [];
    rows.forEach(r => r.forEach((cell, i) => {
      const len = cell == null ? 0 : String(cell).length;
      widths[i] = Math.max(widths[i] || 8, Math.min(len + 2, 42));
    }));
    return widths.map(w => ({ wch: w }));
  }

  function sheetFromRows(rows) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = autoWidths(rows);
    return ws;
  }

  const PM_HEADERS = PM_KEYS.map(k => PM_LABEL[k]);

  /* ---------------- libro: Resumen por sucursal ---------------- */
  function buildResumenWorkbook(state, config) {
    const wb = XLSX.utils.book_new();
    const names = sucNames(state);
    const g = grandBreakdown(state, config);

    // Hoja 1: resumen general (los KPI que ve el operador arriba de la pantalla)
    const rGeneral = [
      ['Recaudación — Resumen general', state.meta.fileName || ''],
      ['Periodo', `${state.meta.dateMin} a ${state.meta.dateMax}`],
      ['Filas válidas', state.meta.validRows],
      [],
      ['Total recaudado (bruto, todas las sucursales)', round(g.grandTotal)],
      ...PM_HEADERS.map((label, i) => [label + ' (sin venta web)', round(g.grandNonWeb[PM_KEYS[i]])]),
      ['Venta Web', round(g.grandWeb)],
      ['Boletos cancelados (monto)', round(g.grandDevolucion)],
      ['Boletos cancelados (cantidad)', g.grandCanceladas],
      ['Comisión sucursal (total, descuenta el efectivo)', round(g.comisionSucTotal)],
      ['Comisión medio de pago (total, gasto de la empresa, NO descuenta el efectivo)', round(g.comisionPagoTotal)],
      ['Comisión total aplicada', round(g.comisionTotal)],
      ['Total neto a rendir (referencia contable)', round(g.netoTotal)],
      [],
      ['Bruto a depositar (efectivo físico, sin venta web)', round(g.brutoADepositar)],
      ['Disponible de caja (bruto a depositar − comisión sucursal)', round(g.disponibleCaja)],
      ['Colección medios de pago (GetNet+Tarjeta+Transferencia+Otros, neto de su comisión)', round(g.coleccionMediosPago)],
      ['Total disponible (caja neta + medios de pago netos)', round(g.totalDisponible)]
    ];
    XLSX.utils.book_append_sheet(wb, sheetFromRows(rGeneral), 'Resumen general');

    // Hoja 2: detalle por sucursal y usuario
    const header = ['Sucursal', 'Venta Web', 'Usuario', ...PM_HEADERS, 'Total bruto', 'Transacciones',
      'Boletos cancelados', 'Monto cancelado', 'Com. sucursal (%)', 'Com. sucursal ($, descuenta efectivo)', 'Com. medio de pago ($, gasto empresa, no descuenta efectivo)',
      'Bruto a depositar (Efectivo)', 'Disponible (Efectivo − com. sucursal)'];
    const rows = [header];
    names.forEach(s => {
      const sb = sucBreakdown(state, config, s);
      const web = isWeb(config, s) ? 'Sí' : '';
      Object.keys(state.sucursales[s]).sort((a, b) => Core.sumPM(state.sucursales[s][b]) - Core.sumPM(state.sucursales[s][a])).forEach(u => {
        const ub = userBreakdown(state, config, s, u);
        rows.push([
          s, web, u,
          ...PM_KEYS.map(k => round(ub.entry[k])),
          round(ub.bruto), ub.entry.count,
          ub.entry.canceladas || 0, round(ub.devolucion),
          sb.pct, round(ub.comisionSuc), round(ub.comisionPago),
          round(ub.brutoADepositar), round(ub.disponible)
        ]);
      });
      rows.push([
        `${s} — TOTAL`, web, '',
        ...PM_KEYS.map(k => round(sb.pm[k])),
        round(sb.bruto), sb.count,
        sb.canceladas, round(sb.devolucion),
        sb.pct, round(sb.comisionSuc), round(sb.comisionPago),
        round(sb.brutoADepositar), round(sb.disponible)
      ]);
    });
    XLSX.utils.book_append_sheet(wb, sheetFromRows(rows), 'Por sucursal');

    // Hoja 3: ingresos y gastos por tipo
    const rTipo = [['Sucursal', 'Tipo', 'Clasificación', 'Monto', 'Transacciones']];
    names.forEach(s => {
      const t = state.tipos[s] || {};
      Object.keys(t).forEach(tn => {
        rTipo.push([s, tn, Core.isGasto(tn) ? 'Gasto' : 'Ingreso', round(t[tn].monto), t[tn].count]);
      });
    });
    XLSX.utils.book_append_sheet(wb, sheetFromRows(rTipo), 'Ingresos y gastos');

    return wb;
  }

  function downloadResumen(state, config) {
    const wb = buildResumenWorkbook(state, config);
    XLSX.writeFile(wb, `Recaudacion_Resumen_${todayStamp()}.xlsx`);
  }

  /* ---------------- libro: Detalle diario ---------------- */
  function dailyRowsFor(state, config, sucList, days) {
    const header = ['Fecha', ...PM_HEADERS, 'Total', 'Com. sucursal', 'Com. medio de pago', 'Bruto a depositar', 'Disponible'];
    const rows = [header];
    const totals = Core.emptyPM();
    let tComSuc = 0, tComPago = 0, tBruto = 0, tDisp = 0, tTotal = 0;
    days.forEach(d => {
      const dd = dayDetail(state, config, d, sucList);
      PM_KEYS.forEach(k => totals[k] += dd.pm[k]);
      tComSuc += dd.comisionSuc; tComPago += dd.comisionPago; tBruto += dd.brutoADepositar; tDisp += dd.disponible; tTotal += dd.total;
      const [y, mo, da] = d.split('-');
      rows.push([`${da}/${mo}/${y}`, ...PM_KEYS.map(k => round(dd.pm[k])), round(dd.total),
        round(dd.comisionSuc), round(dd.comisionPago), round(dd.brutoADepositar), round(dd.disponible)]);
    });
    rows.push(['TOTAL PERIODO', ...PM_KEYS.map(k => round(totals[k])), round(tTotal), round(tComSuc), round(tComPago), round(tBruto), round(tDisp)]);
    return rows;
  }

  function buildDiarioWorkbook(state, config, selectedSucursales) {
    const wb = XLSX.utils.book_new();
    const days = dayKeys(state);
    const list = (selectedSucursales && selectedSucursales.length) ? selectedSucursales : sucNames(state);

    XLSX.utils.book_append_sheet(wb, sheetFromRows(dailyRowsFor(state, config, list, days)), 'Combinado');
    list.forEach(s => {
      XLSX.utils.book_append_sheet(wb, sheetFromRows(dailyRowsFor(state, config, [s], days)), sheetSafeName(s));
    });
    return wb;
  }

  function downloadDiario(state, config, selectedSucursales) {
    const wb = buildDiarioWorkbook(state, config, selectedSucursales);
    XLSX.writeFile(wb, `Recaudacion_Diario_${todayStamp()}.xlsx`);
  }

  global.ExcelExport = { downloadResumen, downloadDiario };
})(window);
