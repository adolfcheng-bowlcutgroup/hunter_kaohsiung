const DATA_MANIFEST_PATH = 'data/manifest.json';

const state = {
  rows: [],
  files: [],
  selectedProductKey: '',
  dataSource: 'none'
};

const columnMap = {
  productCode: ['產品代號', '商品代號', 'SKU', 'sku'],
  product: ['產品', '商品', '產品名稱', '商品名稱'],
  unit: ['單位名稱', '單位'],
  currency: ['幣別', '幣別名稱'],
  quantity: ['數量', '銷售數量'],
  unitPrice: ['本幣單價', '單價', '外幣單價'],
  untaxedAmount: ['本幣未稅金額', '外幣未稅金額', '未稅金額'],
  taxedAmount: ['本幣含稅金額', '含稅金額']
};

const el = id => document.getElementById(id);
const fmtInt = n => Number(n || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const fmtMoney = n => Number(n || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const cleanNumber = value => Number(String(value ?? '').replace(/,/g, '').trim()) || 0;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const getProductKey = product => `${product.productCode || ''}||${product.product || ''}`;
const average = values => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some(v => String(v).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some(v => String(v).trim() !== '')) rows.push(row);
  }
  return rows;
}

function findHeader(headers, keys) {
  return keys.find(k => headers.includes(k));
}

