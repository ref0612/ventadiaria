/* ============================================================================
   ui.js — todo lo que toca el DOM: paso de comisiones, resumen por sucursal,
   detalle diario (con selección múltiple de sucursales) y la carga del CSV.
   Toda la matemática vive en core.js — acá solo se formatea y se dibuja.
   ========================================================================== */
(function () {
  'use strict';
  const { PM_KEYS, PM_LABEL, fmt, fmtNum, esc, clean, emptyPM, sumPM, isGasto } = Core;
  const Calc = Core.Calc;
  const Storage = Core.Storage;

  let STATE = null;
  let CONFIG = { commissions: {}, pmCommissions: {}, webFlags: {} };
  let selectedDiario = null; // array de sucursales seleccionadas en "Detalle diario"

  /* ================= paso 1: comisiones ================= */
  function readWebFlagsFromForm() {
    const map = {};
    document.querySelectorAll('.comm-web-input').forEach(inp => { map[inp.dataset.suc] = inp.checked; });
    return map;
  }

  function showCommissionStep(state) {
    STATE = state;
    const app = document.getElementById('app');
    const saved = Storage.loadCommissions();
    const savedPm = Storage.loadPmCommissions();
    const savedWeb = Storage.loadWebFlags();
    const names = Calc.sucNames(state);

    const grandPM = emptyPM();
    names.forEach(s => Object.values(state.sucursales[s]).forEach(u => PM_KEYS.forEach(k => grandPM[k] += u[k])));

    let html = `<div class="comm-columns">
      <div class="comm-card">
        <h2>Comisión por sucursal</h2>
        <p class="lede">% a descontar del bruto de cada sucursal, sobre el total recaudado. Marca "Venta web" en las sucursales cuyas ventas online quedan registradas como Efectivo (ej. Konnect), para verlas aparte y no confundirlas con caja física.</p>
        <div class="comm-head-row comm-head-row--suc"><span>Sucursal</span><span>Bruto del periodo</span><span>Comisión</span><span>Venta web</span></div>`;
    names.forEach(s => {
      const pct = saved[s] != null ? saved[s] : 0;
      const web = !!savedWeb[s];
      html += `<div class="comm-row comm-row--suc">
        <span class="cname">${esc(s)}</span>
        <span class="cbruto">${fmt(Calc.sucTotal(state, s))}</span>
        <span class="comm-pct"><input type="number" min="0" max="100" step="0.01" value="${pct}" data-suc="${esc(s)}" class="comm-input" aria-label="Comisión % para ${esc(s)}"><span>%</span></span>
        <span class="comm-web"><input type="checkbox" ${web ? 'checked' : ''} data-suc="${esc(s)}" class="comm-web-input" aria-label="Venta web para ${esc(s)}"></span>
      </div>`;
    });
    html += `</div>
      <div class="comm-card">
        <h2>Comisión por medio de pago</h2>
        <p class="lede">% que cobra el procesador/adquirente por Getnet, Tarjeta, etc. — es un gasto de la empresa que se liquida contra lo recaudado por esos medios electrónicos. Es independiente de la comisión de sucursal y <b>nunca descuenta el efectivo a depositar</b> (el efectivo no tiene comisión de procesador).</p>
        <div class="comm-head-row"><span>Medio de pago</span><span>Bruto del periodo</span><span>Comisión</span></div>`;
    PM_KEYS.filter(k => k !== 'efectivo').forEach(k => {
      const pct = savedPm[k] != null ? savedPm[k] : 0;
      html += `<div class="comm-row">
        <span class="cname"><span class="pm-dot" style="background:var(--p-${k})"></span>${PM_LABEL[k]}</span>
        <span class="cbruto">${fmt(grandPM[k])}</span>
        <span class="comm-pct"><input type="number" min="0" max="100" step="0.01" value="${pct}" data-pm="${k}" class="comm-pm-input" aria-label="Comisión % para ${PM_LABEL[k]}"><span>%</span></span>
      </div>`;
    });
    html += `</div>
    </div>
    <div class="comm-actions">
        <button class="btn" id="btnGenerar" type="button">Generar reporte →</button>
        <button class="btn secondary" id="btnSinComision" type="button">Sin comisión (0% para todas)</button>
    </div>`;
    app.innerHTML = html;
    document.getElementById('dropzone').hidden = true;

    document.getElementById('btnGenerar').addEventListener('click', () => {
      const map = {};
      document.querySelectorAll('.comm-input').forEach(inp => {
        const v = parseFloat(inp.value);
        map[inp.dataset.suc] = isNaN(v) ? 0 : Math.min(Math.max(v, 0), 100);
      });
      const pmMap = {};
      document.querySelectorAll('.comm-pm-input').forEach(inp => {
        const v = parseFloat(inp.value);
        pmMap[inp.dataset.pm] = isNaN(v) ? 0 : Math.min(Math.max(v, 0), 100);
      });
      const webMap = readWebFlagsFromForm();
      Storage.saveCommissions(map); Storage.savePmCommissions(pmMap); Storage.saveWebFlags(webMap);
      renderReport(state, { commissions: map, pmCommissions: pmMap, webFlags: webMap });
    });
    document.getElementById('btnSinComision').addEventListener('click', () => {
      const map = {}; names.forEach(s => map[s] = 0);
      const pmMap = {}; PM_KEYS.forEach(k => pmMap[k] = 0);
      const webMap = readWebFlagsFromForm();
      Storage.saveWebFlags(webMap);
      renderReport(state, { commissions: map, pmCommissions: pmMap, webFlags: webMap });
    });

    document.getElementById('subhead').textContent =
      `${state.meta.fileName || 'Informe cargado'} · ${fmtNum(state.meta.validRows)} filas válidas — definiendo comisiones…`;
  }

  /* ================= reporte principal ================= */
  function renderReport(state, config) {
    STATE = state; CONFIG = config;
    selectedDiario = Calc.sucNames(state).slice(); // por defecto: todas seleccionadas
    const app = document.getElementById('app');
    const g = Calc.grandBreakdown(state, config);

    app.innerHTML = `
      ${kpiHeroHTML(state, g)}
      ${statStripHTML(state, g)}
      <div class="tabs" role="tablist">
        <div class="tab-list">
          <button class="tab-btn active" id="tabBtnResumen" type="button" role="tab" aria-selected="true">Por sucursal</button>
          <button class="tab-btn" id="tabBtnDiario" type="button" role="tab" aria-selected="false">Detalle diario</button>
        </div>
        <button class="btn secondary" id="btnExportResumen" type="button">⬇ Descargar Excel</button>
      </div>
      <div id="panelResumen" class="tab-panel"></div>
      <div id="panelDiario" class="tab-panel" hidden></div>
    `;

    renderResumenPanel(document.getElementById('panelResumen'), state, config);
    renderDiarioPanel(document.getElementById('panelDiario'), state, config);

    document.getElementById('btnEditComm').addEventListener('click', () => showCommissionStep(state));
    document.getElementById('btnExportResumen').addEventListener('click', () => ExcelExport.downloadResumen(state, config));

    const tabResumen = document.getElementById('tabBtnResumen');
    const tabDiario = document.getElementById('tabBtnDiario');
    const panelResumen = document.getElementById('panelResumen');
    const panelDiario = document.getElementById('panelDiario');
    const exportBtn = document.getElementById('btnExportResumen');
    tabResumen.addEventListener('click', () => {
      tabResumen.classList.add('active'); tabResumen.setAttribute('aria-selected', 'true');
      tabDiario.classList.remove('active'); tabDiario.setAttribute('aria-selected', 'false');
      panelResumen.hidden = false; panelDiario.hidden = true;
      exportBtn.onclick = () => ExcelExport.downloadResumen(state, config);
    });
    tabDiario.addEventListener('click', () => {
      tabDiario.classList.add('active'); tabDiario.setAttribute('aria-selected', 'true');
      tabResumen.classList.remove('active'); tabResumen.setAttribute('aria-selected', 'false');
      panelDiario.hidden = false; panelResumen.hidden = true;
      exportBtn.onclick = () => ExcelExport.downloadDiario(state, config, selectedDiario);
    });

    document.getElementById('subhead').textContent =
      `${state.meta.fileName || 'Informe cargado'} · ${fmtNum(state.meta.validRows)} filas válidas` +
      (state.meta.skipped ? ` · ${fmtNum(state.meta.skipped)} filas de subtotal/encabezado descartadas` : '');

    const warn = document.getElementById('warnBanner');
    if (state.meta.skipped > 0) {
      warn.hidden = false;
      warn.textContent = `Se ignoraron ${fmtNum(state.meta.skipped)} filas del CSV que no correspondían a movimientos válidos (subtotales, encabezados repetidos o filas sin fecha/monto).`;
    } else {
      warn.hidden = true;
    }
  }

  function kpiHeroHTML(state, g) {
    return `<div class="kpi-hero">
      <div class="kpi-card deposito">
        <div class="label">Bruto a depositar</div>
        <div class="val">${fmt(g.brutoADepositar)}</div>
        <div class="meta">Efectivo físico de caja (sin venta web). Disponible de caja tras su comisión de sucursal: <b>${fmt(g.disponibleCaja)}</b>.</div>
      </div>
      <div class="kpi-card comision">
        <div class="label">Comisión total aplicada</div>
        <div class="val">${fmt(g.comisionTotal)}</div>
        <div class="meta">${g.comisionTotal > 0 ? `Sucursal ${fmt(g.comisionSucTotal)} (descuenta la caja) + medio de pago ${fmt(g.comisionPagoTotal)} (gasto de la empresa frente al procesador, no toca el efectivo).` : 'Sin comisión configurada.'} <button class="btn-edit-comm" id="btnEditComm" type="button">editar comisiones</button></div>
      </div>
      <div class="kpi-card disponible">
        <div class="label">Total disponible</div>
        <div class="val">${fmt(g.totalDisponible)}</div>
        <div class="meta">Caja neta de su comisión (${fmt(g.disponibleCaja)}) + medios de pago recaudados netos de la suya (${fmt(g.coleccionMediosPago)}).</div>
      </div>
    </div>`;
  }

  function statStripHTML(state, g) {
    const pmMeta = PM_KEYS.map(k => ({ key: k, label: PM_LABEL[k], val: g.grandNonWeb[k] }));
    let html = `<div class="summary-grid">
      <div class="tile"><div class="label">Total recaudado (bruto)</div>
        <div class="val">${fmt(g.grandTotal)}</div>
        <div class="meta">${fmtNum(g.grandCount)} transacciones · ${state.meta.dateMin} a ${state.meta.dateMax}</div>
        <div class="pm-bar">${pmMeta.map(p => `<span style="flex:${Math.max(p.val, 1)};background:var(--p-${p.key})"></span>`).join('')}</div>
      </div>`;
    pmMeta.forEach(p => {
      const pct = g.grandTotal ? (p.val / g.grandTotal * 100) : 0;
      const commPct = Calc.pmPctFor(CONFIG, p.key);
      html += `<div class="tile"><div class="label"><span class="pm-dot" style="background:var(--p-${p.key})"></span>${p.label}</div>
        <div class="val">${fmt(p.val)}</div><div class="meta">${pct.toFixed(1)}% del total${commPct ? ` · comisión ${commPct}%` : ''}</div></div>`;
    });
    if (g.webSucCount > 0) {
      const webPct = g.grandTotal ? (g.grandWeb / g.grandTotal * 100) : 0;
      html += `<div class="tile web-tile"><div class="label"><span class="pm-dot" style="background:var(--web)"></span>Venta Web</div>
        <div class="val">${fmt(g.grandWeb)}</div><div class="meta">${webPct.toFixed(1)}% del total · ${g.webSucCount} sucursal${g.webSucCount !== 1 ? 'es' : ''} · no cuenta en Efectivo ni los demás medios</div></div>`;
    }
    html += `<div class="tile bad-tile"><div class="label">Boletos cancelados</div>
      <div class="val">${fmt(g.grandDevolucion)}</div>
      <div class="meta">${g.grandCanceladas > 0 ? fmtNum(g.grandCanceladas) + ' boleto' + (g.grandCanceladas !== 1 ? 's' : '') + ' con devolución' : 'Sin cancelaciones'}</div></div>
    <div class="tile"><div class="label">Colección medios de pago</div>
      <div class="val">${fmt(g.coleccionMediosPago)}</div>
      <div class="meta">GetNet + Tarjeta + Transferencia + Otros, netos de su comisión (${fmt(g.comisionMediosPagoNoCash)})</div></div>
    <div class="tile"><div class="label">Neto a rendir (todas)</div>
      <div class="val">${fmt(g.netoTotal)}</div>
      <div class="meta">Ventas − cancelados − comisiones, incluye venta web</div></div>
    </div>`;
    return html;
  }

  /* ================= panel: por sucursal ================= */
  function pmHeadCell(k) { return `${PM_LABEL[k]}${Calc.pmPctFor(CONFIG, k) ? `<small>com. ${Calc.pmPctFor(CONFIG, k)}%</small>` : ''}`; }

  function renderResumenPanel(container, state, config) {
    const names = Calc.sucNames(state);
    let html = `<div class="section"><div class="section-head"><h2>Por sucursal</h2><span class="note">Click para ver el detalle por usuario</span></div>`;

    names.forEach((s, i) => {
      const sb = Calc.sucBreakdown(state, config, s);
      const uNames = Object.keys(state.sucursales[s]).sort((a, b) => sumPM(state.sucursales[s][b]) - sumPM(state.sucursales[s][a]));
      const web = Calc.isWeb(config, s);
      const hasDeduccion = sb.devolucion > 0 || sb.comisionSuc > 0;

      html += `<details class="suc-card" ${i < 2 ? 'open' : ''}>
        <summary>
          <span class="chev"></span>
          <span class="name">${esc(s)}${web ? ' <span class="pill web">Venta Web</span>' : ''}<small>${uNames.length} usuario${uNames.length !== 1 ? 's' : ''} · ${fmtNum(sb.count)} transacciones${sb.canceladas ? ' · ' + fmtNum(sb.canceladas) + ' cancelada' + (sb.canceladas !== 1 ? 's' : '') : ''}${sb.pct ? ' · comisión sucursal ' + sb.pct + '%' : ''}</small></span>
          <span class="mini-bar">${PM_KEYS.map(k => `<span style="flex:${Math.max(sb.pm[k], 1)};background:var(--p-${k})"></span>`).join('')}</span>
          <span class="suc-total">${fmt(hasDeduccion ? sb.disponible : sb.bruto)}${hasDeduccion ? `<small>bruto ${fmt(sb.bruto)}</small>` : ''}</span>
        </summary>
        <div class="suc-body"><div class="table-scroll"><table>
          <thead><tr><th>Usuario</th><th>${pmHeadCell('efectivo')}</th><th>${pmHeadCell('getnet')}</th><th>${pmHeadCell('tarjeta')}</th><th>${pmHeadCell('transferencia')}</th><th>${pmHeadCell('otros')}</th><th>Total bruto</th><th>Transacciones</th><th>Cancelados</th><th>Com. sucursal${sb.pct ? ` (${sb.pct}%)` : ''}</th><th>Com. medio de pago<small>gasto empresa</small></th><th>Disponible</th></tr></thead>
          <tbody>`;
      uNames.forEach(u => {
        const ub = Calc.userBreakdown(state, config, s, u);
        const v = ub.entry;
        html += `<tr><td class="usr-name">${esc(u)}</td>
          <td class="num">${v.efectivo ? fmt(v.efectivo) : '—'}</td>
          <td class="num">${v.getnet ? fmt(v.getnet) : '—'}</td>
          <td class="num">${v.tarjeta ? fmt(v.tarjeta) : '—'}</td>
          <td class="num">${v.transferencia ? fmt(v.transferencia) : '—'}</td>
          <td class="num">${v.otros ? fmt(v.otros) : '—'}</td>
          <td class="num">${fmt(ub.bruto)}</td>
          <td class="num">${fmtNum(v.count)}</td>
          <td class="num" style="${v.canceladas ? 'color:var(--bad)' : ''}">${v.canceladas ? `−${fmt(v.devolucion)} (${v.canceladas})` : '—'}</td>
          <td class="num" style="${ub.comisionSuc ? 'color:var(--bad)' : ''}">${ub.comisionSuc ? `−${fmt(ub.comisionSuc)}` : '—'}</td>
          <td class="num" style="${ub.comisionPago ? 'color:var(--bad)' : ''}">${ub.comisionPago ? `−${fmt(ub.comisionPago)}` : '—'}</td>
          <td class="num"><b>${fmt(ub.disponible)}</b></td></tr>`;
      });
      html += `<tr class="totalrow"><td>Total sucursal (bruto)</td>
        <td class="num">${fmt(sb.pm.efectivo)}</td><td class="num">${fmt(sb.pm.getnet)}</td>
        <td class="num">${fmt(sb.pm.tarjeta)}</td><td class="num">${fmt(sb.pm.transferencia)}</td>
        <td class="num">${fmt(sb.pm.otros)}</td><td class="num">${fmt(sb.bruto)}</td>
        <td class="num">${fmtNum(sb.count)}</td>
        <td class="num">${sb.canceladas ? `−${fmt(sb.devolucion)}` : '—'}</td>
        <td class="num">${sb.comisionSuc ? `−${fmt(sb.comisionSuc)}` : '—'}</td>
        <td class="num">${sb.comisionPago ? `−${fmt(sb.comisionPago)}` : '—'}</td>
        <td class="num"><b>${fmt(sb.disponible)}</b></td></tr>`;
      if (sb.devolucion > 0) html += `<tr class="comisionrow"><td colspan="11">Boletos cancelados (${fmtNum(sb.canceladas)})</td><td class="num">−${fmt(sb.devolucion)}</td></tr>`;
      html += `<tr class="netorow"><td colspan="11">Bruto a depositar (solo Efectivo)</td><td class="num">${fmt(sb.brutoADepositar)}</td></tr>`;
      if (sb.comisionSuc > 0) html += `<tr class="comisionrow"><td colspan="11">Comisión sucursal (${sb.pct}% sobre venta neta de cancelaciones) — sí descuenta el efectivo</td><td class="num">−${fmt(sb.comisionSuc)}</td></tr>`;
      html += `<tr class="netorow disponible"><td colspan="11">Disponible de esta sucursal (efectivo − comisión sucursal)</td><td class="num">${fmt(sb.disponible)}</td></tr>`;
      if (sb.comisionPago > 0) html += `<tr class="comisionrow"><td colspan="11">Comisión por medio de pago — gasto de la empresa frente al procesador, NO descuenta este efectivo</td><td class="num">−${fmt(sb.comisionPago)}</td></tr>`;
      html += `<tr class="netorow"><td colspan="11">Neto a rendir (venta neta − ambas comisiones, referencia contable)</td><td class="num">${fmt(sb.neto)}</td></tr>`;
      html += `</tbody></table></div></div></details>`;
    });
    html += `</div>`;

    html += `<div class="section"><div class="section-head"><h2>Ingresos y gastos por tipo</h2><span class="note">Según la columna "Tipo" de cada movimiento</span></div><div class="tipo-grid">`;
    names.forEach(s => {
      const t = state.tipos[s] || {};
      const tNames = Object.keys(t).sort((a, b) => t[b].monto - t[a].monto);
      let ingreso = 0, gasto = 0;
      tNames.forEach(tn => { if (isGasto(tn)) gasto += t[tn].monto; else ingreso += t[tn].monto; });
      html += `<div class="tipo-card"><h3>${esc(s)}</h3>`;
      tNames.forEach(tn => {
        const gastoTn = isGasto(tn);
        html += `<div class="tipo-row"><span><span class="pill ${gastoTn ? 'bad' : 'good'}">${gastoTn ? 'Gasto' : 'Ingreso'}</span> ${esc(tn)}</span><span class="amt" style="color:${gastoTn ? 'var(--bad)' : 'var(--ink)'}">${fmt(t[tn].monto)}</span></div>`;
      });
      if (gasto > 0) html += `<div class="tipo-row" style="border-top:1px solid var(--line);margin-top:4px;padding-top:8px;"><span><b>Neto</b></span><span class="amt"><b>${fmt(ingreso - gasto)}</b></span></div>`;
      html += `</div>`;
    });
    html += `</div></div>`;

    container.innerHTML = html;
  }

  /* ================= panel: detalle diario ================= */
  function dailyTableHTML(state, config, sucList, dayKeys, idPrefix) {
    let rowsHtml = '';
    const grand = emptyPM();
    let gComSuc = 0, gComPago = 0, gBruto = 0, gDisp = 0, gTotal = 0;
    dayKeys.forEach(d => {
      const dd = Calc.dayDetail(state, config, d, sucList);
      PM_KEYS.forEach(k => grand[k] += dd.pm[k]);
      gComSuc += dd.comisionSuc; gComPago += dd.comisionPago; gBruto += dd.brutoADepositar; gDisp += dd.disponible; gTotal += dd.total;
      const [y, mo, da] = d.split('-');
      rowsHtml += `<tr><td>${da}/${mo}/${y}</td>
        <td class="num">${dd.pm.efectivo ? fmt(dd.pm.efectivo) : '—'}</td>
        <td class="num">${dd.pm.getnet ? fmt(dd.pm.getnet) : '—'}</td>
        <td class="num">${dd.pm.tarjeta ? fmt(dd.pm.tarjeta) : '—'}</td>
        <td class="num">${dd.pm.transferencia ? fmt(dd.pm.transferencia) : '—'}</td>
        <td class="num">${dd.pm.otros ? fmt(dd.pm.otros) : '—'}</td>
        <td class="num">${fmt(dd.total)}</td>
        <td class="num" style="${dd.comisionSuc ? 'color:var(--bad)' : ''}">${dd.comisionSuc ? `−${fmt(dd.comisionSuc)}` : '—'}</td>
        <td class="num" style="${dd.comisionPago ? 'color:var(--bad)' : ''}">${dd.comisionPago ? `−${fmt(dd.comisionPago)}` : '—'}</td>
        <td class="num"><b>${fmt(dd.disponible)}</b></td></tr>`;
    });
    rowsHtml += `<tr class="totalrow"><td>Total periodo</td>
      <td class="num">${fmt(grand.efectivo)}</td><td class="num">${fmt(grand.getnet)}</td>
      <td class="num">${fmt(grand.tarjeta)}</td><td class="num">${fmt(grand.transferencia)}</td>
      <td class="num">${fmt(grand.otros)}</td><td class="num">${fmt(gTotal)}</td>
      <td class="num">${gComSuc ? `−${fmt(gComSuc)}` : '—'}</td>
      <td class="num">${gComPago ? `−${fmt(gComPago)}` : '—'}</td>
      <td class="num"><b>${fmt(gDisp)}</b></td></tr>`;
    return `<div class="table-scroll"><table>
      <thead><tr><th>Fecha</th><th>Efectivo</th><th>GetNet</th><th>Tarjeta</th><th>Transferencia</th><th>Otros</th><th>Total</th><th>Com. sucursal</th><th>Com. medio de pago<small>gasto empresa</small></th><th>Disponible (Efectivo − com. sucursal)</th></tr></thead>
      <tbody id="${idPrefix}">${rowsHtml}</tbody>
    </table></div>`;
  }

  function renderDiarioPanel(container, state, config) {
    const names = Calc.sucNames(state);
    const dayKeys = Calc.dayKeys(state);

    let html = `<div class="suc-picker">
      <div class="picker-head">
        <h2>Sucursales a comparar</h2>
        <div class="picker-actions">
          <button type="button" id="btnPickAll">Seleccionar todas</button>
          <button type="button" id="btnPickNone">Ninguna</button>
        </div>
      </div>
      <p class="note" style="margin:0 0 12px;color:var(--ink-faint);font-size:12.5px;">Útil cuando un mismo terminal está dividido en varios puntos de venta lógicos: selecciona dos o más para ver el detalle de cada uno y el total combinado.</p>
      <div class="chip-grid">
        ${names.map((s, i) => `<label class="chip checked" data-suc="${esc(s)}">
          <input type="checkbox" checked class="suc-chip-input" data-suc="${esc(s)}">
          <span class="swatch" style="background:${Charts.colorFor(i)}"></span>
          ${esc(s)} <span class="cnt">${fmtNum(Calc.sucTotal(state, s))}</span>
        </label>`).join('')}
      </div>
    </div>

    <div class="section"><div class="section-head"><h2>Evolución diaria</h2><span class="note">Cada color es una sucursal seleccionada; la altura combinada es el total del día</span></div>
      <div class="chart-card"><div id="chartHost"></div></div>
    </div>

    <div id="diarioSections"></div>`;

    container.innerHTML = html;

    function redraw() {
      const sel = names.filter((s, i) => document.querySelector(`.suc-chip-input[data-suc="${CSS.escape(s)}"]`)?.checked);
      selectedDiario = sel;
      document.querySelectorAll('.chip').forEach(chip => {
        const s = chip.dataset.suc;
        chip.classList.toggle('checked', sel.includes(s));
      });

      Charts.drawDailyChart('chartHost', dayKeys, (d) => sel.map(s => sumPM(state.daily[d]?.[s] || emptyPM())), sel);

      const sectionsEl = document.getElementById('diarioSections');
      if (sel.length === 0) {
        sectionsEl.innerHTML = `<p style="color:var(--ink-faint);">Selecciona al menos una sucursal para ver el detalle diario.</p>`;
        return;
      }
      let sHtml = '';
      if (sel.length > 1) {
        sHtml += `<div class="combo-card"><div>
          <h2>Total combinado — ${sel.length} sucursales</h2>
          <p class="note">Suma día a día de: ${sel.map(esc).join(', ')}</p>
          ${dailyTableHTML(state, config, sel, dayKeys, 'combinadoBody')}
        </div></div>`;
      }
      sHtml += `<div class="section-head" style="margin-top:4px;"><h2 style="font-size:18px;">Detalle por sucursal</h2></div>`;
      sel.slice().sort((a, b) => Calc.sucTotal(state, b) - Calc.sucTotal(state, a)).forEach((s, i) => {
        sHtml += `<details class="suc-card" ${i === 0 ? 'open' : ''}>
          <summary><span class="chev"></span><span class="name">${esc(s)}</span></summary>
          <div class="suc-body">${dailyTableHTML(state, config, [s], dayKeys, 'body_' + i)}</div>
        </details>`;
      });
      sectionsEl.innerHTML = sHtml;
    }

    document.querySelectorAll('.suc-chip-input').forEach(inp => inp.addEventListener('change', redraw));
    document.getElementById('btnPickAll').addEventListener('click', () => {
      document.querySelectorAll('.suc-chip-input').forEach(inp => inp.checked = true);
      redraw();
    });
    document.getElementById('btnPickNone').addEventListener('click', () => {
      document.querySelectorAll('.suc-chip-input').forEach(inp => inp.checked = false);
      redraw();
    });

    redraw();
  }

  /* ================= carga de archivo ================= */
  function processCSVText(text, fileName) {
    const parsed = Papa.parse(text, { skipEmptyLines: false });
    const rows = parsed.data;
    if (!rows.length) { alert('El archivo está vacío.'); return; }
    const header = rows[0];
    const idx = Core.buildColIndex(header);
    const missing = Core.missingColumns(idx);
    if (missing.length) {
      alert('No se encontraron estas columnas esperadas en la cabecera: ' + missing.join(', ') + '\n\nRevisa que el CSV tenga las mismas columnas que el "Branch Collection Report".');
      return;
    }
    const dataRows = rows.slice(1).filter(r => r.length > 1);
    const agg = Core.aggregate(dataRows, idx);
    agg.meta.fileName = fileName;
    showCommissionStep(agg);
    document.getElementById('dropzone').hidden = true;
    document.getElementById('fileMeta').textContent = fileName;
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const buf = e.target.result;
      const bytes = new Uint8Array(buf);
      const hasBOM = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
      let text;
      try {
        text = new TextDecoder(hasBOM ? 'utf-8' : 'utf-8', { fatal: true }).decode(buf);
      } catch (err) {
        text = new TextDecoder('windows-1252').decode(buf);
      }
      processCSVText(text, file.name);
    };
    reader.readAsArrayBuffer(file);
  }

  function boot() {
    const fileInput = document.getElementById('fileInput');
    const btnUpload = document.getElementById('btnUpload');
    const dropzone = document.getElementById('dropzone');
    btnUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });

    document.addEventListener('dragover', e => { e.preventDefault(); dropzone.hidden = false; dropzone.classList.add('drag'); });
    document.addEventListener('dragleave', e => { if (e.target === dropzone) dropzone.classList.remove('drag'); });
    document.addEventListener('drop', e => {
      e.preventDefault(); dropzone.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    dropzone.hidden = false; // estado inicial: vacío, esperando un archivo real
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
