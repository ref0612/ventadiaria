/* ============================================================================
   charts.js — gráfico de barras SVG para la evolución diaria.
   Sin librerías externas: dibuja barras simples o apiladas por sucursal
   cuando hay más de una seleccionada, para comparar aporte + total combinado.
   ========================================================================== */
(function (global) {
  'use strict';
  const { fmt, sumPM } = Core;

  // Paleta cualitativa para distinguir sucursales en el gráfico apilado.
  const STACK_COLORS = ['#c96a2e', '#2f7d8f', '#6a5fc1', '#a3812f', '#3d7a9e', '#2f8f5f', '#c1443a', '#7a8591'];
  function colorFor(i) { return STACK_COLORS[i % STACK_COLORS.length]; }

  /**
   * @param {string} hostId  id del contenedor donde inyectar el <svg>
   * @param {string[]} dayKeys  fechas ordenadas (YYYY-MM-DD)
   * @param {function} seriesFn  (dkey) => number[]  monto por serie ese día (1 valor si no hay comparación)
   * @param {string[]} seriesNames  nombres de cada serie, para el título de la barra
   */
  function drawDailyChart(hostId, dayKeys, seriesFn, seriesNames) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const n = seriesNames.length;
    const rows = dayKeys.map(d => seriesFn(d));
    const totals = rows.map(r => r.reduce((a, b) => a + b, 0));
    const max = Math.max(...totals, 1);

    const W = 1080, H = n > 1 ? 260 : 240, padL = 64, padB = 26, padT = 10, padR = 10;
    const legendH = n > 1 ? 24 : 0;
    const plotH = H - padT - padB - legendH;
    const plotW = W - padL - padR;
    const bw = plotW / dayKeys.length;
    const ticks = 4;

    let svg = `<svg viewBox="0 0 ${W} ${H + legendH}" style="width:100%;height:auto;" role="img" aria-label="Recaudación diaria">`;

    if (n > 1) {
      let lx = padL;
      svg += seriesNames.map((name, i) => {
        const w = 14, gap = 8, textW = Math.min(name.length * 6.2 + 20, 220);
        const item = `<rect x="${lx}" y="4" width="${w}" height="${w}" rx="3" fill="${colorFor(i)}"/><text x="${lx + w + 6}" y="${w - 2}" font-size="11">${Core.esc(name)}</text>`;
        lx += w + 6 + textW + gap;
        return item;
      }).join('');
    }

    const topY = padT + legendH;
    for (let i = 0; i <= ticks; i++) {
      const y = topY + plotH - (i / ticks) * plotH;
      const v = max * (i / ticks);
      svg += `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
      svg += `<text x="${padL - 8}" y="${y + 4}" font-size="10" text-anchor="end">${v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : Math.round(v / 1000) + 'K'}</text>`;
    }

    dayKeys.forEach((d, di) => {
      const x = padL + di * bw + bw * 0.12;
      const w = bw * 0.76;
      let yCursor = topY + plotH;
      rows[di].forEach((v, si) => {
        const h = (v / max) * plotH;
        yCursor -= h;
        if (h > 0) {
          svg += `<rect x="${x.toFixed(1)}" y="${yCursor.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${n > 1 ? 1 : 2}" fill="${n > 1 ? colorFor(si) : 'var(--accent)'}"><title>${d} · ${Core.esc(seriesNames[si])}: ${fmt(v)}</title></rect>`;
        }
      });
      const showLabel = dayKeys.length <= 15 || di % Math.ceil(dayKeys.length / 12) === 0;
      if (showLabel) {
        svg += `<text x="${(x + w * 0.5).toFixed(1)}" y="${H + legendH - 8}" font-size="9.5" text-anchor="middle">${d.slice(8)}/${d.slice(5, 7)}</text>`;
      }
    });

    svg += `<line class="axisline" x1="${padL}" x2="${W - padR}" y1="${topY + plotH}" y2="${topY + plotH}"/>`;
    svg += `</svg>`;
    host.innerHTML = svg;
  }

  global.Charts = { drawDailyChart, colorFor };
})(window);
