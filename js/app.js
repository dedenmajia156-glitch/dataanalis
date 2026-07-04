// ─────────────────────────────────────────────
// GLOBAL STATE & CONSTANTS
// ─────────────────────────────────────────────
let sbClient = null;
const BULAN_NAMES = ['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

let skuMap       = {}; // { 'KOI': 'Produk Koi', 'HBP': 'Herbapil', ... }
let rawData      = [];
let processedData = [];
let currentFilter = [];
let currentPage  = 1;
const PAGE_SIZE  = 50;
const charts     = {};
let aiResultMap  = {}; // { keluhan_norm: { kategori, gejala, penyakit } }
let aiEnabled    = false;

// ─────────────────────────────────────────────
// SUPABASE INIT
// ─────────────────────────────────────────────
async function initSupabase() {
  try {
    const res = await fetch('/api/config');
    const { supabaseUrl, supabaseKey, aiEnabled: ai } = await res.json();
    if (supabaseUrl && supabaseKey) {
      sbClient  = window.supabase.createClient(supabaseUrl, supabaseKey);
      aiEnabled = !!ai;
      await loadSKU();
      await loadAllData();
    }
  } catch(e) { /* offline mode */ }
}
initSupabase();

async function loadAICache() {
  if (!sbClient) return;
  try {
    const { data } = await sbClient.from('keluhan_ai_cache').select('keluhan,kategori,gejala,penyakit');
    if (!data?.length) return;
    data.forEach(r => {
      aiResultMap[normK(r.keluhan)] = {
        kategori: r.kategori || 'Lainnya',
        gejala  : r.gejala   || '—',
        penyakit: r.penyakit || '—',
      };
    });
    document.getElementById('btnPDF').disabled = false;
  } catch(e) { /* skip */ }
}

async function loadAllData() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient
      .from('keluhan_data')
      .select('*')
      .order('created_at', { ascending: true });
    if (error || !data?.length) return;

    processedData = data.map(r => ({
      tanggal          : r.tanggal || '',
      nama             : r.nama    || '',
      produk           : r.produk  || '',
      keluhan          : r.keluhan || '',
      team             : r.team    || '',
      cs               : r.cs      || '',
      status           : r.status_akhir || '',
      provinsi         : r.provinsi  || '',
      kabupaten        : r.kabupaten || '',
      kecamatan        : r.kecamatan || '',
      kelurahan        : r.kelurahan || '',
      total_pembayaran : Number(r.total_pembayaran) || 0,
    }));

    document.getElementById('sb-file').textContent  = 'Semua Batch';
    document.getElementById('sb-count').textContent = processedData.length.toLocaleString() + ' baris';

    await loadAICache();

    populateFilters(processedData);
    currentFilter = [...processedData];
    renderAll(currentFilter);

    document.getElementById('emptyAnalisis').style.display = 'none';
    document.getElementById('dashboard').style.display     = 'block';
  } catch(e) { /* belum ada data */ }
}

// ─────────────────────────────────────────────
// SKU CACHE
// ─────────────────────────────────────────────
async function loadSKU() {
  if (!sbClient) return;
  try {
    const { data } = await sbClient.from('sku_produk').select('kode,nama_produk');
    if (data && data.length) {
      data.forEach(s => { skuMap[s.kode.toUpperCase()] = s.nama_produk; });
      updateSKUBadge();
    }
  } catch(e) { console.warn('SKU load gagal:', e.message); }
}

function updateSKUBadge() {
  const n = Object.keys(skuMap).length;
  const el = document.getElementById('skuStatus');
  if (el) el.textContent = n ? `✓ ${n} SKU dimuat` : '(belum dimuat)';
  const sb = document.getElementById('sb-sku');
  if (sb) sb.textContent = n ? `${n} SKU dimuat` : '—';
}