function inferDateFromFilename(filename, year) {
  const match = filename.match(/(?:^|[^0-9])([01][0-9])([0-3][0-9])(?:[^0-9]|$)/);
  if (!match) return '';
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeManifestFiles(manifest) {
  const year = Number(manifest.year || el('yearInput').value) || new Date().getFullYear();
  const rawFiles = Array.isArray(manifest) ? manifest : (manifest.files || []);
  return rawFiles.map(item => {
    const entry = typeof item === 'string' ? { path: item } : item;
    const path = entry.path || entry.file || entry.name || '';
    if (!path) return null;
    const filename = path.split('/').pop();
    const date = entry.date || inferDateFromFilename(filename, year);
    if (!date) {
      console.warn(`data manifest 檔案缺少日期且無法從檔名判斷：${path}`);
      return null;
    }
    const url = /^https?:\/\//i.test(path) || path.startsWith('data/') ? path : `data/${path}`;
    return { name: filename, path, url, date };
  }).filter(Boolean);
}

function setDataStatus(message, type = 'info') {
  const box = el('dataStatus');
  if (!box) return;
  box.className = `data-status ${type}`;
  box.innerHTML = message;
}

async function fetchTextNoCache(url) {
  const joiner = url.includes('?') ? '&' : '?';
  const cacheBustUrl = `${url}${joiner}v=${Date.now()}`;
  const response = await fetch(cacheBustUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function loadDataFolder() {
  setDataStatus('正在讀取 <code>data/manifest.json</code> ...', 'loading');
  try {
    const manifestText = await fetchTextNoCache(DATA_MANIFEST_PATH);
    const manifest = JSON.parse(manifestText);
    const files = normalizeManifestFiles(manifest);
    if (!files.length) {
      state.rows = [];
      state.files = [];
      state.selectedProductKey = '';
      state.dataSource = 'data';
      renderAll();
      setDataStatus('已讀取 manifest，但沒有可用檔案。請檢查 <code>data/manifest.json</code> 的 files 清單。', 'warning');
      return;
    }

    const loadedRows = [];
    const loadedFiles = [];
    const failedFiles = [];

    for (const file of files) {
      try {
        const text = await fetchTextNoCache(file.url);
        const parsed = parseCSV(text);
        const rows = normalizeFileRows(parsed, file.name, file.date);
        loadedRows.push(...rows);
        loadedFiles.push({ name: file.name, date: file.date, rows: rows.length, source: 'data' });
      } catch (error) {
        console.error(`讀取 data 檔案失敗：${file.path}`, error);
        failedFiles.push(file.path);
      }
    }

    state.rows = loadedRows;
    state.files = loadedFiles;
    state.selectedProductKey = '';
    state.dataSource = 'data';
    sortRows();
    renderAll();

    const dates = getDates();
    const range = dates.length ? (dates.length === 1 ? dates[0] : `${dates[0]} ～ ${dates[dates.length - 1]}`) : '-';
    const failNote = failedFiles.length ? `；${failedFiles.length} 個檔案讀取失敗，請查看 Console 或檔名路徑` : '';
    setDataStatus(`已從 <code>data</code> 載入 <strong>${fmtInt(loadedFiles.length)}</strong> 個檔案、<strong>${fmtInt(loadedRows.length)}</strong> 筆資料；日期範圍：<strong>${escapeHtml(range)}</strong>${failNote}。`, failedFiles.length ? 'warning' : 'success');
  } catch (error) {
    console.warn('無法自動讀取 data/manifest.json', error);
    setDataStatus('尚未讀取到 <code>data/manifest.json</code>。若你是直接用本機檔案開啟，瀏覽器可能會擋 fetch；部署到 GitHub Pages 後即可自動讀取。也可以先手動上傳 CSV。', 'warning');
  }
}

function normalizeFileRows(parsed, filename, date) {
  if (!parsed.length) return [];
  const headers = parsed[0].map(h => String(h).trim());
  const idx = {};
  Object.entries(columnMap).forEach(([key, aliases]) => {
    const header = findHeader(headers, aliases);
    idx[key] = header ? headers.indexOf(header) : -1;
  });

  return parsed.slice(1).map((r, index) => {
    const productCode = r[idx.productCode] || '';
    const product = r[idx.product] || '';
    if (!productCode && !product) return null;
    return {
      date,
      sourceFile: filename,
      rowNo: index + 2,
      productCode: String(productCode).trim(),
      product: String(product).trim(),
      unit: String(r[idx.unit] || '').trim(),
      currency: String(r[idx.currency] || '').trim(),
      quantity: cleanNumber(r[idx.quantity]),
      unitPrice: cleanNumber(r[idx.unitPrice]),
      untaxedAmount: cleanNumber(r[idx.untaxedAmount]),
      taxedAmount: cleanNumber(r[idx.taxedAmount])
    };
  }).filter(Boolean);
}

async function handleFiles(files) {
  const year = Number(el('yearInput').value) || new Date().getFullYear();
  const replaceSameDate = el('replaceSameDate').checked;
  const added = [];

  for (const file of files) {
    const text = await file.text();
    const date = inferDateFromFilename(file.name, year) || prompt(`無法從檔名判斷日期，請輸入 ${file.name} 的日期：YYYY-MM-DD`);
    if (!date) continue;
    if (replaceSameDate) {
      state.rows = state.rows.filter(r => r.date !== date);
      state.files = state.files.filter(f => f.date !== date);
    }
    const parsed = parseCSV(text);
    const rows = normalizeFileRows(parsed, file.name, date);
    state.rows.push(...rows);
    added.push({ name: file.name, date, rows: rows.length });
  }

  state.files.push(...added.map(f => ({...f, source: 'manual'})));
  state.dataSource = state.dataSource === 'data' ? 'data+manual' : 'manual';
  sortRows();
  renderAll();
  const addedRows = added.reduce((sum, f) => sum + f.rows, 0);
  setDataStatus(`已手動補傳 <strong>${fmtInt(added.length)}</strong> 個檔案、<strong>${fmtInt(addedRows)}</strong> 筆資料。`, 'success');
}

function sortRows() {
  state.rows.sort((a, b) => a.date.localeCompare(b.date) || a.productCode.localeCompare(b.productCode));
  state.files.sort((a, b) => a.date.localeCompare(b.date));
}

function getDates() {
  return [...new Set(state.rows.map(r => r.date))].sort();
}

function aggregateDaily() {
  const map = new Map();
  state.rows.forEach(r => {
    if (!map.has(r.date)) map.set(r.date, { date: r.date, products: new Set(), quantity: 0, amount: 0, untaxed: 0 });
    const item = map.get(r.date);
    item.products.add(r.productCode || r.product);
    item.quantity += r.quantity;
    item.amount += r.taxedAmount;
    item.untaxed += r.untaxedAmount;
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({...d, productCount: d.products.size}));
}

function aggregateProducts() {
  const dates = getDates();
  const map = new Map();
  state.rows.forEach(r => {
    const key = `${r.productCode}||${r.product}`;
    if (!map.has(key)) {
      map.set(key, { productCode: r.productCode, product: r.product, totalQty: 0, totalAmount: 0, byDate: {} });
    }
    const item = map.get(key);
    if (!item.byDate[r.date]) item.byDate[r.date] = { quantity: 0, amount: 0 };
    item.byDate[r.date].quantity += r.quantity;
    item.byDate[r.date].amount += r.taxedAmount;
    item.totalQty += r.quantity;
    item.totalAmount += r.taxedAmount;
  });
  return [...map.values()].sort((a, b) => b.totalAmount - a.totalAmount || b.totalQty - a.totalQty).map(item => ({...item, dates}));
}

function setEmpty(tableId) {
  el(tableId).innerHTML = el('emptyTableTemplate').innerHTML;
}

function renderDashboard() {
  if (!state.rows.length) {
    ['kpiRevenue','kpiQty','kpiProducts','kpiAvgRevenue'].forEach(id => el(id).textContent = '0');
    el('kpiBestDate').textContent = '-';
    el('kpiTopProduct').textContent = '-';
    el('comparisonBox').textContent = '尚無足夠資料可比較昨日差異。';
    return;
  }
  const daily = aggregateDaily();
  const products = aggregateProducts();
  const totalRevenue = daily.reduce((sum, d) => sum + d.amount, 0);
  const totalQty = daily.reduce((sum, d) => sum + d.quantity, 0);
  const bestDay = [...daily].sort((a, b) => b.amount - a.amount)[0];
  const topProduct = products[0];

  el('kpiRevenue').textContent = fmtMoney(totalRevenue);
  el('kpiQty').textContent = fmtInt(totalQty);
  el('kpiProducts').textContent = fmtInt(products.length);
  el('kpiAvgRevenue').textContent = fmtMoney(totalRevenue / daily.length);
  el('kpiBestDate').textContent = bestDay?.date || '-';
  el('kpiTopProduct').textContent = topProduct ? `${topProduct.product}｜${fmtMoney(topProduct.totalAmount)}` : '-';

  if (daily.length >= 2) {
    const latest = daily[daily.length - 1];
    const prev = daily[daily.length - 2];
    const diff = latest.amount - prev.amount;
    const pct = prev.amount ? diff / prev.amount * 100 : 0;
    const sign = diff >= 0 ? '+' : '';
    el('comparisonBox').innerHTML = `最新日 <strong>${latest.date}</strong> 含稅銷售額 <strong>${fmtMoney(latest.amount)}</strong>，較前一日 <strong>${prev.date}</strong> ${sign}${fmtMoney(diff)}，變動 <strong>${sign}${pct.toFixed(1)}%</strong>。`;
  } else {
    el('comparisonBox').textContent = '尚無足夠資料可比較昨日差異。';
  }
}

function renderFileList() {
  const box = el('fileList');
  if (!state.files.length) {
    box.className = 'file-list empty';
    box.textContent = '尚未載入資料';
    return;
  }

  const dates = [...new Set(state.files.map(f => f.date))].sort();
  const totalRows = state.files.reduce((sum, f) => sum + (Number(f.rows) || 0), 0);
  const dateRange = dates.length === 1 ? dates[0] : `${dates[0]} ～ ${dates[dates.length - 1]}`;

  box.className = 'file-list';
  box.innerHTML = `
    <div class="file-summary">
      <span class="summary-pill">已載入 ${fmtInt(state.files.length)} 個檔案</span>
      <span><strong>${fmtInt(totalRows)}</strong> 筆資料</span>
      <span>日期範圍：<strong>${escapeHtml(dateRange)}</strong></span>
      <span>來源：<strong>${escapeHtml(state.dataSource === 'data' ? 'data 資料夾' : state.dataSource === 'data+manual' ? 'data 資料夾 + 手動補傳' : '手動補傳')}</strong></span>
    </div>`;
}

function renderDailyTable() {
  const daily = aggregateDaily();
  if (!daily.length) return setEmpty('dailyTable');
  el('dailyTable').innerHTML = `
    <thead><tr><th>日期</th><th class="num">銷售品項數</th><th class="num">銷售總數量</th><th class="num">未稅金額</th><th class="num">含稅銷售額</th></tr></thead>
    <tbody>${daily.map(d => `<tr><td>${d.date}</td><td class="num">${fmtInt(d.productCount)}</td><td class="num">${fmtInt(d.quantity)}</td><td class="num">${fmtMoney(d.untaxed)}</td><td class="num">${fmtMoney(d.amount)}</td></tr>`).join('')}</tbody>`;
}

function getMetricValue(product, date, metric) {
  const row = product.byDate[date] || { quantity: 0, amount: 0 };
  return metric === 'quantity' ? row.quantity : row.amount;
}

function sortProductsForTrend(products, dates, metric, sortMode) {
  const latestDate = dates[dates.length - 1];
  const prevDate = dates[dates.length - 2];

  const metricTotal = p => metric === 'quantity' ? p.totalQty : p.totalAmount;
  const latestValue = p => latestDate ? getMetricValue(p, latestDate, metric) : 0;
  const prevValue = p => prevDate ? getMetricValue(p, prevDate, metric) : 0;
  const diffValue = p => latestValue(p) - prevValue(p);
  const codeValue = p => `${p.productCode || ''} ${p.product || ''}`;

  const tieBreak = (a, b) => b.totalAmount - a.totalAmount || b.totalQty - a.totalQty || codeValue(a).localeCompare(codeValue(b), 'zh-Hant');

  return [...products].sort((a, b) => {
    switch (sortMode) {
      case 'totalQtyDesc':
        return b.totalQty - a.totalQty || b.totalAmount - a.totalAmount || codeValue(a).localeCompare(codeValue(b), 'zh-Hant');
      case 'latestMetricDesc':
        return latestValue(b) - latestValue(a) || tieBreak(a, b);
      case 'latestMetricAsc':
        return latestValue(a) - latestValue(b) || tieBreak(a, b);
      case 'diffMetricDesc':
        return diffValue(b) - diffValue(a) || tieBreak(a, b);
      case 'diffMetricAsc':
        return diffValue(a) - diffValue(b) || tieBreak(a, b);
      case 'productCodeAsc':
        return codeValue(a).localeCompare(codeValue(b), 'zh-Hant') || tieBreak(a, b);
      case 'totalAmountDesc':
      default:
        return b.totalAmount - a.totalAmount || b.totalQty - a.totalQty || codeValue(a).localeCompare(codeValue(b), 'zh-Hant');
    }
  });
}

function getSortNote(sortMode, metric, dates) {
  const metricName = metric === 'quantity' ? '數量' : '含稅金額';
  const latestDate = dates[dates.length - 1] || '最新日';
  const prevDate = dates[dates.length - 2] || '前一日';
  const notes = {
    totalAmountDesc: '依整段期間累計含稅金額由高到低排序。',
    totalQtyDesc: '依整段期間累計數量由高到低排序。',
    latestMetricDesc: `依 ${latestDate} 的${metricName}由高到低排序。`,
    latestMetricAsc: `依 ${latestDate} 的${metricName}由低到高排序。`,
    diffMetricDesc: `依 ${latestDate} 相較 ${prevDate} 的${metricName}增加幅度由高到低排序。`,
    diffMetricAsc: `依 ${latestDate} 相較 ${prevDate} 的${metricName}減少幅度由高到低排序。`,
    productCodeAsc: '依產品代號與產品名稱由 A 到 Z 排序。'
  };
  return notes[sortMode] || notes.totalAmountDesc;
}

function renderTrendTable() {
  const allProducts = aggregateProducts();
  const dates = getDates();
  if (!allProducts.length) return setEmpty('trendTable');
  const keyword = el('searchInput').value.trim().toLowerCase();
  const metric = el('metricSelect').value;
  const sortMode = el('sortSelect').value;
  const topN = Number(el('topNInput').value) || 10;
  const filtered = allProducts.filter(p => !keyword || `${p.productCode} ${p.product}`.toLowerCase().includes(keyword));
  const products = sortProductsForTrend(filtered, dates, metric, sortMode).slice(0, keyword ? 500 : topN);
  const dateHeaders = dates.map(d => `<th class="num">${d}</th>`).join('');
  const totalHeader = metric === 'quantity' ? '累計數量' : '累計含稅金額';
  const sortNote = getSortNote(sortMode, metric, dates);
  el('trendTable').innerHTML = `
    <caption>${escapeHtml(sortNote)}${keyword ? '｜搜尋結果最多顯示 500 筆' : `｜目前顯示 Top ${topN}`}｜點擊商品可查看單一商品趨勢</caption>
    <thead><tr><th>產品代號</th><th>產品</th>${dateHeaders}<th class="num">${totalHeader}</th></tr></thead>
    <tbody>${products.map(p => {
      const key = getProductKey(p);
      const selectedClass = key === state.selectedProductKey ? ' class="selected-row"' : '';
      const cells = dates.map(d => `<td class="num">${metric === 'quantity' ? fmtInt(p.byDate[d]?.quantity || 0) : fmtMoney(p.byDate[d]?.amount || 0)}</td>`).join('');
      const total = metric === 'quantity' ? p.totalQty : p.totalAmount;
      return `<tr${selectedClass} data-product-key="${escapeHtml(key)}"><td>${escapeHtml(p.productCode)}</td><td>${escapeHtml(p.product)}</td>${cells}<td class="num"><strong>${metric === 'quantity' ? fmtInt(total) : fmtMoney(total)}</strong></td></tr>`;
    }).join('')}</tbody>`;
}


function buildProductLineChart(points, metric) {
  const width = Math.max(760, points.length * 78);
  const height = 300;
  const margin = { top: 28, right: 36, bottom: 56, left: 76 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const values = points.map(p => metric === 'quantity' ? p.quantity : p.amount);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = Math.max(maxValue - minValue, 1);
  const yMax = maxValue + range * 0.12;
  const yMin = Math.min(0, minValue);
  const yRange = Math.max(yMax - yMin, 1);
  const x = i => margin.left + (points.length === 1 ? innerW / 2 : i * innerW / (points.length - 1));
  const y = value => margin.top + innerH - ((value - yMin) / yRange * innerH);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(metric === 'quantity' ? p.quantity : p.amount).toFixed(2)}`).join(' ');
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
    const gy = margin.top + innerH * ratio;
    const value = yMax - yRange * ratio;
    return `<line class="chart-grid" x1="${margin.left}" y1="${gy}" x2="${width - margin.right}" y2="${gy}"/><text class="chart-label" x="${margin.left - 10}" y="${gy + 4}" text-anchor="end">${metric === 'quantity' ? fmtInt(value) : fmtMoney(value)}</text>`;
  }).join('');
  const dots = points.map((p, i) => {
    const value = metric === 'quantity' ? p.quantity : p.amount;
    const label = metric === 'quantity' ? fmtInt(value) : fmtMoney(value);
    return `<circle class="chart-dot" cx="${x(i)}" cy="${y(value)}" r="4"><title>${p.date}：${label}</title></circle><text class="chart-value-label" x="${x(i)}" y="${y(value) - 10}" text-anchor="middle">${label}</text><text class="chart-date-label" x="${x(i)}" y="${height - 20}" text-anchor="middle">${p.date.slice(5)}</text>`;
  }).join('');

  return `<svg class="product-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="單一商品銷售曲線圖">
    ${gridLines}
    <line class="chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"/>
    <line class="chart-axis" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}"/>
    <path class="chart-line" d="${path}"/>
    ${dots}
  </svg>`;
}

function renderProductAnalysis() {
  const box = el('productAnalysis');
  const products = aggregateProducts();
  const dates = getDates();
  const product = products.find(p => getProductKey(p) === state.selectedProductKey);

  if (!state.rows.length) {
    box.className = 'product-analysis empty-analysis';
    box.textContent = '尚無資料，請先上傳 CSV。';
    return;
  }

  if (!product) {
    box.className = 'product-analysis empty-analysis';
    box.textContent = '請先在「商品日銷售趨勢」點擊一個商品。';
    return;
  }

  const metric = el('metricSelect').value;
  const points = dates.map(date => ({
    date,
    quantity: product.byDate[date]?.quantity || 0,
    amount: product.byDate[date]?.amount || 0
  }));
  const qtyValues = points.map(p => p.quantity);
  const amountValues = points.map(p => p.amount);
  const metricLabel = metric === 'quantity' ? '每日銷售數量' : '每日含稅銷售金額';

  box.className = 'product-analysis';
  box.innerHTML = `
    <div class="analysis-head">
      <div>
        <h3>${escapeHtml(product.product || '未命名商品')}</h3>
        <p>產品代號：${escapeHtml(product.productCode || '-')}｜分析區間：${escapeHtml(dates[0])} ～ ${escapeHtml(dates[dates.length - 1])}</p>
      </div>
      <div class="analysis-badge">曲線指標：${metricLabel}</div>
    </div>
    <div class="analysis-kpis">
      <div class="analysis-card"><span>平均每日銷售數量</span><strong>${fmtInt(average(qtyValues))}</strong></div>
      <div class="analysis-card"><span>平均每日銷售金額</span><strong>${fmtMoney(average(amountValues))}</strong></div>
      <div class="analysis-card"><span>中位數銷售數量</span><strong>${fmtInt(median(qtyValues))}</strong></div>
      <div class="analysis-card"><span>中位數銷售金額</span><strong>${fmtMoney(median(amountValues))}</strong></div>
    </div>
    <div class="chart-box">
      <p class="chart-title">${metricLabel}曲線圖</p>
      ${buildProductLineChart(points, metric)}
    </div>
    <div class="analysis-detail-table">
      <div class="table-wrap">
        <table>
          <thead><tr><th>日期</th><th class="num">銷售數量</th><th class="num">含稅銷售金額</th></tr></thead>
          <tbody>${points.map(p => `<tr><td>${p.date}</td><td class="num">${fmtInt(p.quantity)}</td><td class="num">${fmtMoney(p.amount)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}


function renderAll() {
  renderFileList();
  renderDashboard();
  renderDailyTable();
  renderTrendTable();
  renderProductAnalysis();
}

function toCSV(rows, headers) {
  const escapeCell = value => {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [headers.map(h => escapeCell(h.label)).join(','), ...rows.map(row => headers.map(h => escapeCell(typeof h.value === 'function' ? h.value(row) : row[h.value])).join(','))].join('\n');
}

function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportRows() {
  const headers = [
    {label:'日期', value:'date'}, {label:'產品代號', value:'productCode'}, {label:'產品', value:'product'}, {label:'單位', value:'unit'},
    {label:'幣別', value:'currency'}, {label:'數量', value:'quantity'}, {label:'本幣單價', value:'unitPrice'},
    {label:'未稅金額', value:'untaxedAmount'}, {label:'含稅金額', value:'taxedAmount'}, {label:'來源檔案', value:'sourceFile'}
  ];
  downloadCSV('整合產銷明細.csv', toCSV(state.rows, headers));
}

function exportDaily() {
  const rows = aggregateDaily();
  const headers = [
    {label:'日期', value:'date'}, {label:'銷售品項數', value:'productCount'}, {label:'銷售總數量', value:'quantity'},
    {label:'未稅金額', value:'untaxed'}, {label:'含稅銷售額', value:'amount'}
  ];
  downloadCSV('每日銷售彙總.csv', toCSV(rows, headers));
}

el('csvInput').addEventListener('change', e => handleFiles([...e.target.files]));
el('loadDataBtn').addEventListener('click', loadDataFolder);
el('searchInput').addEventListener('input', renderTrendTable);
el('metricSelect').addEventListener('change', () => { renderTrendTable(); renderProductAnalysis(); });
el('sortSelect').addEventListener('change', renderTrendTable);
el('topNInput').addEventListener('change', renderTrendTable);
el('trendTable').addEventListener('click', event => {
  const row = event.target.closest('tr[data-product-key]');
  if (!row) return;
  state.selectedProductKey = row.dataset.productKey;
  renderTrendTable();
  renderProductAnalysis();
  el('productAnalysis').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
el('exportRowsBtn').addEventListener('click', exportRows);
el('exportDailyBtn').addEventListener('click', exportDaily);
el('saveBtn').addEventListener('click', () => {
  localStorage.setItem('dailyCsvIntegratorState', JSON.stringify(state));
  alert('已儲存到此瀏覽器。');
});
el('loadBtn').addEventListener('click', () => {
  const saved = localStorage.getItem('dailyCsvIntegratorState');
  if (!saved) return alert('目前沒有暫存資料。');
  const parsed = JSON.parse(saved);
  state.rows = parsed.rows || [];
  state.files = parsed.files || [];
  state.selectedProductKey = parsed.selectedProductKey || '';
  state.dataSource = parsed.dataSource || 'browser';
  sortRows();
  renderAll();
});
el('clearBtn').addEventListener('click', () => {
  if (!confirm('確定要清空目前整合資料？')) return;
  state.rows = [];
  state.files = [];
  state.selectedProductKey = '';
  state.dataSource = 'none';
  renderAll();
});

renderAll();
loadDataFolder();
