let rawData = [];
let filteredData = [];
let availablePollutants = [];
let incidenceChart = null;
let pollutantsChart = null;
let scatterChart = null;
let corrChart = null;
let monthlyChart = null;

function applyTranslations() {
  document.documentElement.lang = currentLang;
  document.title = t('page.title');

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    el.innerHTML = t(key);
  });

  const languageSelector = document.getElementById('languageSelector');
  if (languageSelector) languageSelector.value = currentLang;

  if (rawData.length) {
    renderPeaksTable();
    buildAllCharts();
  }
}

function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/\./g, '_')
    .replace(/-+/g, '_');
}

function toNumber(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(',', '.');
  if (s === '' || s.toUpperCase() === 'NA' || s.toUpperCase() === 'N/A' || s.toUpperCase() === 'NULL') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function safeMean(values) {
  const nums = values.filter(v => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function safeVar(values) {
  const nums = values.filter(v => v != null && Number.isFinite(v));
  if (nums.length < 2) return null;
  const mean = safeMean(nums);
  const sq = nums.reduce((a, b) => a + (b - mean) ** 2, 0);
  return sq / (nums.length - 1);
}

function safeStd(values) {
  const v = safeVar(values);
  return v != null ? Math.sqrt(v) : null;
}

function cleanLabel(name) {
  return String(name)
    .toLowerCase()
    .replace(/_/g, '.')
    .replace(/pm2\.5|pm2_5/g, 'PM2.5')
    .replace(/pm10/g, 'PM10')
    .replace(/no2/g, 'NO₂')
    .replace(/nox/g, 'NOx')
    .replace(/\bno\b/g, 'NO')
    .replace(/o3/g, 'O₃')
    .replace(/so2/g, 'SO₂')
    .replace(/co/g, 'CO')
    .replace(/h2s/g, 'H₂S')
    .replace(/c6h6/g, 'C₆H₆')
    .toUpperCase();
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  let d = String(dateStr).trim();

  let parsed = new Date(d);
  if (!isNaN(parsed)) return parsed;

  if (d.includes('/')) {
    let parts = d.split('/');
    if (parts.length === 3) {
      let day = parseInt(parts[0], 10);
      let month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        parsed = new Date(year, month, day);
        if (!isNaN(parsed)) return parsed;
      }
    }
  }

  parsed = new Date(d);
  return isNaN(parsed) ? null : parsed;
}

function showError(msg, details = '') {
  const errDiv = document.getElementById('errorStatus');
  if (errDiv) {
    errDiv.innerHTML = `${t('messages.error')} <strong>${msg}</strong>${details ? `<br><span class="text-xs text-red-300">${details}</span>` : ''}`;
    errDiv.classList.remove('hidden');
  }

  const fileStatus = document.getElementById('fileStatus');
  if (fileStatus) fileStatus.classList.add('hidden');

  const dashboard = document.getElementById('dashboard');
  if (dashboard) dashboard.classList.add('hidden');

  const columnsDiv = document.getElementById('columnsDetected');
  if (columnsDiv) columnsDiv.classList.add('hidden');

  rawData = [];
  filteredData = [];
}

function hideError() {
  const errDiv = document.getElementById('errorStatus');
  if (errDiv) errDiv.classList.add('hidden');
}

function destroyChart(chart) {
  if (chart) chart.destroy();
}

function validateRequiredColumns(row) {
  const required = ['date', 'incidencia_1000'];
  const missing = required.filter(col => !(col in row));
  if (missing.length) {
    throw new Error(`${t('messages.requiredColumnsMissing')}: ${missing.join(', ')}`);
  }
}

function normalizeRow(row) {
  const out = {};

  Object.keys(row).forEach(k => {
    const key = normalizeHeader(k);
    out[key] = row[k];
  });

  if (out['pm2.5'] !== undefined && out.pm2_5 === undefined) out.pm2_5 = out['pm2.5'];
  if (out['pm25'] !== undefined && out.pm2_5 === undefined) out.pm2_5 = out['pm25'];

  out.incidencia_1000 = toNumber(out.incidencia_1000);
  out.pm2_5 = toNumber(out.pm2_5);
  out.pm10 = toNumber(out.pm10);
  out.no2 = toNumber(out.no2);
  out.nox = toNumber(out.nox);
  out.o3 = toNumber(out.o3);
  out.so2 = toNumber(out.so2);
  out.co = toNumber(out.co);
  out.h2s = toNumber(out.h2s);
  out.no = toNumber(out.no);
  out.c6h6 = toNumber(out.c6h6);
  out.date = out.date ? String(out.date).trim() : null;

  return out;
}

function detectAvailablePollutants(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);

  return keys
    .filter(k => k !== 'date' && k !== 'incidencia_1000')
    .filter(k => rows.some(r => r[k] != null && Number.isFinite(r[k])))
    .map(k => ({ key: k, label: cleanLabel(k) }));
}

function buildScatterOptions(selectedKey, lag) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'nearest', intersect: false }
    },
    scales: {
      x: {
        title: { display: true, text: `${cleanLabel(selectedKey)} (${t('chart.dayT')})` },
        grid: { color: '#334155' }
      },
      y: {
        title: { display: true, text: `${t('chart.incidencePer1000')} (${t('chart.dayT')}+${lag})` },
        grid: { color: '#334155' }
      }
    }
  };
}

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const tval = 1 / (1 + 0.3275911 * x);
  const y = 1.0 - (((((1.061405429 * tval + -1.453152027) * tval + 1.421413741) * tval + -0.284496736) * tval + 0.254829592) * tval) * Math.exp(-x * x);
  return sign * y;
}