// Upload SKU via CSV/Excel
document.addEventListener('DOMContentLoaded', () => {
  // Isi dropdown Tahun (5 tahun ke belakang s/d 2 tahun ke depan)
  const now = new Date();
  const selY = document.getElementById('uploadBulanY');
  for (let y = now.getFullYear() + 2; y >= now.getFullYear() - 5; y--) {
    selY.innerHTML += `<option value="${y}">${y}</option>`;
  }
  // Default ke bulan & tahun sekarang
  document.getElementById('uploadBulanM').value = String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('uploadBulanY').value = now.getFullYear();

  document.getElementById('skuFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        let rows;
        if (ext === 'csv') {
          rows = csvToArray(ev.target.result);
        } else {
          const wb = XLSX.read(ev.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        }
        let loaded = 0;
        rows.forEach(r => {
          const kode = (r.kode || r.Kode || r.SKU || r.sku || '').toString().trim().toUpperCase();
          const nama = (r.nama_produk || r.NamaProduk || r.Nama || r.nama || '').toString().trim();
          if (kode && nama) { skuMap[kode] = nama; loaded++; }
        });
        updateSKUBadge();
        toast(`✅ ${loaded} SKU berhasil dimuat dari file!`);
      } catch(err) {
        toast('✗ Gagal baca SKU: ' + err.message, 'err');
      }
    };
    if (ext === 'csv') reader.readAsText(file, 'UTF-8');
    else reader.readAsArrayBuffer(file);
    e.target.value = '';
  });
});

function parseSKUFromNama(nama) {
  // Format: "Nama Customer|SKU QTY" → ambil setelah |
  if (!nama || !nama.includes('|')) return null;
  const skuRaw = nama.split('|')[1]?.trim().toUpperCase() || '';
  if (!skuRaw) return null;
  const match = skuRaw.match(/^([A-Z]+)/);
  return match ? match[1] : null;
}

function resolveProduk(namaField) {
  // SKU selalu dari kolom Nama format "NamaCustomer|SKU"
  const kode = parseSKUFromNama(namaField);
  if (!kode) return '';
  // Kalau ada di skuMap → pakai nama produk lengkap
  if (skuMap[kode]) return skuMap[kode];
  // Kalau kode tidak ada di skuMap → skip (jangan paksa tampil)
  return '';
}

// ─────────────────────────────────────────────
// ROUTING
// ─────────────────────────────────────────────
function goPage(name) {
  // Sembunyikan semua page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-riwayat').style.display = 'none';

  // Aktifkan nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('nav-' + name).classList.add('active');

  if (name === 'riwayat') {
    document.getElementById('page-riwayat').style.display = 'block';
    document.getElementById('page-riwayat').scrollTop = 0;
  } else {
    document.getElementById('page-' + name).classList.add('active');
    document.querySelector('.main').scrollTop = 0;
  }

  const titles = { upload: 'Upload Data', analisis: 'Analisis Keluhan', wilayah: 'Analisis Wilayah', riwayat: 'Riwayat Upload' };
  document.getElementById('topbarTitle').textContent = titles[name] || name;
  document.getElementById('btnRefreshHistory').style.display = name === 'riwayat' ? 'block' : 'none';
  if (name === 'riwayat') loadHistory();
  if (name === 'wilayah' && processedData.length) renderWilayah();
}

// ─────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────
async function loadHistory() {
  const el = document.getElementById('historyList');
  if (!sbClient) {
    el.innerHTML = `<div class="empty-state"><div class="e-icon">🔌</div><h3>Supabase belum terhubung</h3><p>Deploy ke Vercel dulu ya gan</p></div>`;
    return;
  }
  el.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:20px">⏳ Memuat riwayat...</div>`;
  try {
    const { data, error } = await sbClient
      .from('keluhan_uploads')
      .select('*')
      .order('uploaded_at', { ascending: false });
    if (error) throw error;
    if (!data.length) {
      el.innerHTML = `<div class="empty-state"><div class="e-icon">🕘</div><h3>Belum ada riwayat</h3><p>Upload dan simpan data dulu</p></div>`;
      return;
    }
    el.innerHTML = `<div class="history-grid">${data.map(b => `
      <div class="history-card" onclick="loadBatch('${b.id}', '${b.batch_name.replace(/'/g,"\\'")}')">
        <div class="hc-name">📁 ${b.batch_name}</div>
        <div class="hc-meta">
          <span>📋 ${b.total_rows?.toLocaleString() || '—'} baris</span>
          <span>🗓 ${new Date(b.uploaded_at).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</span>
        </div>
        <div class="hc-actions">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();loadBatch('${b.id}','${b.batch_name.replace(/'/g,"\\'")}')">📈 Lihat Analisis</button>
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();deleteBatch('${b.id}')">🗑</button>
        </div>
      </div>`).join('')}</div>`;
    document.getElementById('page-riwayat').scrollTop = 0;
  } catch(err) {
    el.innerHTML = `<div style="color:var(--red);padding:20px;font-size:13px">✗ ${err.message}</div>`;
  }
}

