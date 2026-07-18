const DATA_MANIFEST_PATH = 'data/manifest.json';
const ECOMMERCE_DATA_PATH = 'data/ecommerce_sales.csv';
const EXCLUDED_PRODUCTS_PATH = 'data/excluded_products.json';
const ECOMMERCE_ADDON_PRICES_PATH = 'data/ecommerce_addon_prices.json';

const state = {
  rows: [],
  files: [],
  ecommerceRows: [],
  ecommerceSource: 'none',
  excludedProductCodes: new Set(),
  exclusionSource: 'none',
  ecommerceAddonPriceRules: [],
  ecommerceAddonPriceSource: 'none',
  includeEcommerceInAnalysis: false,
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


function normalizeProductCode(code) {
  return String(code || '').trim().toUpperCase();
}

function isExcludedProductCode(code) {
  const normalized = normalizeProductCode(code);
  return Boolean(normalized && state.excludedProductCodes.has(normalized));
}

function applyProductExclusions(rows) {
  return rows.filter(row => !isExcludedProductCode(row.productCode));
}

function normalizeExcludedProductCodes(config) {
  const values = [];
  if (Array.isArray(config)) values.push(...config);
  if (Array.isArray(config?.productCodes)) values.push(...config.productCodes);
  if (Array.isArray(config?.excludedProductCodes)) values.push(...config.excludedProductCodes);
  if (Array.isArray(config?.excludeProductCodes)) values.push(...config.excludeProductCodes);
  return [...new Set(values.map(normalizeProductCode).filter(Boolean))];
}

async function loadProductExclusions() {
  try {
    const text = await fetchTextNoCache(EXCLUDED_PRODUCTS_PATH);
    const config = JSON.parse(text);
    const codes = normalizeExcludedProductCodes(config);
    state.excludedProductCodes = new Set(codes);
    state.exclusionSource = 'data';
    console.info(`已載入排除產品代號 ${codes.length} 項`, codes);
    return codes;
  } catch (error) {
    state.excludedProductCodes = new Set();
    state.exclusionSource = 'none';
    console.info(`未讀取到 ${EXCLUDED_PRODUCTS_PATH}，目前不排除任何產品代號。`);
    return [];
  }
}

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


function normalizeEcommerceAddonPriceRules(config) {
  const sourceItems = Array.isArray(config) ? config : (Array.isArray(config?.items) ? config.items : []);
  return sourceItems.map(item => {
    const unitPrice = cleanNumber(item.unitPrice);
    return {
      rowNo: Number(item.rowNo) || null,
      productCode: normalizeProductCode(item.productCode),
      product: String(item.product || '').trim(),
      productContains: String(item.productContains || '').trim(),
      unitPrice,
      note: String(item.note || '').trim()
    };
  }).filter(item => item.unitPrice > 0 && (item.productCode || item.product || item.productContains || item.rowNo));
}

async function loadEcommerceAddonPrices() {
  try {
    const text = await fetchTextNoCache(ECOMMERCE_ADDON_PRICES_PATH);
    const config = JSON.parse(text);
    const rules = normalizeEcommerceAddonPriceRules(config);
    state.ecommerceAddonPriceRules = rules;
    state.ecommerceAddonPriceSource = 'data';
    console.info(`已載入電商加價購指定單價 ${rules.length} 項`, rules);
    return rules;
  } catch (error) {
    state.ecommerceAddonPriceRules = [];
    state.ecommerceAddonPriceSource = 'none';
    console.info(`未讀取到 ${ECOMMERCE_ADDON_PRICES_PATH}，電商金額維持現場單價回推。`);
    return [];
  }
}

function getEcommerceAddonRule(row) {
  if (!row || !state.ecommerceAddonPriceRules.length) return null;
  const code = normalizeProductCode(row.productCode);
  const product = String(row.product || '').trim();
  const rowNo = Number(row.rowNo) || null;

  return state.ecommerceAddonPriceRules.find(rule => {
    if (rule.rowNo && rowNo && rule.rowNo !== rowNo) return false;
    if (rule.productCode && code && rule.productCode !== code) return false;
    if (rule.product && product && rule.product !== product) return false;
    if (rule.productContains && product && !product.includes(rule.productContains)) return false;
    return true;
  }) || null;
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

function normalizeDateHeader(header, year) {
  const raw = String(header || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return '';

  const iso = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`;

  const mdSlash = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  const mdDash = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  const mdZh = raw.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  const md = mdSlash || mdDash || mdZh;
  if (!md) return '';

  const month = Number(md[1]);
  const day = Number(md[2]);
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

function setEcommerceStatus(message, type = 'info') {
  const box = el('ecommerceStatus');
  if (!box) return;
  box.className = `data-status ${type}`;
  box.innerHTML = message;
}

function updateEcommerceControls() {
  const toggleBtn = el('toggleEcommerceBtn');
  if (!toggleBtn) return;
  const hasData = state.ecommerceRows.length > 0;
  toggleBtn.disabled = !hasData;
  toggleBtn.textContent = state.includeEcommerceInAnalysis ? '現場+電商' : '只看現場';
  toggleBtn.className = state.includeEcommerceInAnalysis ? 'floating-ecommerce-toggle active' : 'floating-ecommerce-toggle';
  toggleBtn.title = hasData
    ? (state.includeEcommerceInAnalysis ? '點擊後切回只看現場' : '點擊後切換為現場+電商')
    : '尚未載入電商報表';
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
    const manifestExcludedCodes = normalizeExcludedProductCodes(manifest);
    if (manifestExcludedCodes.length) {
      state.excludedProductCodes = new Set([...state.excludedProductCodes, ...manifestExcludedCodes]);
      state.exclusionSource = state.exclusionSource === 'data' ? 'data + manifest' : 'manifest';
    }
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
    let excludedRowCount = 0;

    for (const file of files) {
      try {
        const text = await fetchTextNoCache(file.url);
        const parsed = parseCSV(text);
        const rows = normalizeFileRows(parsed, file.name, file.date);
        const filteredRows = applyProductExclusions(rows);
        excludedRowCount += rows.length - filteredRows.length;
        loadedRows.push(...filteredRows);
        loadedFiles.push({ name: file.name, date: file.date, rows: filteredRows.length, source: 'data' });
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
    const exclusionNote = state.excludedProductCodes.size ? `；已排除 <strong>${fmtInt(state.excludedProductCodes.size)}</strong> 個產品代號、<strong>${fmtInt(excludedRowCount)}</strong> 筆資料` : '';
    setDataStatus(`已從 <code>data</code> 載入 <strong>${fmtInt(loadedFiles.length)}</strong> 個檔案、<strong>${fmtInt(loadedRows.length)}</strong> 筆資料；日期範圍：<strong>${escapeHtml(range)}</strong>${exclusionNote}${failNote}。`, failedFiles.length ? 'warning' : 'success');
  } catch (error) {
    console.warn('無法自動讀取 data/manifest.json', error);
    setDataStatus('尚未讀取到 <code>data/manifest.json</code>。若你是直接用本機檔案開啟，瀏覽器可能會擋 fetch；部署到 GitHub Pages 或本機伺服器後即可自動讀取。', 'warning');
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


function normalizeEcommerceRows(parsed, filename) {
  if (!parsed.length) return [];
  const year = Number(el('yearInput').value) || new Date().getFullYear();
  const headers = parsed[0].map(h => String(h).trim());
  const productCodeIdx = headers.findIndex(h => ['產品代號', '商品代號', 'SKU', 'sku'].includes(h));
  const productIdx = headers.findIndex(h => ['產品', '商品', '產品名稱', '商品名稱'].includes(h));
  const dateColumns = headers.map((h, index) => ({ index, date: normalizeDateHeader(h, year) })).filter(c => c.date);

  if (productCodeIdx < 0 && productIdx < 0) return [];

  const rows = [];
  parsed.slice(1).forEach((r, rowIndex) => {
    const productCode = String(r[productCodeIdx] || '').trim();
    const product = String(r[productIdx] || '').trim();
    if (!productCode && !product) return;

    dateColumns.forEach(col => {
      const raw = String(r[col.index] ?? '').trim();
      if (raw === '') return;
      const row = {
        date: col.date,
        sourceFile: filename,
        rowNo: rowIndex + 2,
        productCode,
        product,
        quantity: cleanNumber(raw)
      };
      const addonRule = getEcommerceAddonRule(row);
      if (addonRule) {
        row.addonUnitPrice = addonRule.unitPrice;
        row.addonAmount = row.quantity * addonRule.unitPrice;
        row.isAddonPriced = true;
      } else {
        row.addonUnitPrice = 0;
        row.addonAmount = 0;
        row.isAddonPriced = false;
      }
      rows.push(row);
    });
  });
  return applyProductExclusions(rows);
}

async function loadEcommerceDataFolder() {
  setEcommerceStatus(`正在讀取 <code>${ECOMMERCE_DATA_PATH}</code> ...`, 'loading');
  try {
    const text = await fetchTextNoCache(ECOMMERCE_DATA_PATH);
    const parsed = parseCSV(text);
    const rows = normalizeEcommerceRows(parsed, ECOMMERCE_DATA_PATH.split('/').pop());
    state.ecommerceRows = rows;
    state.ecommerceSource = 'data';
    if (!rows.length) {
      state.includeEcommerceInAnalysis = false;
      updateEcommerceControls();
      renderAll();
      setEcommerceStatus('已讀取電商報表，但沒有解析到可用資料。請確認格式為「產品代號、產品、日期欄位」。', 'warning');
      return;
    }
    updateEcommerceControls();
    renderAll();
    const dates = [...new Set(rows.map(r => r.date))].sort();
    const products = new Set(rows.map(r => r.productCode || r.product)).size;
    setEcommerceStatus(`已載入電商報表：<strong>${fmtInt(products)}</strong> 個商品、<strong>${fmtInt(rows.length)}</strong> 筆日期資料；日期範圍：<strong>${escapeHtml(dates[0])} ～ ${escapeHtml(dates[dates.length - 1])}</strong>。`, 'success');
  } catch (error) {
    console.warn('無法讀取電商報表', error);
    setEcommerceStatus(`尚未讀取到 <code>${ECOMMERCE_DATA_PATH}</code>。若直接用本機檔案開啟，瀏覽器可能會擋 fetch；部署到 GitHub Pages 或本機伺服器後即可自動讀取。`, 'warning');
  }
}

async function handleEcommerceFile(file) {
  if (!file) return;
  const text = await file.text();
  const parsed = parseCSV(text);
  const rows = normalizeEcommerceRows(parsed, file.name);
  state.ecommerceRows = rows;
  state.ecommerceSource = 'manual';
  state.includeEcommerceInAnalysis = rows.length ? state.includeEcommerceInAnalysis : false;
  updateEcommerceControls();
  renderTrendTable();
  renderProductAnalysis();
  if (!rows.length) {
    setEcommerceStatus('已手動讀取電商報表，但沒有解析到可用資料。請確認格式為「產品代號、產品、日期欄位」。', 'warning');
    return;
  }
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const products = new Set(rows.map(r => r.productCode || r.product)).size;
  setEcommerceStatus(`已手動載入電商報表：<strong>${escapeHtml(file.name)}</strong>｜<strong>${fmtInt(products)}</strong> 個商品、<strong>${fmtInt(rows.length)}</strong> 筆日期資料；日期範圍：<strong>${escapeHtml(dates[0])} ～ ${escapeHtml(dates[dates.length - 1])}</strong>。`, 'success');
}

function aggregateEcommerceForProduct(product) {
  if (!product || !state.ecommerceRows.length) return { byDate: {}, totalQty: 0, addonQty: 0, addonAmount: 0, matchedProducts: [] };
  const selectedCode = String(product.productCode || '').trim();
  const selectedName = String(product.product || '').trim();
  const matched = state.ecommerceRows.filter(r => {
    const code = String(r.productCode || '').trim();
    const name = String(r.product || '').trim();
    if (selectedCode && code && selectedCode === code) return true;
    return selectedName && name && selectedName === name;
  });
  const byDate = {};
  const names = new Set();
  let totalQty = 0;
  let addonQty = 0;
  let addonAmount = 0;
  matched.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { quantity: 0, addonQuantity: 0, addonAmount: 0, regularQuantity: 0 };
    byDate[r.date].quantity += r.quantity;
    if (r.isAddonPriced) {
      byDate[r.date].addonQuantity += r.quantity;
      byDate[r.date].addonAmount += r.addonAmount || 0;
      addonQty += r.quantity;
      addonAmount += r.addonAmount || 0;
    } else {
      byDate[r.date].regularQuantity += r.quantity;
    }
    totalQty += r.quantity;
    if (r.product) names.add(r.product);
  });
  return { byDate, totalQty, addonQty, addonAmount, matchedProducts: [...names] };
}

function getEcommerceDates() {
  return [...new Set(state.ecommerceRows.map(r => r.date))].sort();
}

function getTrendDates() {
  const mainDates = getDates();
  if (!state.includeEcommerceInAnalysis || !state.ecommerceRows.length) return mainDates;
  return [...new Set([...mainDates, ...getEcommerceDates()])].sort();
}

function estimateOnsiteUnitPrice(product, date) {
  const daily = product.byDate?.[date];
  if (daily && daily.quantity > 0) return daily.amount / daily.quantity;
  if (product.totalQty > 0) return product.totalAmount / product.totalQty;
  return 0;
}

function augmentProductWithEcommerce(product, dates) {
  if (!state.includeEcommerceInAnalysis || !state.ecommerceRows.length) {
    return { ...product, trendByDate: product.byDate, trendTotalQty: product.totalQty, trendTotalAmount: product.totalAmount, ecommerceTotalQty: 0, ecommerceEstimatedAmount: 0 };
  }
  const ecommerce = aggregateEcommerceForProduct(product);
  const trendByDate = {};
  let trendTotalQty = 0;
  let trendTotalAmount = 0;
  let ecommerceEstimatedAmount = 0;
  dates.forEach(date => {
    const onsite = product.byDate[date] || { quantity: 0, amount: 0 };
    const ecommerceDay = ecommerce.byDate[date] || { quantity: 0, regularQuantity: 0, addonAmount: 0 };
    const ecommerceQty = ecommerceDay.quantity || 0;
    const ecommerceRegularQty = ecommerceDay.regularQuantity ?? ecommerceQty;
    const ecommerceAddonAmount = ecommerceDay.addonAmount || 0;
    const estimatedUnitPrice = estimateOnsiteUnitPrice(product, date);
    const estimatedEcommerceAmount = ecommerceRegularQty * estimatedUnitPrice + ecommerceAddonAmount;
    const quantity = (onsite.quantity || 0) + ecommerceQty;
    const amount = (onsite.amount || 0) + estimatedEcommerceAmount;
    trendByDate[date] = {
      quantity,
      amount,
      onsiteQuantity: onsite.quantity || 0,
      onsiteAmount: onsite.amount || 0,
      ecommerceQuantity: ecommerceQty,
      estimatedEcommerceAmount,
      estimatedUnitPrice
    };
    trendTotalQty += quantity;
    trendTotalAmount += amount;
    ecommerceEstimatedAmount += estimatedEcommerceAmount;
  });
  return {
    ...product,
    trendByDate,
    trendTotalQty,
    trendTotalAmount,
    ecommerceTotalQty: ecommerce.totalQty,
    ecommerceEstimatedAmount,
    ecommerceMatchedProducts: ecommerce.matchedProducts
  };
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
    const rows = applyProductExclusions(normalizeFileRows(parsed, file.name, date));
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


function getScopedProducts(dates = getTrendDates()) {
  return aggregateProducts().map(p => augmentProductWithEcommerce(p, dates));
}

function aggregateDailyForCurrentScope() {
  if (!state.includeEcommerceInAnalysis || !state.ecommerceRows.length) {
    return aggregateDaily().map(d => ({
      ...d,
      onsiteProductCount: d.productCount,
      ecommerceProductCount: 0,
      combinedProductCount: d.productCount,
      onsiteQuantity: d.quantity,
      ecommerceQuantity: 0,
      combinedQuantity: d.quantity,
      onsiteAmount: d.amount,
      ecommerceEstimatedAmount: 0,
      combinedAmount: d.amount,
      onsiteUntaxed: d.untaxed,
      combinedUntaxed: d.untaxed
    }));
  }

  const dates = getTrendDates();
  const products = getScopedProducts(dates);
  return dates.map(date => {
    const onsiteProducts = new Set();
    const ecommerceProducts = new Set();
    const combinedProducts = new Set();
    let onsiteQuantity = 0;
    let ecommerceQuantity = 0;
    let combinedQuantity = 0;
    let onsiteAmount = 0;
    let ecommerceEstimatedAmount = 0;
    let combinedAmount = 0;

    products.forEach(product => {
      const key = getProductKey(product);
      const row = product.trendByDate?.[date] || product.byDate?.[date] || {};
      const onsiteQty = row.onsiteQuantity ?? row.quantity ?? 0;
      const onsiteAmt = row.onsiteAmount ?? row.amount ?? 0;
      const ecommerceQty = row.ecommerceQuantity || 0;
      const ecommerceAmt = row.estimatedEcommerceAmount || 0;
      const combinedQty = (onsiteQty || 0) + ecommerceQty;
      const combinedAmt = (onsiteAmt || 0) + ecommerceAmt;

      if (onsiteQty > 0 || onsiteAmt > 0) onsiteProducts.add(key);
      if (ecommerceQty > 0) ecommerceProducts.add(key);
      if (combinedQty > 0 || combinedAmt > 0) combinedProducts.add(key);
      onsiteQuantity += onsiteQty;
      ecommerceQuantity += ecommerceQty;
      combinedQuantity += combinedQty;
      onsiteAmount += onsiteAmt;
      ecommerceEstimatedAmount += ecommerceAmt;
      combinedAmount += combinedAmt;
    });

    return {
      date,
      products: combinedProducts,
      productCount: combinedProducts.size,
      onsiteProductCount: onsiteProducts.size,
      ecommerceProductCount: ecommerceProducts.size,
      combinedProductCount: combinedProducts.size,
      quantity: combinedQuantity,
      amount: combinedAmount,
      untaxed: 0,
      onsiteQuantity,
      ecommerceQuantity,
      combinedQuantity,
      onsiteAmount,
      ecommerceEstimatedAmount,
      combinedAmount,
      onsiteUntaxed: 0,
      combinedUntaxed: 0
    };
  });
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

  const dates = getTrendDates();
  const daily = aggregateDailyForCurrentScope();
  const products = state.includeEcommerceInAnalysis && state.ecommerceRows.length
    ? getScopedProducts(dates)
    : aggregateProducts();
  const totalRevenue = daily.reduce((sum, d) => sum + (d.combinedAmount ?? d.amount), 0);
  const totalQty = daily.reduce((sum, d) => sum + (d.combinedQuantity ?? d.quantity), 0);
  const bestDay = [...daily].sort((a, b) => (b.combinedAmount ?? b.amount) - (a.combinedAmount ?? a.amount))[0];
  const topProduct = [...products].sort((a, b) => (b.trendTotalAmount ?? b.totalAmount) - (a.trendTotalAmount ?? a.totalAmount) || (b.trendTotalQty ?? b.totalQty) - (a.trendTotalQty ?? a.totalQty))[0];
  const productCount = products.filter(p => (p.trendTotalQty ?? p.totalQty) > 0 || (p.trendTotalAmount ?? p.totalAmount) > 0).length;
  const modeLabel = state.includeEcommerceInAnalysis && state.ecommerceRows.length ? '現場 + 電商' : '只看現場';

  el('kpiRevenue').textContent = fmtMoney(totalRevenue);
  el('kpiQty').textContent = fmtInt(totalQty);
  el('kpiProducts').textContent = fmtInt(productCount);
  el('kpiAvgRevenue').textContent = fmtMoney(totalRevenue / daily.length);
  el('kpiBestDate').textContent = bestDay?.date || '-';
  el('kpiTopProduct').textContent = topProduct ? `${topProduct.product}｜${fmtMoney(topProduct.trendTotalAmount ?? topProduct.totalAmount)}` : '-';

  if (daily.length >= 2) {
    const latest = daily[daily.length - 1];
    const prev = daily[daily.length - 2];
    const latestAmount = latest.combinedAmount ?? latest.amount;
    const prevAmount = prev.combinedAmount ?? prev.amount;
    const diff = latestAmount - prevAmount;
    const pct = prevAmount ? diff / prevAmount * 100 : 0;
    const sign = diff >= 0 ? '+' : '';
    const ecomPart = state.includeEcommerceInAnalysis && state.ecommerceRows.length
      ? `｜其中電商回推金額 ${fmtMoney(latest.ecommerceEstimatedAmount || 0)}，電商數量 ${fmtInt(latest.ecommerceQuantity || 0)}`
      : '';
    el('comparisonBox').innerHTML = `目前口徑：<strong>${modeLabel}</strong>。最新日 <strong>${latest.date}</strong> 含稅銷售額 <strong>${fmtMoney(latestAmount)}</strong>，較前一日 <strong>${prev.date}</strong> ${sign}${fmtMoney(diff)}，變動 <strong>${sign}${pct.toFixed(1)}%</strong>${ecomPart}。`;
  } else {
    el('comparisonBox').innerHTML = `目前口徑：<strong>${modeLabel}</strong>。尚無足夠資料可比較昨日差異。`;
  }
}

function renderFileList() {
  // 檔案載入摘要已整合到 dataStatus，避免資料來源視窗重複顯示同一組資訊。
}

function renderDailyTable() {
  const daily = aggregateDailyForCurrentScope();
  if (!daily.length) return setEmpty('dailyTable');

  if (state.includeEcommerceInAnalysis && state.ecommerceRows.length) {
    el('dailyTable').innerHTML = `
      <caption>目前口徑：現場 + 電商。電商金額以同商品現場單價回推；若同日無現場單價，則使用該商品整段期間平均現場單價。</caption>
      <thead><tr><th>日期</th><th class="num">銷售品項數</th><th class="num">現場數量</th><th class="num">電商數量</th><th class="num">合併數量</th><th class="num">現場含稅金額</th><th class="num">電商回推金額</th><th class="num">合併含稅金額</th></tr></thead>
      <tbody>${daily.map(d => `<tr><td>${d.date}</td><td class="num">${fmtInt(d.combinedProductCount)}</td><td class="num">${fmtInt(d.onsiteQuantity)}</td><td class="num ecommerce-num">${fmtInt(d.ecommerceQuantity)}</td><td class="num"><strong>${fmtInt(d.combinedQuantity)}</strong></td><td class="num">${fmtMoney(d.onsiteAmount)}</td><td class="num ecommerce-num">${fmtMoney(d.ecommerceEstimatedAmount)}</td><td class="num"><strong>${fmtMoney(d.combinedAmount)}</strong></td></tr>`).join('')}</tbody>`;
    return;
  }

  el('dailyTable').innerHTML = `
    <caption>目前口徑：只看現場。</caption>
    <thead><tr><th>日期</th><th class="num">銷售品項數</th><th class="num">銷售總數量</th><th class="num">未稅金額</th><th class="num">含稅銷售額</th></tr></thead>
    <tbody>${daily.map(d => `<tr><td>${d.date}</td><td class="num">${fmtInt(d.productCount)}</td><td class="num">${fmtInt(d.quantity)}</td><td class="num">${fmtMoney(d.untaxed)}</td><td class="num">${fmtMoney(d.amount)}</td></tr>`).join('')}</tbody>`;
}

function getMetricValue(product, date, metric) {
  const byDate = product.trendByDate || product.byDate;
  const row = byDate[date] || { quantity: 0, amount: 0 };
  return metric === 'quantity' ? row.quantity : row.amount;
}

function sortProductsForTrend(products, dates, metric, sortMode) {
  const latestDate = dates[dates.length - 1];
  const prevDate = dates[dates.length - 2];

  const metricTotal = p => metric === 'quantity' ? (p.trendTotalQty ?? p.totalQty) : (p.trendTotalAmount ?? p.totalAmount);
  const latestValue = p => latestDate ? getMetricValue(p, latestDate, metric) : 0;
  const prevValue = p => prevDate ? getMetricValue(p, prevDate, metric) : 0;
  const diffValue = p => latestValue(p) - prevValue(p);
  const codeValue = p => `${p.productCode || ''} ${p.product || ''}`;

  const tieBreak = (a, b) => (b.trendTotalAmount ?? b.totalAmount) - (a.trendTotalAmount ?? a.totalAmount) || (b.trendTotalQty ?? b.totalQty) - (a.trendTotalQty ?? a.totalQty) || codeValue(a).localeCompare(codeValue(b), 'zh-Hant');

  return [...products].sort((a, b) => {
    switch (sortMode) {
      case 'totalQtyDesc':
        return (b.trendTotalQty ?? b.totalQty) - (a.trendTotalQty ?? a.totalQty) || (b.trendTotalAmount ?? b.totalAmount) - (a.trendTotalAmount ?? a.totalAmount) || codeValue(a).localeCompare(codeValue(b), 'zh-Hant');
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
        return (b.trendTotalAmount ?? b.totalAmount) - (a.trendTotalAmount ?? a.totalAmount) || (b.trendTotalQty ?? b.totalQty) - (a.trendTotalQty ?? a.totalQty) || codeValue(a).localeCompare(codeValue(b), 'zh-Hant');
    }
  });
}

function getSortNote(sortMode, metric, dates) {
  const metricName = metric === 'quantity' ? '數量' : '含稅金額';
  const latestDate = dates[dates.length - 1] || '最新日';
  const prevDate = dates[dates.length - 2] || '前一日';
  const notes = {
    totalAmountDesc: state.includeEcommerceInAnalysis ? '依整段期間「現場 + 電商回推」累計含稅金額由高到低排序。' : '依整段期間累計含稅金額由高到低排序。',
    totalQtyDesc: state.includeEcommerceInAnalysis ? '依整段期間「現場 + 電商」累計數量由高到低排序。' : '依整段期間累計數量由高到低排序。',
    latestMetricDesc: `依 ${latestDate} 的${metricName}由高到低排序。`,
    latestMetricAsc: `依 ${latestDate} 的${metricName}由低到高排序。`,
    diffMetricDesc: `依 ${latestDate} 相較 ${prevDate} 的${metricName}增加幅度由高到低排序。`,
    diffMetricAsc: `依 ${latestDate} 相較 ${prevDate} 的${metricName}減少幅度由高到低排序。`,
    productCodeAsc: '依產品代號與產品名稱由 A 到 Z 排序。'
  };
  return notes[sortMode] || notes.totalAmountDesc;
}

function renderTrendTable() {
  const dates = getTrendDates();
  const allProducts = getScopedProducts(dates);
  if (!allProducts.length) return setEmpty('trendTable');
  const keyword = el('searchInput').value.trim().toLowerCase();
  const metric = el('metricSelect').value;
  const sortMode = el('sortSelect').value;
  const topN = Number(el('topNInput').value) || 200;
  const filtered = allProducts.filter(p => !keyword || `${p.productCode} ${p.product}`.toLowerCase().includes(keyword));
  const products = sortProductsForTrend(filtered, dates, metric, sortMode).slice(0, keyword ? 500 : topN);
  const dateHeaders = dates.map(d => `<th class="num">${d}</th>`).join('');
  const totalHeader = metric === 'quantity'
    ? (state.includeEcommerceInAnalysis ? '累計數量（現場+電商）' : '累計數量')
    : (state.includeEcommerceInAnalysis ? '累計含稅金額（含電商回推）' : '累計含稅金額');
  const sortNote = getSortNote(sortMode, metric, dates);
  const ecommerceNote = state.includeEcommerceInAnalysis
    ? '｜已加入電商資料：數量為現場+電商；金額以現場單價回推電商金額'
    : '';
  el('trendTable').innerHTML = `
    <caption>${escapeHtml(sortNote)}${ecommerceNote}${keyword ? '｜搜尋結果最多顯示 500 筆' : `｜目前顯示 Top ${topN}`}｜點擊商品可查看單一商品趨勢</caption>
    <thead><tr><th>產品代號</th><th>產品</th>${dateHeaders}<th class="num">${totalHeader}</th></tr></thead>
    <tbody>${products.map(p => {
      const key = getProductKey(p);
      const selectedClass = key === state.selectedProductKey ? ' class="selected-row"' : '';
      const cells = dates.map(d => {
        const row = (p.trendByDate || p.byDate)[d] || { quantity: 0, amount: 0, ecommerceQuantity: 0 };
        const hasEcommerce = state.includeEcommerceInAnalysis && (row.ecommerceQuantity || 0) > 0;
        const value = metric === 'quantity' ? fmtInt(row.quantity || 0) : fmtMoney(row.amount || 0);
        const title = hasEcommerce
          ? ` title="現場：${metric === 'quantity' ? fmtInt(row.onsiteQuantity || 0) : fmtMoney(row.onsiteAmount || 0)}｜電商：${metric === 'quantity' ? fmtInt(row.ecommerceQuantity || 0) : fmtMoney(row.estimatedEcommerceAmount || 0)}"`
          : '';
        return `<td class="num${hasEcommerce ? ' has-ecommerce' : ''}"${title}>${value}</td>`;
      }).join('');
      const total = metric === 'quantity' ? (p.trendTotalQty ?? p.totalQty) : (p.trendTotalAmount ?? p.totalAmount);
      return `<tr${selectedClass} data-product-key="${escapeHtml(key)}"><td>${escapeHtml(p.productCode)}</td><td>${escapeHtml(p.product)}</td>${cells}<td class="num"><strong>${metric === 'quantity' ? fmtInt(total) : fmtMoney(total)}</strong></td></tr>`;
    }).join('')}</tbody>`;
}


function buildProductLineChart(points, metric, options = {}) {
  const showEcommerce = Boolean(options.showEcommerce);
  const width = Math.max(760, points.length * 78);
  const height = 320;
  const margin = { top: 34, right: 42, bottom: 62, left: 76 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const primaryValue = p => showEcommerce ? p.quantity : (metric === 'quantity' ? p.quantity : p.amount);
  const primaryLabel = showEcommerce ? '現場數量' : (metric === 'quantity' ? '銷售數量' : '含稅金額');
  const values = points.flatMap(p => showEcommerce ? [primaryValue(p), p.ecommerceQuantity || 0] : [primaryValue(p)]);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = Math.max(maxValue - minValue, 1);
  const yMax = maxValue + range * 0.12;
  const yMin = Math.min(0, minValue);
  const yRange = Math.max(yMax - yMin, 1);
  const x = i => margin.left + (points.length === 1 ? innerW / 2 : i * innerW / (points.length - 1));
  const y = value => margin.top + innerH - ((value - yMin) / yRange * innerH);
  const toPath = accessor => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(accessor(p)).toFixed(2)}`).join(' ');
  const primaryPath = toPath(primaryValue);
  const ecommercePath = showEcommerce ? toPath(p => p.ecommerceQuantity || 0) : '';

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
    const gy = margin.top + innerH * ratio;
    const value = yMax - yRange * ratio;
    return `<line class="chart-grid" x1="${margin.left}" y1="${gy}" x2="${width - margin.right}" y2="${gy}"/><text class="chart-label" x="${margin.left - 10}" y="${gy + 4}" text-anchor="end">${fmtInt(value)}</text>`;
  }).join('');

  const primaryDots = points.map((p, i) => {
    const value = primaryValue(p);
    const label = metric === 'amount' && !showEcommerce ? fmtMoney(value) : fmtInt(value);
    return `<circle class="chart-dot" cx="${x(i)}" cy="${y(value)}" r="4"><title>${p.date}｜${primaryLabel}：${label}</title></circle><text class="chart-value-label" x="${x(i)}" y="${y(value) - 10}" text-anchor="middle">${label}</text>`;
  }).join('');

  const ecommerceDots = showEcommerce ? points.map((p, i) => {
    const value = p.ecommerceQuantity || 0;
    const label = fmtInt(value);
    return `<circle class="chart-dot ecommerce-dot" cx="${x(i)}" cy="${y(value)}" r="4"><title>${p.date}｜電商數量：${label}</title></circle>`;
  }).join('') : '';

  const dateLabels = points.map((p, i) => `<text class="chart-date-label" x="${x(i)}" y="${height - 24}" text-anchor="middle">${p.date.slice(5)}</text>`).join('');
  const legend = showEcommerce ? `
    <g class="chart-legend">
      <line class="chart-line" x1="${margin.left}" y1="18" x2="${margin.left + 28}" y2="18"/><text x="${margin.left + 36}" y="22">現場數量</text>
      <line class="chart-line ecommerce-line" x1="${margin.left + 128}" y1="18" x2="${margin.left + 156}" y2="18"/><text x="${margin.left + 164}" y="22">電商數量</text>
    </g>` : '';

  return `<svg class="product-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="單一商品銷售曲線圖">
    ${legend}
    ${gridLines}
    <line class="chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"/>
    <line class="chart-axis" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}"/>
    <path class="chart-line" d="${primaryPath}"/>
    ${showEcommerce ? `<path class="chart-line ecommerce-line" d="${ecommercePath}"/>` : ''}
    ${primaryDots}
    ${ecommerceDots}
    ${dateLabels}
  </svg>`;
}