function normalCDF(z) {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function pearsonPValue(r, n) {
  if (n < 3 || !Number.isFinite(r) || Math.abs(r) >= 1 - 1e-12) return NaN;
  const tStat = Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * (1 - normalCDF(tStat));
}

function pearsonCorrelation(arr1, arr2) {
  const x = [];
  const y = [];

  for (let i = 0; i < Math.min(arr1.length, arr2.length); i++) {
    const a = arr1[i];
    const b = arr2[i];
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) {
      x.push(a);
      y.push(b);
    }
  }

  if (x.length < 2) return NaN;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den === 0 ? NaN : num / den;
}

function computePearsonWithP(incData, pollData, lag = 0) {
  const n = Math.min(incData.length, pollData.length);
  if (lag >= n) return { r: NaN, p: NaN, nPairs: 0 };

  const x = [];
  const y = [];

  for (let i = 0; i < n - lag; i++) {
    const pVal = pollData[i];
    const iVal = incData[i + lag];
    if (pVal != null && iVal != null && Number.isFinite(pVal) && Number.isFinite(iVal)) {
      x.push(pVal);
      y.push(iVal);
    }
  }

  const r = pearsonCorrelation(x, y);
  const p = pearsonPValue(r, x.length);
  return { r, p, nPairs: x.length };
}

function getWHOThreshold(key) {
  const thresholds = {
    'pm2_5': 15,
    'pm10': 45,
    'no2': 25,
    'o3': 100,
    'so2': 40,
    'co': 4000,
    'h2s': 7,
    'no': 25,
    'c6h6': 5
  };
  return thresholds[key] || null;
}