async function loadBatch(batchId, batchName) {
  if (!sbClient) return;
  toast('⏳ Memuat data ' + batchName + '...');
  try {
    const { data, error } = await sbClient
      .from('keluhan_data')
      .select('*')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!data.length) { toast('⚠️ Tidak ada data di batch ini', 'warn'); return; }

    processedData = data.map(r => ({
      tanggal          : r.tanggal || '',
      nama             : r.nama    || '',
      produk           : r.produk  || '',
      keluhan          : r.keluhan || '',
      team             : r.team    || '',
      cs               : r.cs      || '',
      status           : r.status_akhir || '',
      provinsi         : r.provinsi  || '',
      kabupaten        : r.kabupaten || '',
      kecamatan        : r.kecamatan || '',
      kelurahan        : r.kelurahan || '',
      total_pembayaran : Number(r.total_pembayaran) || 0,
    }));

    document.getElementById('sb-file').textContent  = batchName;
    document.getElementById('sb-count').textContent = processedData.length.toLocaleString() + ' baris';

    populateFilters(processedData);
    currentFilter = [...processedData];
    renderAll(currentFilter);

    document.getElementById('emptyAnalisis').style.display = 'none';
    document.getElementById('dashboard').style.display     = 'block';

    goPage('analisis');
    toast('✅ ' + processedData.length.toLocaleString() + ' baris dimuat dari ' + batchName);
    if (aiEnabled) runAIAnalysis();
  } catch(err) {
    toast('✗ ' + err.message, 'err');
  }
}

async function deleteBatch(batchId) {
  if (!confirm('Hapus batch ini? Data keluhan ikut terhapus.')) return;
  try {
    const { error } = await sbClient.from('keluhan_uploads').delete().eq('id', batchId);
    if (error) throw error;
    toast('🗑 Batch dihapus.');
    loadHistory();
  } catch(err) {
    toast('✗ ' + err.message, 'err');
  }
}

// ─────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────
function toggleTheme() {
  document.body.classList.toggle('light');
  const isLight = document.body.classList.contains('light');
  document.getElementById('themeBtn').textContent = isLight ? '🌙 Dark' : '☀️ Light';
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  if (currentFilter.length) renderCharts(currentFilter);
}
if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light');
  document.getElementById('themeBtn').textContent = '🌙 Dark';
}

// ─────────────────────────────────────────────
// FILE INPUT
// ─────────────────────────────────────────────
const dzEl      = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

// drag & drop
dzEl.addEventListener('dragover', e => { e.preventDefault(); dzEl.classList.add('drag-over'); });
dzEl.addEventListener('dragleave', () => dzEl.classList.remove('drag-over'));
dzEl.addEventListener('drop', e => {
  e.preventDefault(); dzEl.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
});
// klik via <label for="fileInput"> — native browser, tidak perlu .click()
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) processFile(e.target.files[0]);
});

function setStatus(type, msg) {
  const el = document.getElementById('dropStatus');
  el.className = 'drop-status ' + type;
  el.textContent = msg;
}