function renderProductAnalysis() {
  const box = el('productAnalysis');
  const products = aggregateProducts();
  const mainDates = getDates();
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
  const ecommerce = aggregateEcommerceForProduct(product);
  const hasEcommerceMatch = ecommerce.totalQty > 0 || Object.keys(ecommerce.byDate).length > 0;
  const showEcommerce = state.includeEcommerceInAnalysis && hasEcommerceMatch;
  const dates = showEcommerce ? [...new Set([...mainDates, ...Object.keys(ecommerce.byDate)])].sort() : mainDates;

  const onsiteStatPoints = mainDates.map(date => {
    const main = product.byDate[date] || { quantity: 0, amount: 0 };
    return { date, quantity: main.quantity || 0, amount: main.amount || 0 };
  });

  const points = dates.map(date => {
    const main = product.byDate[date] || { quantity: 0, amount: 0 };
    const ec = ecommerce.byDate[date] || { quantity: 0, regularQuantity: 0, addonAmount: 0 };
    const estimatedUnitPrice = estimateOnsiteUnitPrice(product, date);
    const ecommerceRegularQty = ec.regularQuantity ?? (ec.quantity || 0);
    const estimatedEcommerceAmount = ecommerceRegularQty * estimatedUnitPrice + (ec.addonAmount || 0);
    return {
      date,
      quantity: main.quantity || 0,
      amount: main.amount || 0,
      ecommerceQuantity: ec.quantity || 0,
      ecommerceEstimatedAmount: estimatedEcommerceAmount,
      combinedQuantity: (main.quantity || 0) + (ec.quantity || 0),
      combinedAmount: (main.amount || 0) + estimatedEcommerceAmount,
      estimatedUnitPrice
    };
  });

  const qtyValues = onsiteStatPoints.map(p => p.quantity);
  const amountValues = onsiteStatPoints.map(p => p.amount);
  const ecommerceQtyValues = points.map(p => p.ecommerceQuantity);
  const ecommerceAmountValues = points.map(p => p.ecommerceEstimatedAmount);
  const combinedQtyValues = points.map(p => p.combinedQuantity);
  const combinedAmountValues = points.map(p => p.combinedAmount);
  const metricLabel = showEcommerce ? '現場 vs 電商銷售數量' : (metric === 'quantity' ? '每日銷售數量' : '每日含稅銷售金額');
  const ecommerceNote = state.includeEcommerceInAnalysis
    ? (hasEcommerceMatch ? `已加入電商資料；現場統計卡片維持只計算現場資料。電商端匹配到：${ecommerce.matchedProducts.map(escapeHtml).join('、') || escapeHtml(product.product)}。` : '已開啟加入電商資料，但這個商品在電商報表中沒有匹配資料。')
    : '目前未加入電商資料。';

  box.className = 'product-analysis';
  box.innerHTML = `
    <div class="analysis-head">
      <div>
        <h3>${escapeHtml(product.product || '未命名商品')}</h3>
        <p>產品代號：${escapeHtml(product.productCode || '-')}｜現場分析區間：${escapeHtml(mainDates[0])} ～ ${escapeHtml(mainDates[mainDates.length - 1])}${showEcommerce ? `｜含電商曲線區間：${escapeHtml(dates[0])} ～ ${escapeHtml(dates[dates.length - 1])}` : ''}</p>
        <p class="analysis-note">${ecommerceNote}</p>
      </div>
      <div class="analysis-badge">曲線指標：${metricLabel}</div>
    </div>
    <div class="analysis-kpis">
      <div class="analysis-card"><span>平均每日現場銷售數量</span><strong>${fmtInt(average(qtyValues))}</strong></div>
      <div class="analysis-card"><span>平均每日現場銷售金額</span><strong>${fmtMoney(average(amountValues))}</strong></div>
      <div class="analysis-card"><span>中位數現場銷售數量</span><strong>${fmtInt(median(qtyValues))}</strong></div>
      <div class="analysis-card"><span>中位數現場銷售金額</span><strong>${fmtMoney(median(amountValues))}</strong></div>
      ${showEcommerce ? `
        <div class="analysis-card ecommerce-card"><span>平均每日電商銷售數量</span><strong>${fmtInt(average(ecommerceQtyValues))}</strong></div>
        <div class="analysis-card ecommerce-card"><span>中位數電商銷售數量</span><strong>${fmtInt(median(ecommerceQtyValues))}</strong></div>
        <div class="analysis-card ecommerce-card"><span>平均每日合併銷售數量</span><strong>${fmtInt(average(combinedQtyValues))}</strong></div>
        <div class="analysis-card ecommerce-card"><span>平均每日合併回推金額</span><strong>${fmtMoney(average(combinedAmountValues))}</strong></div>
        <div class="analysis-card ecommerce-card"><span>電商回推總金額</span><strong>${fmtMoney(ecommerceAmountValues.reduce((sum, n) => sum + n, 0))}</strong></div>` : ''}
    </div>
    <div class="chart-box">
      <p class="chart-title">${metricLabel}曲線圖${showEcommerce ? '｜藍線：現場數量，紅線：電商數量' : ''}</p>
      ${buildProductLineChart(points, metric, { showEcommerce })}
    </div>
    <div class="analysis-detail-table">
      <div class="table-wrap">
        <table>
          <thead><tr><th>日期</th><th class="num">現場銷售數量</th><th class="num">現場含稅銷售金額</th>${showEcommerce ? '<th class="num">電商銷售數量</th><th class="num">電商回推金額</th><th class="num">合併銷售數量</th><th class="num">合併回推金額</th>' : ''}</tr></thead>
          <tbody>${points.map(p => `<tr><td>${p.date}</td><td class="num">${fmtInt(p.quantity)}</td><td class="num">${fmtMoney(p.amount)}</td>${showEcommerce ? `<td class="num ecommerce-num">${fmtInt(p.ecommerceQuantity)}</td><td class="num ecommerce-num">${fmtMoney(p.ecommerceEstimatedAmount)}</td><td class="num"><strong>${fmtInt(p.combinedQuantity)}</strong></td><td class="num"><strong>${fmtMoney(p.combinedAmount)}</strong></td>` : ''}</tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

function renderAll() {
  updateEcommerceControls();
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
  const rows = aggregateDailyForCurrentScope();
  if (state.includeEcommerceInAnalysis && state.ecommerceRows.length) {
    const headers = [
      {label:'日期', value:'date'}, {label:'銷售品項數', value:'combinedProductCount'}, {label:'現場數量', value:'onsiteQuantity'},
      {label:'電商數量', value:'ecommerceQuantity'}, {label:'合併數量', value:'combinedQuantity'}, {label:'現場含稅金額', value:'onsiteAmount'},
      {label:'電商回推金額', value:'ecommerceEstimatedAmount'}, {label:'合併含稅金額', value:'combinedAmount'}
    ];
    downloadCSV('每日銷售彙總_現場加電商.csv', toCSV(rows, headers));
    return;
  }
  const headers = [
    {label:'日期', value:'date'}, {label:'銷售品項數', value:'productCount'}, {label:'銷售總數量', value:'quantity'},
    {label:'未稅金額', value:'untaxed'}, {label:'含稅銷售額', value:'amount'}
  ];
  downloadCSV('每日銷售彙總.csv', toCSV(rows, headers));
}

const csvInputEl = el('csvInput');
if (csvInputEl) csvInputEl.addEventListener('change', e => handleFiles([...e.target.files]));

const ecommerceInputEl = el('ecommerceInput');
if (ecommerceInputEl) ecommerceInputEl.addEventListener('change', e => handleEcommerceFile(e.target.files[0]));

const loadEcommerceBtnEl = el('loadEcommerceBtn');
if (loadEcommerceBtnEl) loadEcommerceBtnEl.addEventListener('click', loadEcommerceDataFolder);

el('toggleEcommerceBtn').addEventListener('click', () => {
  state.includeEcommerceInAnalysis = !state.includeEcommerceInAnalysis;
  renderAll();
});
el('loadDataBtn').addEventListener('click', async () => {
  await loadProductExclusions();
  await loadEcommerceAddonPrices();
  await loadDataFolder();
  await loadEcommerceDataFolder();
});
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
renderAll();
Promise.all([loadProductExclusions(), loadEcommerceAddonPrices()]).then(() => {
  loadDataFolder();
  loadEcommerceDataFolder();
});