function computeRelativeRiskWithCI(incVals, pollVals, threshold, lag = 0) {
  let highInc = [];
  let lowInc = [];

  for (let i = 0; i < pollVals.length - lag; i++) {
    const p = pollVals[i];
    const inc = incVals[i + lag];

    if (p != null && inc != null && Number.isFinite(p) && Number.isFinite(inc)) {
      if (p > threshold) highInc.push(inc);
      else lowInc.push(inc);
    }
  }

  if (highInc.length === 0 || lowInc.length === 0) return null;

  const meanHigh = safeMean(highInc);
  const meanLow = safeMean(lowInc);
  if (meanLow === 0) return null;

  const varHigh = safeVar(highInc);
  const varLow = safeVar(lowInc);
  const nHigh = highInc.length;
  const nLow = lowInc.length;

  const rr = meanHigh / meanLow;
  const seLogRR = Math.sqrt((varHigh / nHigh) / (meanHigh ** 2) + (varLow / nLow) / (meanLow ** 2));
  const logRR = Math.log(rr);
  const z = logRR / seLogRR;
  const pValueRR = 2 * (1 - normalCDF(Math.abs(z)));
  const ciLowerRR = Math.exp(logRR - 1.96 * seLogRR);
  const ciUpperRR = Math.exp(logRR + 1.96 * seLogRR);

  const ar = meanHigh - meanLow;
  const seAR = Math.sqrt(varHigh / nHigh + varLow / nLow);
  const ciLowerAR = ar - 1.96 * seAR;
  const ciUpperAR = ar + 1.96 * seAR;
  const pValueAR = 2 * (1 - normalCDF(Math.abs(ar / seAR)));

  const arPercent = (ar / meanHigh) * 100;
  const varMeanHigh = varHigh / nHigh;
  const seArPercent = 100 * Math.sqrt((1 / meanHigh) ** 2 * (seAR ** 2) + (ar / (meanHigh ** 2)) ** 2 * varMeanHigh);
  const ciLowerARP = arPercent - 1.96 * seArPercent;
  const ciUpperARP = arPercent + 1.96 * seArPercent;

  return {
    rr, rr_ci_lower: ciLowerRR, rr_ci_upper: ciUpperRR, rr_p: pValueRR,
    ar, ar_ci_lower: ciLowerAR, ar_ci_upper: ciUpperAR, ar_p: pValueAR,
    arPercent, arPercent_ci_lower: ciLowerARP, arPercent_ci_upper: ciUpperARP, arPercent_p: pValueAR,
    meanHigh, meanLow, highDays: nHigh, lowDays: nLow
  };
}

function setDetectedColumnsUI(pollutantsFound) {
  const columnsDiv = document.getElementById('columnsDetected');
  if (!columnsDiv) return;

  if (!pollutantsFound.length) {
    columnsDiv.innerHTML = t('messages.onlyDateIncidence');
  } else {
    columnsDiv.innerHTML = `${t('messages.detected')} ` +
      pollutantsFound.map(p =>
        `<span class="inline-block px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-xs mr-1 mb-1">${p.label}</span>`
      ).join('');
  }

  columnsDiv.classList.remove('hidden');
}

function populateScatterSelector() {
  const select = document.getElementById('scatterPollutant');
  if (!select) return;

  select.innerHTML = '';

  if (!availablePollutants.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = t('messages.noPollutants');
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  availablePollutants.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.key;
    opt.textContent = p.label;
    select.appendChild(opt);
  });
}