// ─────────────────────────────────────────────
// PROCESS FILE
// ─────────────────────────────────────────────
function processFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  setStatus('loading', '⏳ Membaca ' + file.name + '...');

  const reader = new FileReader();
  reader.onload = e => {
    try {
      let data;
      let inputSheets;
      if (ext === 'csv') {
        data = csvToArray(e.target.result);
      } else if (['xlsx','xls'].includes(ext)) {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' });
        inputSheets = wb.SheetNames.filter(n => n.toLowerCase().includes('input'));
        if (!inputSheets.length) throw new Error('Tidak ada tab dengan nama "Input" di file ini.');
        data = inputSheets.flatMap(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }));
        setStatus('loading', `⏳ Menggabungkan ${inputSheets.length} tab (${inputSheets.join(', ')})...`);
      } else {
        throw new Error('Format tidak didukung. Pakai .xlsx, .xls, atau .csv');
      }
      if (!data.length) throw new Error('File kosong atau tidak ada data.');

      rawData = data;
      const tabInfo = (ext !== 'csv' && inputSheets)
        ? ` dari ${inputSheets.length} tab` : '';
      setStatus('ok', '✓ ' + data.length.toLocaleString() + ' baris berhasil dimuat' + tabInfo + ' — ' + file.name);
      document.getElementById('btnAnalyze').disabled = false;
      if (!document.getElementById('batchName').value) {
        document.getElementById('batchName').value = file.name.replace(/\.[^.]+$/, '');
      }
      document.getElementById('sb-file').textContent  = file.name;
      document.getElementById('sb-count').textContent = data.length.toLocaleString() + ' baris';

      // Show detected columns
      showDetectedCols(Object.keys(data[0] || {}));

    } catch(err) {
      setStatus('err', '✗ ' + err.message);
    }
  };
  reader.onerror = () => setStatus('err', '✗ Gagal membaca file.');
  if (ext === 'csv') reader.readAsText(file, 'UTF-8');
  else reader.readAsArrayBuffer(file);
}

// ─────────────────────────────────────────────
// SHOW DETECTED COLUMNS
// ─────────────────────────────────────────────
let clickedCol = null;
function showDetectedCols(cols) {
  const sec = document.getElementById('previewSection');
  const list = document.getElementById('colList');
  sec.style.display = 'block';
  list.innerHTML = cols.map(c =>
    `<div class="col-tag" onclick="pickCol('${c.replace(/'/g,"\\'")}', this)">${c}</div>`
  ).join('');
}

function pickCol(colName, el) {
  if (!clickedCol) {
    clickedCol = colName;
    document.querySelectorAll('.col-tag').forEach(t => t.classList.remove('sel'));
    el.classList.add('sel');
    toast('Klik lagi kolom lain untuk assign, atau set langsung di input kanan');
    return;
  }
  // Second click — ask which field
  const choice = confirm(`Set "${clickedCol}" sebagai:\nOK = Produk\nCancel = Keluhan`);
  if (choice) {
    document.getElementById('colProduk').value = clickedCol;
    toast('✅ Kolom Produk → ' + clickedCol);
  } else {
    document.getElementById('colKeluhan').value = clickedCol;
    toast('✅ Kolom Keluhan → ' + clickedCol);
  }
  clickedCol = null;
  document.querySelectorAll('.col-tag').forEach(t => t.classList.remove('sel'));
}

// ─────────────────────────────────────────────
// CSV PARSER
// ─────────────────────────────────────────────
function detectDelim(line) {
  const c = { ',':0, ';':0, '\t':0 };
  for (const ch of line) if (c[ch] !== undefined) c[ch]++;
  return Object.entries(c).sort((a,b) => b[1]-a[1])[0][0];
}
function splitLine(line, delim) {
  const res = []; let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === delim && !inQ) { res.push(cur); cur = ''; }
    else cur += c;
  }
  res.push(cur);
  return res;
}
function csvToArray(str) {
  const lines = str.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const delim   = detectDelim(lines[0]);
  const headers = splitLine(lines[0], delim).map(h => h.replace(/^"|"$/g,'').trim());
  return lines.slice(1).map(line => {
    const vals = splitLine(line, delim);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i]||'').replace(/^"|"$/g,'').trim(); });
    return obj;
  }).filter(row => Object.values(row).some(v => v));
}