function calculateStats() {
  const incidences = filteredData.map(r => r.incidencia_1000).filter(v => v != null && Number.isFinite(v));
  const avgInc = safeMean(incidences);

  const pollutantStats = availablePollutants.map(p => {
    const values = filteredData.map(r => r[p.key]).filter(v => v != null && Number.isFinite(v));
    const mean = safeMean(values);
    const threshold = getWHOThreshold(p.key);
    let exceedCount = 0;
    let totalValidDays = values.length;

    if (threshold !== null && totalValidDays > 0) {
      exceedCount = values.filter(v => v > threshold).length;
    }

    return mean !== null ? {
      label: p.label,
      value: mean,
      exceedCount,
      threshold,
      totalValidDays,
      hasThreshold: threshold !== null
    } : null;
  }).filter(Boolean);

  const totalDaysEl = document.getElementById('totalDays');
  if (totalDaysEl) totalDaysEl.textContent = filteredData.length;

  const avgIncEl = document.getElementById('avgIncidence');
  if (avgIncEl) avgIncEl.textContent = avgInc != null ? avgInc.toFixed(2) : '—';

  const pollutantsContainer = document.getElementById('pollutantsGrid');
  if (pollutantsContainer) {
    if (pollutantStats.length) {
      pollutantsContainer.innerHTML = pollutantStats.map(p => {
        const barWidth = p.hasThreshold ? Math.min((p.exceedCount / p.totalValidDays) * 100, 100) : 0;
        return `
          <div class="pollutant-card bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col justify-between h-full">
            <div>
              <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-x-3">
                  <div class="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-xl border border-emerald-500/20">🌫️</div>
                  <div>
                    <div class="text-xs font-semibold uppercase text-slate-400 tracking-wide">${p.label} ${t('cards.mean')}</div>
                    <div class="text-xl font-bold text-white">${p.value.toFixed(1)} <span class="text-sm font-normal text-slate-500">µg/m³</span></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="border-t border-slate-700/50 pt-4 mt-2">
              ${
                p.hasThreshold
                  ? `
                    <div class="flex justify-between items-center mb-2">
                      <span class="text-xs font-medium text-slate-400">${t('cards.whoLimit')}: <span class="text-amber-400 font-mono">${p.threshold}</span></span>
                      <span class="text-xs font-bold bg-amber-400/10 text-amber-400 px-2 py-0.5 rounded-md border border-amber-400/20">${p.exceedCount} ${t('cards.exceedances')}</span>
                    </div>
                    <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div class="bg-amber-400 h-1.5 rounded-full" style="width: ${barWidth}%"></div>
                    </div>
                    <div class="text-[11px] text-slate-500 text-right mt-1.5">${t('messages.recordedDays')} ${p.totalValidDays} ${t('messages.days')}</div>
                  `
                  : `
                    <div class="text-xs text-slate-500 italic py-2 text-center bg-slate-800/30 rounded-lg">${t('messages.noWHOdaily')}</div>
                  `
              }
            </div>
          </div>
        `;
      }).join('');
    } else {
      pollutantsContainer.innerHTML = `<div class="col-span-full text-slate-400 text-sm py-8 text-center border border-dashed border-slate-700 rounded-3xl">${t('messages.noPollutantsDetected')}</div>`;
    }
  }

  return { incidences, avgInc };
}

function getPeakColumns() {
  const all = [
    { key: 'pm2_5', label: 'PM₂.₅' },
    { key: 'pm10', label: 'PM₁₀' },
    { key: 'no2', label: 'NO₂' },
    { key: 'nox', label: 'NOx' },
    { key: 'no', label: 'NO' },
    { key: 'o3', label: 'O₃' },
    { key: 'so2', label: 'SO₂' },
    { key: 'co', label: 'CO' },
    { key: 'h2s', label: 'H₂S' },
    { key: 'c6h6', label: 'C₆H₆' }
  ];

  return all.filter(c => filteredData.some(r => r[c.key] != null && Number.isFinite(r[c.key])));
}

function renderPeaksHeader(cols) {
  const theadRow = document.querySelector('#peaksTable thead tr');
  if (!theadRow) return;

  theadRow.innerHTML = `
    <th class="px-3 sm:px-6 py-3 text-left">${t('table.date')}</th>
    <th class="px-3 sm:px-6 py-3 text-left">${t('table.incidence')}</th>
    ${cols.map(c => `<th class="px-3 sm:px-6 py-3 text-left">${c.label}</th>`).join('')}
    <th class="px-3 sm:px-6 py-3 text-left">${t('table.alert')}</th>
  `;
}

function getPeaks() {
  const vals = filteredData
    .map(r => r.incidencia_1000)
    .filter(v => v != null && Number.isFinite(v));

  if (!vals.length) return [];

  const mean = safeMean(vals);
  const std = safeStd(vals);
  if (!std || std === 0) return [];

  const threshold = mean + 2 * std;

  return filteredData
    .filter(r => r.incidencia_1000 != null && r.incidencia_1000 > threshold)
    .sort((a, b) => b.incidencia_1000 - a.incidencia_1000)
    .slice(0, 15);
}

function renderPeaksTable() {
  const tbody = document.querySelector('#peaksTable tbody');
  const peakCountEl = document.getElementById('peakCount');
  if (!tbody || !peakCountEl) return;

  tbody.innerHTML = '';
  const peaks = getPeaks();
  const cols = getPeakColumns();

  renderPeaksHeader(cols);
  peakCountEl.textContent = peaks.length;

  if (!peaks.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${2 + cols.length + 1}" class="text-center py-6 text-slate-400">
          ${t('table.noPeaks')}
        </td>
      </tr>
    `;
    return;
  }

  peaks.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800 transition-colors';

    const pollutantCells = cols.map(c => {
      const v = row[c.key];
      return `<td class="px-3 sm:px-6 py-3">${v != null ? v.toFixed(1) : '—'}</td>`;
    }).join('');

    tr.innerHTML = `
      <td class="px-3 sm:px-6 py-3 font-mono">${row.date ?? '—'}</td>
      <td class="px-3 sm:px-6 py-3 text-red-400 font-semibold">${row.incidencia_1000.toFixed(2)}</td>
      ${pollutantCells}
      <td class="px-3 sm:px-6 py-3">
        <span class="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded-full border border-red-500/20">
          ${t('table.highPeak')}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function formatPValue(p) {
  if (!Number.isFinite(p)) return '—';
  if (p < 0.0001) return '< 0.0001';
  return p.toFixed(4);
}

function updateScatter() {
  const select = document.getElementById('scatterPollutant');
  const lag = parseInt(document.getElementById('lagSelector')?.value || '0', 10);
  if (!select) return;

  let selected = select.value || (availablePollutants[0] ? availablePollutants[0].key : null);
  if (!selected || !availablePollutants.some(p => p.key === selected)) {
    selected = availablePollutants[0] ? availablePollutants[0].key : null;
  }

  if (!selected) {
    destroyChart(scatterChart);
    destroyChart(corrChart);
    const scatterInfo = document.getElementById('scatterInfo');
    if (scatterInfo) scatterInfo.innerHTML = t('messages.noPollutants');
    return;
  }

  const incVals = filteredData.map(r => r.incidencia_1000);
  const pollVals = filteredData.map(r => r[selected]);
  const points = [];

  for (let i = 0; i < filteredData.length - lag; i++) {
    const p = pollVals[i];
    const inc = incVals[i + lag];
    if (p != null && inc != null && Number.isFinite(p) && Number.isFinite(inc)) {
      points.push({ x: p, y: inc });
    }
  }

  const stats = computePearsonWithP(incVals, pollVals, lag);

  destroyChart(scatterChart);
  const scatterCanvas = document.getElementById('scatterChart');
  if (scatterCanvas) {
    scatterChart = new Chart(scatterCanvas, {
      type: 'scatter',
      data: {
        datasets: [{
          label: `${cleanLabel(selected)} (t) vs ${t('chart.incidence')} (t+${lag})`,
          data: points,
          backgroundColor: '#0ea5e9',
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: buildScatterOptions(selected, lag)
    });
  }

  let sigHtml = '';
  if (Number.isFinite(stats.p)) {
    let stars = '';
    if (stats.p < 0.001) stars = '***';
    else if (stats.p < 0.01) stars = '**';
    else if (stats.p < 0.05) stars = '*';
    if (stars) sigHtml = ` <span class="text-emerald-400 font-bold">(${stars})</span>`;
  }

  const formattedP = formatPValue(stats.p);
  const threshold = getWHOThreshold(selected);
  let rrHtml = '';

  if (threshold) {
    const risk = computeRelativeRiskWithCI(incVals, pollVals, threshold, lag);
    if (risk) {
      const rrCI = `${risk.rr.toFixed(2)} (95% CI: ${risk.rr_ci_lower.toFixed(2)}–${risk.rr_ci_upper.toFixed(2)})`;
      const rrPval = risk.rr_p < 0.001 ? '<0.001' : risk.rr_p.toFixed(4);
      const arCI = `${risk.ar.toFixed(2)} (95% CI: ${risk.ar_ci_lower.toFixed(2)}–${risk.ar_ci_upper.toFixed(2)})`;
      const arPval = risk.ar_p < 0.001 ? '<0.001' : risk.ar_p.toFixed(4);
      const arpCI = `${risk.arPercent.toFixed(1)}% (95% CI: ${risk.arPercent_ci_lower.toFixed(1)}–${risk.arPercent_ci_upper.toFixed(1)})`;
      const arpPval = risk.arPercent_p < 0.001 ? '<0.001' : risk.arPercent_p.toFixed(4);

      rrHtml = `
        <div class="mt-4 p-4 bg-slate-800/60 rounded-xl border border-slate-700 text-left text-slate-300 shadow-inner space-y-3">
          <div class="font-semibold text-white flex items-center gap-2 text-base">${t('risk.title')}</div>
          <div><span class="text-sky-400 font-semibold">${t('risk.rr')}</span> ${rrCI}, p = ${rrPval}</div>
          <div><span class="text-sky-400 font-semibold">${t('risk.ar')}</span> ${arCI} ${t('risk.casesPer1000')}, p = ${arPval}</div>
          <div><span class="text-sky-400 font-semibold">${t('risk.arp')}</span> ${arpCI}, p = ${arpPval}</div>
          <div class="flex flex-wrap gap-2 justify-between text-xs text-slate-400 bg-slate-900/50 p-2 rounded-lg">
            <span>${t('risk.highExposure')}: ${risk.meanHigh.toFixed(2)} ${t('risk.inc')} (${risk.highDays} ${t('messages.days')})</span>
            <span>${t('risk.lowExposure')}: ${risk.meanLow.toFixed(2)} ${t('risk.inc')} (${risk.lowDays} ${t('messages.days')})</span>
          </div>
          <div class="text-xs text-slate-400 italic">${t('risk.interpretation')}</div>
        </div>
      `;
    } else {
      rrHtml = `<p class="mt-4 text-xs text-slate-500">${t('messages.insufficientRiskData')}</p>`;
    }
  } else {
    rrHtml = `<p class="mt-4 text-xs text-slate-500">${t('messages.noWHOThreshold')}</p>`;
  }

  const rValue = Number.isFinite(stats.r) ? stats.r.toFixed(3) : '—';
  const scatterInfo = document.getElementById('scatterInfo');

  if (scatterInfo) {
    scatterInfo.innerHTML = `
      <div class="text-slate-200">
        <div class="text-sm mb-1 flex items-center justify-center gap-1 flex-wrap">
          ${t('chart.pearson')} (lag ${lag}): <strong>r = ${rValue}</strong>
          <span class="ml-1 text-slate-400">p = ${formattedP}</span>${sigHtml}
          <span class="info-tooltip ml-1 cursor-help">
            <span class="text-xs text-slate-400 border-b border-dotted">ⓘ</span>
            <span class="tooltip-text">${t('tooltip.significance')}</span>
          </span>
        </div>
        ${rrHtml}
      </div>
    `;
  }
}

function buildAllCharts() {
  if (!filteredData.length) return;

  const dates = filteredData.map(r => r.date);
  const incVals = filteredData.map(r => r.incidencia_1000);

  calculateStats();
  renderPeaksTable();

  destroyChart(incidenceChart);
  const incidenceCanvas = document.getElementById('incidenceTrendChart');
  if (incidenceCanvas && dates.length) {
    incidenceChart = new Chart(incidenceCanvas, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: t('chart.incidence'),
          data: incVals,
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14, 165, 233, 0.15)',
          tension: 0.2,
          borderWidth: 3,
          pointRadius: 2,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: '#334155' }, ticks: { maxTicksLimit: 10 } },
          y: { grid: { color: '#334155' } }
        }
      }
    });
  }

  const pollutantDatasets = availablePollutants.map((p, idx) => {
    const palette = ['#f59e0b', '#0ea5e9', '#ef4444', '#8b5cf6', '#10b981', '#f43f5e'];
    return {
      label: p.label,
      data: filteredData.map(r => r[p.key]),
      borderColor: palette[idx % palette.length],
      backgroundColor: palette[idx % palette.length],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.2,
      fill: false
    };
  });

  destroyChart(pollutantsChart);
  const pollutantsCanvas = document.getElementById('pollutantsTrendChart');
  if (pollutantsCanvas && pollutantDatasets.length) {
    pollutantsChart = new Chart(pollutantsCanvas, {
      type: 'line',
      data: { labels: dates, datasets: pollutantDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: {
          x: { display: false },
          y: { grid: { color: '#334155' } }
        }
      }
    });
  }

  populateScatterSelector();

  if (availablePollutants.length) {
    const scatterSelect = document.getElementById('scatterPollutant');
    if (scatterSelect) scatterSelect.value = availablePollutants[0].key;
    updateScatter();
  } else {
    const scatterInfo = document.getElementById('scatterInfo');
    if (scatterInfo) scatterInfo.textContent = t('messages.noPollutants');
  }

  const corrVals = availablePollutants.map(p => pearsonCorrelation(incVals, filteredData.map(r => r[p.key])));

  destroyChart(corrChart);
  const corrCanvas = document.getElementById('correlationBarChart');
  if (corrCanvas && availablePollutants.length) {
    corrChart = new Chart(corrCanvas, {
      type: 'bar',
      data: {
        labels: availablePollutants.map(p => p.label),
        datasets: [{
          label: t('chart.correlationLag0'),
          data: corrVals,
          backgroundColor: corrVals.map(v => !Number.isFinite(v) ? '#64748b' : (v > 0 ? '#10b981' : '#ef4444')),
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: -1, max: 1, grid: { color: '#334155' } },
          x: { grid: { color: '#334155' } }
        }
      }
    });
  }

  let maxIdx = -1;
  for (let i = 0; i < corrVals.length; i++) {
    if (Number.isFinite(corrVals[i]) && (maxIdx === -1 || Math.abs(corrVals[i]) > Math.abs(corrVals[maxIdx]))) {
      maxIdx = i;
    }
  }

  const strongest = maxIdx >= 0 ? corrVals[maxIdx] : NaN;
  const strongestCorrEl = document.getElementById('strongestCorr');
  if (strongestCorrEl) strongestCorrEl.textContent = Number.isFinite(strongest) ? strongest.toFixed(3) : '—';

  const corrPollutantEl = document.getElementById('corrPollutant');
  if (corrPollutantEl) corrPollutantEl.textContent = maxIdx >= 0 ? availablePollutants[maxIdx].label : '';

  buildMonthlyChart();
}