// ─────────────────────────────────────────────
// COLUMN HELPERS
// ─────────────────────────────────────────────
function getCol(row, colName) {
  if (!colName) return '';
  const key = Object.keys(row).find(k =>
    k.trim().toLowerCase() === colName.trim().toLowerCase()
  );
  if (!key) return '';
  const v = row[key];
  if (v instanceof Date) return v.toISOString().slice(0,10);
  return String(v ?? '').trim();
}
function getAny(row, ...names) {
  for (const n of names) { const v = getCol(row, n); if (v) return v; }
  return '';
}
function normDate(val) {
  if (!val) return null;
  // Kalau sudah Date object (dari cellDates:true)
  if (val instanceof Date) {
    if (isNaN(val)) return null;
    return val.toISOString().slice(0,10);
  }
  const s = String(val).trim();
  if (!s) return null;
  // Format yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  // Format dd/mm/yyyy atau dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20'+m[3] : m[3];
    const result = `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    if (isNaN(Date.parse(result))) return null;
    return result;
  }
  // Coba parse langsung
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return null;
}
function normK(s) { return String(s||'').trim().toLowerCase().replace(/\s+/g,' '); }

// Helper untuk parsing kolom wilayah
function getWilayahCol(row, ...keywords) {
  const key = Object.keys(row).find(k =>
    keywords.some(kw => k.toLowerCase().replace(/[\s\/\-_]/g,'').includes(kw))
  );
  return key ? String(row[key]||'').trim() : '';
}

// ─────────────────────────────────────────────
// ANALYZE
// ─────────────────────────────────────────────
function analyzeData() {
  if (!rawData.length) return;
  const ck       = document.getElementById('colKeluhan').value || 'Keluhan';
  const teamForm = document.getElementById('uploadTeam').value;
  const bulanM   = document.getElementById('uploadBulanM').value;
  const bulanY   = document.getElementById('uploadBulanY').value;
  const bulanVal = `${bulanY}-${bulanM}`; // "2026-07"

  if (!teamForm) { toast('⚠️ Pilih Team dulu ya!', 'warn'); return; }

  // Auto-set batchName dari bulan + team
  const [by, bm] = bulanVal.split('-');
  const batchLabel = `${BULAN_NAMES[+bm]} ${by} — ${teamForm}`;
  document.getElementById('batchName').value = batchLabel;

  processedData = rawData.map(row => {
    const namaRaw      = getAny(row,'Nama','nama','NamaCustomer','name');
    const namaCustomer = namaRaw.includes('|') ? namaRaw.split('|')[0].trim() : namaRaw;
    // Tanggal dari Excel, fallback ke bulan yang dipilih (tanggal 1)
    const tgl = normDate(getAny(row,'Tanggal','tanggal','Tgl','tgl','Date')) || bulanVal + '-01';
    return {
      tanggal          : tgl,
      nama             : namaCustomer,
      produk           : resolveProduk(namaRaw),
      keluhan          : getCol(row, ck),
      team             : teamForm,
      cs               : getAny(row,'CS','CSA','csa','cs'),
      status           : getAny(row,'Status Akhir','StatusAkhir','Status','status'),
      provinsi         : getWilayahCol(row,'provinsi','prov'),
      kabupaten        : getWilayahCol(row,'kabupaten','kab','kotakab','kotamadya'),
      kecamatan        : getWilayahCol(row,'kecamatan','kec'),
      kelurahan        : getWilayahCol(row,'kelurahan','kel','desa'),
      total_pembayaran : Number(getWilayahCol(row,'totalpembayaran','totalbayar','pembayaran'))||0,
    };
  }).filter(r => r.produk || r.keluhan);

  if (!processedData.length) {
    toast('⚠️ Tidak ada data valid. Cek nama kolom Keluhan.', 'warn');
    return;
  }

  populateFilters(processedData);
  currentFilter = [...processedData];
  renderAll(currentFilter);

  const sub = document.getElementById('dashSubtitle');
  if (sub) sub.textContent = `${batchLabel} · ${processedData.length.toLocaleString()} baris`;

  document.getElementById('emptyAnalisis').style.display  = 'none';
  document.getElementById('dashboard').style.display      = 'block';

  goPage('analisis');
  toast('✅ Analisis selesai! ' + processedData.length + ' baris diproses. Menyimpan...');
  if (aiEnabled) runAIAnalysis();
  saveToSupabase();
}

// ─────────────────────────────────────────────
// FILTERS
// ─────────────────────────────────────────────
function populateFilters(data) {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
  const setOpts = (id, vals) => {
    const el = document.getElementById(id);
    el.innerHTML = '<option value="">Semua</option>' +
      vals.map(v => `<option value="${v}">${v}</option>`).join('');
  };
  setOpts('filterProduk', uniq(data.map(r => r.produk)));
  setOpts('filterTeam',   uniq(data.map(r => r.team)));
  setOpts('filterCS',     uniq(data.map(r => r.cs)));

  // Populate bulan filter dari tanggal yang ada di data
  const bulanSet = [...new Set(data.map(r => r.tanggal?.slice(0,7)).filter(Boolean))].sort();
  const elBulan = document.getElementById('filterBulan');
  elBulan.innerHTML = '<option value="">Semua</option>' +
    bulanSet.map(b => {
      const [y, m] = b.split('-');
      return `<option value="${b}">${BULAN_NAMES[+m]} ${y}</option>`;
    }).join('');
}

function applyFilters() {
  const fp = document.getElementById('filterProduk').value;
  const ft = document.getElementById('filterTeam').value;
  const fc = document.getElementById('filterCS').value;
  const fb = document.getElementById('filterBulan').value; // format: "2026-01"
  const kw = document.getElementById('searchInput').value.toLowerCase();

  currentFilter = processedData.filter(r => {
    if (fp && r.produk !== fp) return false;
    if (ft && r.team   !== ft) return false;
    if (fc && r.cs     !== fc) return false;
    if (fb && r.tanggal && !r.tanggal.startsWith(fb)) return false;
    if (kw && !r.keluhan.toLowerCase().includes(kw)) return false;
    return true;
  });
  currentPage = 1;
  renderAll(currentFilter);
}

function resetFilters() {
  ['filterProduk','filterTeam','filterCS','filterBulan'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('searchInput').value = '';
  currentFilter = [...processedData];
  currentPage = 1;
  renderAll(currentFilter);
}

// ─────────────────────────────────────────────
// RENDER ALL
// ─────────────────────────────────────────────
function renderAll(data) {
  updateStats(data);
  renderCharts(data);
  renderRank(data);
  renderTable(data, currentPage);
  // Re-render AI result pakai data terfilter (tanpa re-hit API)
  const wk = data.filter(r => r.keluhan?.trim());
  if (Object.keys(aiResultMap).length && wk.length) renderAIResult(wk);
}

function updateStats(data) {
  const wk = data.filter(r => r.keluhan.trim());
  document.getElementById('statTotal').textContent   = data.length.toLocaleString();
  document.getElementById('statProduk').textContent  = new Set(data.map(r=>r.produk).filter(Boolean)).size;
  document.getElementById('statKeluhan').textContent = wk.length.toLocaleString();
  document.getElementById('statJenis').textContent   = new Set(wk.map(r=>normK(r.keluhan))).size;
}

// ─────────────────────────────────────────────
// AI ANALYSIS
// ─────────────────────────────────────────────
const KAT_COLORS = {
  'Tulang & Sendi'    : '#f59e0b',
  'Pernapasan'        : '#38bdf8',
  'Pencernaan'        : '#22c55e',
  'Reproduksi Pria'   : '#7c6ff7',
  'Imunitas'          : '#f472b6',
  'Metabolisme'       : '#fb923c',
  'Kardiovaskular'    : '#ef4444',
  'Kepala & Saraf'    : '#a78bfa',
  'Kulit'             : '#34d399',
  'Lainnya'           : '#9ca3af',
};

function katColor(kat) {
  for (const k of Object.keys(KAT_COLORS)) {
    if (kat?.includes(k.split(' ')[0])) return KAT_COLORS[k];
  }
  return '#9ca3af';
}

async function runAIAnalysis() {
  const wk = currentFilter.filter(r => r.keluhan.trim());
  if (!wk.length) { toast('⚠️ Tidak ada keluhan untuk dianalisis', 'warn'); return; }

  const btn = document.getElementById('btnAI');
  const res = document.getElementById('aiResult');
  btn.disabled = true;
  btn.textContent = '⏳ Menganalisis...';
  res.innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted)">
    <div style="font-size:28px;margin-bottom:12px">🤖</div>
    <div style="font-size:13px">AI sedang menganalisis ${[...new Set(wk.map(r=>normK(r.keluhan)))].length} jenis keluhan...</div>
  </div>`;

  // Ambil unique keluhan
  const uniqueKeluhan = [...new Set(wk.map(r => normK(r.keluhan)))].filter(Boolean);

  // Kirim ke API dalam batch 30
  const BATCH = 30;
  let allResults = [];
  try {
    for (let i = 0; i < uniqueKeluhan.length; i += BATCH) {
      const batch = uniqueKeluhan.slice(i, i + BATCH);
      const r = await fetch('/api/analyze-keluhan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keluhanList: batch }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || 'API error');
      }
      const data = await r.json();
      allResults = allResults.concat(data.result || []);
    }

    // Simpan ke map
    aiResultMap = {};
    allResults.forEach(item => {
      aiResultMap[normK(item.keluhan)] = {
        kategori: item.kategori || 'Lainnya',
        gejala  : item.gejala   || '—',
        penyakit: item.penyakit || '—',
      };
    });

    renderAIResult(wk);
    btn.textContent = '↺ Refresh';
    document.getElementById('btnPDF').disabled = false;
  } catch(err) {
    res.innerHTML = `<div style="padding:20px;color:var(--red);font-size:13px">✗ ${err.message}</div>`;
    toast('✗ AI error: ' + err.message, 'err');
  }
  btn.disabled = false;
}