function buildMonthlyChart() {
  if (!filteredData.length) return;

  const monthlyInc = Array(12).fill(0);
  const monthlyCounts = Array(12).fill(0);

  filteredData.forEach(row => {
    if (row.date && row.incidencia_1000 != null && Number.isFinite(row.incidencia_1000)) {
      const dateObj = parseDate(row.date);
      if (dateObj) {
        const m = dateObj.getMonth();
        monthlyInc[m] += row.incidencia_1000;
        monthlyCounts[m]++;
      }
    }
  });

  const avgMonthly = monthlyInc.map((sum, i) => monthlyCounts[i] > 0 ? sum / monthlyCounts[i] : 0);

  destroyChart(monthlyChart);
  const monthlyCanvas = document.getElementById('monthlyTrendChart');
  if (monthlyCanvas) {
    monthlyChart = new Chart(monthlyCanvas, {
      type: 'bar',
      data: {
        labels: [
          t('months.jan'), t('months.feb'), t('months.mar'), t('months.apr'),
          t('months.may'), t('months.jun'), t('months.jul'), t('months.aug'),
          t('months.sep'), t('months.oct'), t('months.nov'), t('months.dec')
        ],
        datasets: [{
          label: t('chart.avgIncidence'),
          data: avgMonthly,
          backgroundColor: 'rgba(14, 165, 233, 0.5)',
          borderColor: '#0ea5e9',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: '#334155' } },
          x: { grid: { color: '#334155' } }
        }
      }
    });
  }
}

function refreshCharts() {
  const filter = document.getElementById('timeFilter')?.value || 'all';

  if (filter === 'all') {
    filteredData = [...rawData];
  } else {
    const [start, end] = filter.split('-');
    filteredData = rawData.filter(r => {
      const d = parseDate(r.date);
      if (!d) return false;
      const y = d.getFullYear();
      return y >= parseInt(start) && y <= parseInt(end);
    });
  }

  buildAllCharts();
}

function processCSVText(csvText, fileName) {
  document.getElementById('fileStatus')?.classList.add('hidden');
  hideError();

  Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    delimitersToGuess: [',', ';', '\t'],
    complete: function(results) {
      try {
        if (!results.data || !results.data.length) {
          throw new Error(t('messages.csvEmpty'));
        }

        const normalizedData = results.data.map(normalizeRow);
        normalizedData.forEach(validateRequiredColumns);

        const validRows = normalizedData.filter(r =>
          r.date != null &&
          r.incidencia_1000 != null &&
          Number.isFinite(r.incidencia_1000)
        );

        if (validRows.length === 0) {
          throw new Error(t('messages.noValidRows'));
        }

        rawData = validRows.sort((a, b) => {
          const da = parseDate(a.date);
          const db = parseDate(b.date);
          if (!da || !db) return 0;
          return da - db;
        });

        availablePollutants = detectAvailablePollutants(rawData);
        setDetectedColumnsUI(availablePollutants);

        const fileStatus = document.getElementById('fileStatus');
        if (fileStatus) {
          fileStatus.innerHTML = `${t('messages.successLoaded')} <strong>${fileName}</strong> (${rawData.length} ${t('messages.validDays')})`;
          fileStatus.classList.remove('hidden');
        }

        const dashboard = document.getElementById('dashboard');
        if (dashboard) dashboard.classList.remove('hidden');

        const timeFilter = document.getElementById('timeFilter');
        if (timeFilter) timeFilter.value = 'all';

        refreshCharts();
      } catch (err) {
        console.error(err);
        showError(err.message, t('messages.makeSureColumns'));
      }
    },
    error: function(err) {
      showError(t('messages.csvParseError'), err.message);
    }
  });
}