// ─────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────
function exportCSV() {
  const data = currentFilter.filter(r=>r.keluhan.trim());
  const hdrs = ['Tanggal','Nama','Produk','Keluhan','Team','CS','Status'];
  const rows = data.map(r=>[r.tanggal,r.nama,r.produk,r.keluhan,r.team,r.cs,r.status]);
  const csv  = [hdrs,...rows].map(r=>r.map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'keluhan-analisis.csv';
  a.click();
  toast('✅ Export selesai!');
}

// ─────────────────────────────────────────────
// SAVE SUPABASE
// ─────────────────────────────────────────────
async function saveToSupabase() {
  if (!sbClient) { toast('⚠️ Supabase belum dikonfigurasi', 'warn'); return; }
  if (!processedData.length) { toast('⚠️ Analisis dulu datanya', 'warn'); return; }
  const name = document.getElementById('batchName').value || 'Upload ' + new Date().toLocaleDateString('id-ID');
  toast('⏳ Menyimpan...');
  try {
    const { data: batch, error: e1 } = await sbClient
      .from('keluhan_uploads').insert({ batch_name: name, total_rows: processedData.length })
      .select().single();
    if (e1) throw e1;
    const rows = processedData.filter(r=>r.keluhan?.trim()).map(r=>({
      batch_id     : batch.id,
      tanggal      : r.tanggal      || null,
      nama         : r.nama         || null,
      produk       : r.produk       || null,
      keluhan      : r.keluhan      || null,
      team         : r.team         || null,
      cs           : r.cs           || null,
      status_akhir : r.status       || null,
      provinsi     : r.provinsi     || null,
      kabupaten    : r.kabupaten    || null,
      kecamatan    : r.kecamatan    || null,
      kelurahan    : r.kelurahan    || null,
      total_pembayaran: r.total_pembayaran || null,
    }));
    for (let i=0;i<rows.length;i+=500) {
      const { error: e2 } = await sbClient.from('keluhan_data').insert(rows.slice(i,i+500));
      if (e2) { console.error('Insert error batch', i, e2, rows.slice(i,i+1)); throw e2; }
    }
    toast('✅ Tersimpan! ' + rows.length + ' keluhan. Memuat semua data...');
    await loadAllData();
  } catch(err) { toast('✗ ' + err.message, 'err'); }
}

// ─────────────────────────────────────────────
// CLEAR
// ─────────────────────────────────────────────
function clearData() {
  rawData = []; processedData = []; currentFilter = [];
  fileInput.value = '';
  document.getElementById('dropStatus').className = 'drop-status';
  document.getElementById('previewSection').style.display = 'none';
  document.getElementById('btnAnalyze').disabled = true;
  document.getElementById('btnSave') && (document.getElementById('btnSave').disabled = true);
  document.getElementById('sb-count').textContent = '—';
  document.getElementById('sb-file').textContent  = 'Belum ada file';
  document.getElementById('dashboard').style.display     = 'none';
  document.getElementById('emptyAnalisis').style.display = 'block';
  Object.keys(charts).forEach(k=>{charts[k].destroy();delete charts[k];});
  goPage('upload');
  toast('🗑 Data direset.');
}

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────
function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  const icon = type==='err'?'❌':type==='warn'?'⚠️':'✅';
  el.className = 'show';
  el.innerHTML = icon + ' ' + msg;
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.className=''; }, 3500);
}