function fetchCSV(filename) {
  hideError();
  fetch(filename)
    .then(response => {
      if (!response.ok) throw new Error(`${t('messages.fileNotFound')}: ${filename}`);
      return response.text();
    })
    .then(csvText => processCSVText(csvText, filename))
    .catch(err => showError(`${t('messages.couldNotLoad')} ${filename}`, err.message));
}

function setupEventListeners() {
  const selector = document.getElementById('citySelector');
  const fileInput = document.getElementById('csvInput');
  const timeFilter = document.getElementById('timeFilter');
  const scatterPollutant = document.getElementById('scatterPollutant');
  const lagSelector = document.getElementById('lagSelector');
  const languageSelector = document.getElementById('languageSelector');

  if (selector) {
    selector.addEventListener('change', e => {
      const val = e.target.value;
      if (!val) return;
      if (val === 'custom') fileInput?.click();
      else fetchCSV(val);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;

      if (selector) selector.value = 'custom';

      const reader = new FileReader();
      reader.onload = ev => processCSVText(ev.target.result, file.name);
      reader.onerror = () => showError(t('messages.fileReadError'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  if (timeFilter) timeFilter.addEventListener('change', refreshCharts);
  if (scatterPollutant) scatterPollutant.addEventListener('change', updateScatter);
  if (lagSelector) lagSelector.addEventListener('change', updateScatter);

  if (languageSelector) {
    languageSelector.addEventListener('change', e => {
      setLanguage(e.target.value);
    });
  }
}

function initModal() {
  const modal = document.getElementById('howItWorksModal');
  const openBtn = document.getElementById('howItWorksBtn');
  const closeBtns = [
    document.getElementById('closeModalBtn'),
    document.getElementById('closeModalFooterBtn')
  ];

  if (openBtn) openBtn.onclick = () => modal?.classList.remove('hidden');
  closeBtns.forEach(btn => {
    if (btn) btn.onclick = () => modal?.classList.add('hidden');
  });

  if (modal) {
    modal.onclick = e => {
      if (e.target === modal) modal.classList.add('hidden');
    };
  }
}

window.onload = () => {
  setupEventListeners();
  initModal();
  applyTranslations();
  console.log('✅ Application ready – version C with separated files');
};




























