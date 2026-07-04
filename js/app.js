// ─────────────────────────────────────────────
// APP.JS — Keluhan Analyzer
// ─────────────────────────────────────────────

// ═══ GLOBAL VARIABLES ═══
let sbClient = null;
let aiEnabled = false;
const BULAN_NAMES = ['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
let skuMap = {};
let processedData = []; // hanya rows dengan keluhan
let orderData = [];     // SEMUA rows order
let allMapped = [];     // semua rows hasil mapping dari file upload
let currentFilter = [];
let currentPage = 1;
const PAGE_SIZE = 50;
const charts = {};
let aiResultMap = {};
let rawData = [];

// ═══ SUPABASE INIT ═══
async function initSupabase() {
  try {
    const res = await fetch('/api/config');
    const { supabaseUrl, supabaseKey, aiEnabled: ai } = await res.json();
    if (supabaseUrl && supabaseKey) {
      sbClient = window.supabase.createClient(supabaseUrl, supabaseKey);
      aiEnabled = !!ai;
      await loadSKU();
      await loadAllData();
    }
  } catch(e) {}
}
initSupabase();

// ═══ SKU ═══
async function loadSKU() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient.from('sku_produk').select('kode, nama_produk');
    if (error) throw error;
    if (data?.length) {
      skuMap = {};
      data.forEach(r => {
        if (r.kode) skuMap[String(r.kode).trim().toLowerCase()] = r.nama_produk || r.kode;
      });
      updateSKUBadge(data.length);
    }
  } catch(e) {
    console.warn('loadSKU error:', e);
  }
}

function updateSKUBadge(count) {
  const sbSku = document.getElementById('sb-sku');
  const skuStatus = document.getElementById('skuStatus');
  if (sbSku) sbSku.textContent = count + ' SKU';
  if (skuStatus) skuStatus.textContent = count + ' produk dimuat';
}

// ═══ AI CACHE ═══
async function loadAICache() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient.from('keluhan_ai_cache').select('keluhan, kategori, gejala, penyakit');
    if (error) throw error;
    if (data?.length) {
      aiResultMap = {};
      data.forEach(r => {
        if (r.keluhan) aiResultMap[normK(r.keluhan)] = { kategori: r.kategori, gejala: r.gejala, penyakit: r.penyakit };
      });
      const btnPDF = document.getElementById('btnPDF');
      if (btnPDF) btnPDF.disabled = false;
    }
  } catch(e) {
    console.warn('loadAICache error:', e);
  }
}

// ═══ LOAD ALL DATA ═══
async function loadAllData() {
  if (!sbClient) return;
  try {
    // Load semua order
    const { data: orders } = await sbClient.from('order_data').select('*').order('created_at', { ascending: true });
    if (orders?.length) {
      orderData = orders.map(r => ({
        tanggal: r.tanggal||'', nama: r.nama||'', produk: r.produk||'',
        keluhan: r.keluhan||'', team: r.team||'', cs: r.cs||'',
        status: r.status_akhir||'', provinsi: r.provinsi||'',
        kabupaten: r.kabupaten||'', kecamatan: r.kecamatan||'',
        kelurahan: r.kelurahan||'', total_pembayaran: parseRupiah(r.total_pembayaran),
      }));
    }
    // Load keluhan saja
    const { data: keluhanRows } = await sbClient.from('keluhan_data').select('*').order('created_at', { ascending: true });
    if (keluhanRows?.length) {
      processedData = keluhanRows.map(r => ({
        tanggal: r.tanggal||'', nama: r.nama||'', produk: r.produk||'',
        keluhan: r.keluhan||'', team: r.team||'', cs: r.cs||'',
        status: r.status_akhir||'', provinsi: r.provinsi||'',
        kabupaten: r.kabupaten||'', kecamatan: r.kecamatan||'',
        kelurahan: r.kelurahan||'', total_pembayaran: parseRupiah(r.total_pembayaran),
      }));
    }
    const total = orderData.length || processedData.length;
    const sbFile = document.getElementById('sb-file');
    const sbCount = document.getElementById('sb-count');
    if (sbFile) sbFile.textContent = 'Semua Batch';
    if (sbCount) sbCount.textContent = total.toLocaleString() + ' baris';

    await loadAICache();
    if (processedData.length) {
      populateFilters(processedData);
      currentFilter = [...processedData];
      renderAll(currentFilter);
      const emptyEl = document.getElementById('emptyAnalisis');
      const dashEl  = document.getElementById('dashboard');
      if (emptyEl) emptyEl.style.display = 'none';
      if (dashEl)  dashEl.style.display  = 'block';
    }
  } catch(e) {
    console.warn('loadAllData error:', e);
  }
}

// ═══ LOAD BATCH ═══
async function loadBatch(batchId, batchName) {
  if (!sbClient) return;
  try {
    // Load order_data for this batch
    const { data: orders } = await sbClient.from('order_data').select('*').eq('batch_id', batchId).order('created_at', { ascending: true });
    if (orders?.length) {
      orderData = orders.map(r => ({
        tanggal: r.tanggal||'', nama: r.nama||'', produk: r.produk||'',
        keluhan: r.keluhan||'', team: r.team||'', cs: r.cs||'',
        status: r.status_akhir||'', provinsi: r.provinsi||'',
        kabupaten: r.kabupaten||'', kecamatan: r.kecamatan||'',
        kelurahan: r.kelurahan||'', total_pembayaran: parseRupiah(r.total_pembayaran),
      }));
    }
    // Load keluhan for this batch
    const { data: keluhanRows } = await sbClient.from('keluhan_data').select('*').eq('batch_id', batchId).order('created_at', { ascending: true });
    if (keluhanRows?.length) {
      processedData = keluhanRows.map(r => ({
        tanggal: r.tanggal||'', nama: r.nama||'', produk: r.produk||'',
        keluhan: r.keluhan||'', team: r.team||'', cs: r.cs||'',
        status: r.status_akhir||'', provinsi: r.provinsi||'',
        kabupaten: r.kabupaten||'', kecamatan: r.kecamatan||'',
        kelurahan: r.kelurahan||'', total_pembayaran: parseRupiah(r.total_pembayaran),
      }));
    }

    const sbFile  = document.getElementById('sb-file');
    const sbCount = document.getElementById('sb-count');
    const total = orderData.length || processedData.length;
    if (sbFile)  sbFile.textContent  = batchName || 'Batch';
    if (sbCount) sbCount.textContent = total.toLocaleString() + ' baris';

    if (processedData.length) {
      populateFilters(processedData);
      currentFilter = [...processedData];
      renderAll(currentFilter);
      const emptyEl = document.getElementById('emptyAnalisis');
      const dashEl  = document.getElementById('dashboard');
      if (emptyEl) emptyEl.style.display = 'none';
      if (dashEl)  dashEl.style.display  = 'block';
      goPage('analisis');
    }
  } catch(e) {
    console.warn('loadBatch error:', e);
    toast('Gagal memuat batch: ' + e.message, 'err');
  }
}

// ═══ PROCESS FILE ═══
function processFile(file) {
  if (!file) return;
  setStatus('loading', 'Membaca file...');
  const ext = file.name.split('.').pop().toLowerCase();

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let allRows = [];
      let detectedCols = [];

      if (ext === 'csv') {
        const text = new TextDecoder('utf-8').decode(e.target.result);
        allRows = csvToArray(text);
        if (allRows.length) detectedCols = Object.keys(allRows[0]);
      } else {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        // Filter sheet yang namanya mengandung "input" (case insensitive)
        let sheetNames = wb.SheetNames.filter(n => n.toLowerCase().includes('input'));
        if (!sheetNames.length) sheetNames = wb.SheetNames; // fallback semua sheet

        sheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
          if (rows.length) allRows = allRows.concat(rows);
        });

        if (allRows.length) detectedCols = Object.keys(allRows[0]);
      }

      if (!allRows.length) {
        setStatus('err', 'File kosong atau format tidak dikenali');
        return;
      }

      rawData = allRows;
      setStatus('ok', file.name + ' — ' + allRows.length.toLocaleString() + ' baris, ' + detectedCols.length + ' kolom');
      showDetectedCols(detectedCols);

      const btnAnalyze = document.getElementById('btnAnalyze');
      if (btnAnalyze) btnAnalyze.disabled = false;

      document.getElementById('batchName').value = file.name.replace(/\.[^.]+$/, '');

    } catch(err) {
      setStatus('err', 'Gagal baca file: ' + err.message);
      console.error('processFile error:', err);
    }
  };

  reader.readAsArrayBuffer(file);
}

// ═══ ANALYZE DATA ═══
async function analyzeData() {
  if (!rawData.length) { toast('Upload file dulu', 'warn'); return; }

  const bulanM   = document.getElementById('uploadBulanM')?.value || '01';
  const bulanY   = document.getElementById('uploadBulanY')?.value || String(new Date().getFullYear());
  const teamForm = document.getElementById('uploadTeam')?.value || '';
  const ck       = document.getElementById('colKeluhan')?.value || 'Keluhan';

  if (!teamForm) { toast('Pilih team dulu', 'warn'); return; }

  const bulanVal   = bulanY + '-' + bulanM;
  const bulanLabel = BULAN_NAMES[parseInt(bulanM, 10)] + ' ' + bulanY;
  const batchLabel = bulanLabel + ' — ' + teamForm;
  document.getElementById('batchName').value = batchLabel;

  toast('Memproses data...');

  try {
    allMapped = rawData.map(row => {
      const namaRaw = getAny(row, 'Nama', 'nama', 'NamaCustomer', 'nama customer', 'Customer', 'Nama Customer') || '';
      const namaCustomer = namaRaw.includes('|') ? namaRaw.split('|')[0].trim() : namaRaw.trim();
      const tglRaw = getAny(row, 'Tanggal', 'tanggal', 'Date', 'date', 'TglOrder', 'Tgl Order');

      return {
        tanggal:          normDate(tglRaw) || bulanVal + '-01',
        nama:             namaCustomer,
        produk:           resolveProduk(namaRaw),
        keluhan:          (getCol(row, ck) || '').trim(),
        team:             teamForm,
        cs:               getAny(row, 'CS', 'CSA', 'csa', 'cs'),
        status:           getAny(row, 'Status Akhir', 'StatusAkhir', 'Status', 'status'),
        provinsi:         getWilayahCol(row, 'provinsi', 'prov'),
        kabupaten:        getWilayahCol(row, 'kabupaten', 'kab', 'kotakab', 'kotamadya'),
        kecamatan:        getWilayahCol(row, 'kecamatan', 'kec'),
        kelurahan:        getWilayahCol(row, 'kelurahan', 'kel', 'desa'),
        total_pembayaran: parseRupiah(getWilayahCol(row, 'totalpembayaran', 'totalbayar', 'pembayaran', 'total pembayaran', 'total_pembayaran')),
      };
    });

    // processedData = hanya rows yang ada produk atau keluhan
    processedData = allMapped.filter(r => r.produk || r.keluhan);
    // orderData local = semua rows
    orderData = [...allMapped];

    if (!processedData.length) {
      toast('Tidak ada baris dengan produk/keluhan terdeteksi. Cek nama kolom.', 'warn');
      return;
    }

    populateFilters(processedData);
    currentFilter = [...processedData];
    currentPage = 1;
    renderAll(currentFilter);

    const emptyEl = document.getElementById('emptyAnalisis');
    const dashEl  = document.getElementById('dashboard');
    if (emptyEl) emptyEl.style.display = 'none';
    if (dashEl)  dashEl.style.display  = 'block';

    const sbFile  = document.getElementById('sb-file');
    const sbCount = document.getElementById('sb-count');
    if (sbFile)  sbFile.textContent  = batchLabel;
    if (sbCount) sbCount.textContent = allMapped.length.toLocaleString() + ' baris';

    goPage('analisis');
    toast(processedData.length + ' baris diproses. Menyimpan ke database...');

    await saveToSupabase();

  } catch(err) {
    toast('Error: ' + err.message, 'err');
    console.error('analyzeData error:', err);
  }
}

// ═══ SAVE TO SUPABASE ═══
async function saveToSupabase() {
  if (!sbClient) return;
  const name = document.getElementById('batchName')?.value || 'Upload ' + new Date().toLocaleDateString('id-ID');
  toast('Menyimpan...');
  try {
    // Insert batch metadata
    const { data: batch, error: e1 } = await sbClient
      .from('keluhan_uploads')
      .insert({ batch_name: name, total_rows: allMapped.length })
      .select()
      .single();
    if (e1) throw e1;

    // Save SEMUA order ke order_data
    const orderRows = allMapped.map(r => ({
      batch_id:          batch.id,
      tanggal:           r.tanggal || null,
      nama:              r.nama || null,
      produk:            r.produk || null,
      keluhan:           r.keluhan || null,
      team:              r.team || null,
      cs:                r.cs || null,
      status_akhir:      r.status || null,
      provinsi:          r.provinsi || null,
      kabupaten:         r.kabupaten || null,
      kecamatan:         r.kecamatan || null,
      kelurahan:         r.kelurahan || null,
      total_pembayaran:  r.total_pembayaran || null,
    }));

    for (let i = 0; i < orderRows.length; i += 500) {
      const { error } = await sbClient.from('order_data').insert(orderRows.slice(i, i + 500));
      if (error) { console.error('order_data insert error', error); throw error; }
    }

    // Save hanya keluhan ke keluhan_data
    const keluhanRows = allMapped.filter(r => r.keluhan?.trim()).map(r => ({
      batch_id:          batch.id,
      tanggal:           r.tanggal || null,
      nama:              r.nama || null,
      produk:            r.produk || null,
      keluhan:           r.keluhan || null,
      team:              r.team || null,
      cs:                r.cs || null,
      status_akhir:      r.status || null,
      provinsi:          r.provinsi || null,
      kabupaten:         r.kabupaten || null,
      kecamatan:         r.kecamatan || null,
      kelurahan:         r.kelurahan || null,
      total_pembayaran:  r.total_pembayaran || null,
    }));

    for (let i = 0; i < keluhanRows.length; i += 500) {
      const { error } = await sbClient.from('keluhan_data').insert(keluhanRows.slice(i, i + 500));
      if (error) { console.error('keluhan_data insert error', error); throw error; }
    }

    toast('Tersimpan! ' + orderRows.length + ' order, ' + keluhanRows.length + ' keluhan. Memuat ulang...');
    await loadAllData();
  } catch(err) {
    toast(err.message, 'err');
    console.error('saveToSupabase error:', err);
  }
}

// ═══ RENDER ALL ═══
function renderAll(data) {
  renderStats(data);
  renderCharts(data);
  renderRank(data);
  renderTable(data, currentPage);
  if (Object.keys(aiResultMap).length) renderAIResult(data);
}

// ═══ STATS ═══
function renderStats(data) {
  const wk = data.filter(r => r.keluhan?.trim());
  const allClosing = orderData.length || data.length;
  const produkSet = new Set(data.map(r => r.produk).filter(Boolean));
  const keluhanSet = new Set(wk.map(r => normK(r.keluhan)).filter(Boolean));

  const statTotal   = document.getElementById('statTotal');
  const statProduk  = document.getElementById('statProduk');
  const statKeluhan = document.getElementById('statKeluhan');
  const statJenis   = document.getElementById('statJenis');

  if (statTotal)   statTotal.textContent   = allClosing.toLocaleString();
  if (statProduk)  statProduk.textContent  = produkSet.size.toLocaleString();
  if (statKeluhan) statKeluhan.textContent = wk.length.toLocaleString();
  if (statJenis)   statJenis.textContent   = keluhanSet.size.toLocaleString();
}

// ═══ EXPORT CSV ═══
function exportCSV() {
  if (!currentFilter.length) { toast('Tidak ada data untuk diekspor', 'warn'); return; }
  const wk = currentFilter.filter(r => r.keluhan?.trim());
  const headers = ['Tanggal','Nama','Produk','Keluhan','Team','CS','Status'];
  const rows = wk.map(r => [r.tanggal, r.nama, r.produk, r.keluhan, r.team, r.cs, r.status]);
  const csv  = [headers, ...rows].map(r => r.map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'keluhan-export.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('CSV berhasil diexport');
}

// ═══ AI ANALYSIS ═══
async function runAIAnalysis() {
  if (!aiEnabled) { toast('AI tidak aktif. Set ANTHROPIC_API_KEY di server', 'warn'); return; }
  const wk = currentFilter.filter(r => r.keluhan?.trim());
  if (!wk.length) { toast('Tidak ada data keluhan', 'warn'); return; }

  const uniqueKeluhan = [...new Set(wk.map(r => r.keluhan.trim()))];
  const btnAI = document.getElementById('btnAI');
  if (btnAI) btnAI.disabled = true;
  toast('Menganalisis ' + uniqueKeluhan.length + ' jenis keluhan...');

  try {
    const res  = await fetch('/api/analyze-keluhan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keluhanList: uniqueKeluhan }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'API error');

    json.result.forEach(r => {
      if (r.keluhan) aiResultMap[normK(r.keluhan)] = { kategori: r.kategori, gejala: r.gejala, penyakit: r.penyakit };
    });

    renderAIResult(currentFilter);
    const btnPDF = document.getElementById('btnPDF');
    if (btnPDF) btnPDF.disabled = false;
    toast('AI selesai! ' + json.result.length + ' keluhan dianalisis');
  } catch(err) {
    toast('AI error: ' + err.message, 'err');
  } finally {
    if (btnAI) btnAI.disabled = false;
  }
}

function katColor(kat) {
  const map = {
    'Tulang & Sendi':   '#7c6ff7',
    'Pernapasan':       '#38bdf8',
    'Pencernaan':       '#22c55e',
    'Reproduksi Pria':  '#f59e0b',
    'Imunitas':         '#ef4444',
    'Metabolisme':      '#fb923c',
    'Kardiovaskular':   '#fb7185',
    'Kepala & Saraf':   '#a78bfa',
    'Kulit':            '#34d399',
    'Lainnya':          '#94a3b8',
  };
  return map[kat] || '#94a3b8';
}

// ═══ FILTERS ═══
function populateFilters(data) {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();

  const setOpts = (id, vals) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Semua</option>' +
      vals.map(v => '<option value="' + v + '">' + v + '</option>').join('');
  };

  setOpts('filterProduk', uniq(data.map(r => r.produk)));
  setOpts('filterTeam',   uniq(data.map(r => r.team)));
  setOpts('filterCS',     uniq(data.map(r => r.cs)));

  const bulanSet = [...new Set(data.map(r => r.tanggal?.slice(0, 7)).filter(Boolean))].sort();
  const filterBulan = document.getElementById('filterBulan');
  if (filterBulan) {
    filterBulan.innerHTML = '<option value="">Semua</option>' +
      bulanSet.map(b => {
        const [y, m] = b.split('-');
        return '<option value="' + b + '">' + (BULAN_NAMES[+m] || b) + ' ' + y + '</option>';
      }).join('');
  }
}

function applyFilters() {
  const fp = document.getElementById('filterProduk')?.value || '';
  const ft = document.getElementById('filterTeam')?.value   || '';
  const fc = document.getElementById('filterCS')?.value     || '';
  const fb = document.getElementById('filterBulan')?.value  || '';
  const fs = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();

  currentFilter = processedData.filter(r => {
    if (fp && r.produk !== fp) return false;
    if (ft && r.team   !== ft) return false;
    if (fc && r.cs     !== fc) return false;
    if (fb && r.tanggal && !r.tanggal.startsWith(fb)) return false;
    if (fs && !r.keluhan.toLowerCase().includes(fs) && !r.nama.toLowerCase().includes(fs)) return false;
    return true;
  });

  currentPage = 1;
  renderAll(currentFilter);
}

function resetFilters() {
  ['filterProduk','filterTeam','filterCS','filterBulan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  currentFilter = [...processedData];
  currentPage = 1;
  renderAll(currentFilter);
}

// ═══ HISTORY ═══
async function loadHistory() {
  if (!sbClient) { toast('Supabase belum terhubung', 'warn'); return; }
  const historyList = document.getElementById('historyList');
  if (!historyList) return;
  historyList.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">Memuat...</div>';

  try {
    const { data, error } = await sbClient
      .from('keluhan_uploads')
      .select('*')
      .order('uploaded_at', { ascending: false });
    if (error) throw error;

    if (!data?.length) {
      historyList.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)"><div style="font-size:32px;margin-bottom:12px">📭</div><div>Belum ada riwayat upload</div></div>';
      return;
    }

    historyList.innerHTML = data.map(batch => {
      const d = new Date(batch.uploaded_at);
      const dateStr = d.toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const safeName = batch.batch_name.replace(/'/g,"\\'");
      return '<div class="history-card" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:700;font-size:15px;margin-bottom:4px">' + batch.batch_name + '</div>' +
          '<div style="font-size:12px;color:var(--muted)">' + dateStr + ' · ' + (batch.total_rows||0).toLocaleString() + ' baris</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-outline" style="font-size:12px" onclick="loadBatch(\'' + batch.id + '\',\'' + safeName + '\')">📊 Lihat</button>' +
          '<button class="btn" style="font-size:12px;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3)" onclick="deleteHistory(\'' + batch.id + '\', this)">🗑 Hapus</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) {
    historyList.innerHTML = '<div style="padding:24px;text-align:center;color:#ef4444">Gagal memuat: ' + e.message + '</div>';
  }
}

async function deleteHistory(batchId, el) {
  if (!confirm('Yakin hapus batch ini? Semua data order & keluhan dalam batch akan ikut terhapus.')) return;
  if (!sbClient) return;
  try {
    const { error } = await sbClient.from('keluhan_uploads').delete().eq('id', batchId);
    if (error) throw error;
    const card = el.closest('.history-card');
    if (card) card.remove();
    toast('Batch dihapus');
    await loadAllData();
  } catch(e) {
    toast('Gagal hapus: ' + e.message, 'err');
  }
}

// ═══ NAVIGATION ═══
function goPage(name) {
  const titles = {
    upload:   'Upload Data',
    analisis: 'Analisis Keluhan',
    wilayah:  'Analisis Wilayah',
    riwayat:  'Riwayat Upload',
  };

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show riwayat (special case, outside .content)
  const riwayatPage = document.getElementById('page-riwayat');
  const contentEl   = document.querySelector('.content');
  if (name === 'riwayat') {
    if (contentEl)   contentEl.style.display = 'none';
    if (riwayatPage) { riwayatPage.style.display = 'block'; loadHistory(); }
  } else {
    if (contentEl)   contentEl.style.display = '';
    if (riwayatPage) riwayatPage.style.display = 'none';
    const targetPage = document.getElementById('page-' + name);
    if (targetPage) targetPage.classList.add('active');
  }

  // Update nav active
  const navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');

  // Update topbar title
  const topbarTitle = document.getElementById('topbarTitle');
  if (topbarTitle) topbarTitle.textContent = titles[name] || name;

  // Show/hide refresh history button
  const btnRefresh = document.getElementById('btnRefreshHistory');
  if (btnRefresh) btnRefresh.style.display = (name === 'riwayat') ? '' : 'none';

  // Render wilayah if navigating there and data exists
  if (name === 'wilayah' && (orderData.length > 0 || processedData.length > 0)) {
    renderWilayah();
  }
}

// ═══ THEME ═══
function toggleTheme() {
  document.body.classList.toggle('light');
  const isLight = document.body.classList.contains('light');
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    const sunIcon = '<svg id="themeIcon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    const moonIcon = '<svg id="themeIcon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>';
    themeBtn.innerHTML = isLight ? (moonIcon + ' Dark') : (sunIcon + ' Light');
  }
}

// ═══ CLEAR DATA ═══
function clearData() {
  rawData = [];
  processedData = [];
  orderData = [];
  allMapped = [];
  currentFilter = [];
  aiResultMap = {};
  currentPage = 1;

  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.value = '';
  const batchName = document.getElementById('batchName');
  if (batchName) batchName.value = '';

  setStatus('', '');
  const previewSection = document.getElementById('previewSection');
  if (previewSection) previewSection.style.display = 'none';
  const btnAnalyze = document.getElementById('btnAnalyze');
  if (btnAnalyze) btnAnalyze.disabled = true;

  const emptyEl = document.getElementById('emptyAnalisis');
  const dashEl  = document.getElementById('dashboard');
  if (emptyEl) emptyEl.style.display = '';
  if (dashEl)  dashEl.style.display  = 'none';

  const aiResult = document.getElementById('aiResult');
  if (aiResult) aiResult.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Klik tombol di atas untuk analisis kategori & kemungkinan penyakit dari keluhan</div>';

  toast('Data direset');
}

// ═══ STATUS ═══
function setStatus(type, msg) {
  const el = document.getElementById('dropStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'drop-status';
  if (type === 'ok')       el.classList.add('status-ok');
  else if (type === 'err') el.classList.add('status-err');
  else if (type === 'loading') el.classList.add('status-loading');
}

// ═══ TOAST ═══
function toast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show';
  if (type === 'err')  el.classList.add('toast-err');
  if (type === 'warn') el.classList.add('toast-warn');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 3500);
}

// ═══ COLUMN DETECTION UI ═══
function showDetectedCols(cols) {
  const section = document.getElementById('previewSection');
  const list    = document.getElementById('colList');
  if (!section || !list) return;
  list.innerHTML = cols.map(c =>
    '<span class="col-tag" onclick="pickCol(\'' + c.replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\', this)" title="' + c + '">' + c + '</span>'
  ).join('');
  section.style.display = 'block';
}

function pickCol(colName, el) {
  const colKeluhan = document.getElementById('colKeluhan');
  if (!colKeluhan) return;
  colKeluhan.value = colName;
  document.querySelectorAll('.col-tag').forEach(t => t.classList.remove('selected'));
  el.classList.add('selected');
  toast('Kolom "' + colName + '" dipilih sebagai keluhan');
}

// ═══ HELPER: getCol ═══
function getCol(row, colName) {
  if (!row || !colName) return '';
  const key = Object.keys(row).find(k => k.trim().toLowerCase() === colName.trim().toLowerCase());
  return key ? String(row[key] || '') : '';
}

// ═══ HELPER: getAny ═══
function getAny(row, ...names) {
  for (const name of names) {
    const val = getCol(row, name);
    if (val) return val;
  }
  return '';
}

// ═══ HELPER: normDate ═══
function normDate(val) {
  if (!val) return null;
  // If already a Date object (from XLSX with cellDates:true)
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y  = val.getFullYear();
    const mo = String(val.getMonth() + 1).padStart(2, '0');
    const d  = String(val.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + d;
  }
  const s = String(val).trim();
  if (!s) return null;

  // yyyy-mm-dd already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd/mm/yyyy or dd-mm-yyyy
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const [, d, mo, y] = m1;
    return y + '-' + mo.padStart(2,'0') + '-' + d.padStart(2,'0');
  }

  // Try native Date parse as fallback
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const y  = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, '0');
    const d  = String(dt.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + d;
  }

  return null;
}

// ═══ HELPER: normK ═══
function normK(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// ═══ HELPER: parseSKUFromNama ═══
function parseSKUFromNama(nama) {
  if (!nama) return '';
  // Format: "NamaCustomer|SKU QTY" atau "NamaCustomer|SKU"
  if (nama.includes('|')) {
    const parts = nama.split('|');
    if (parts.length >= 2) {
      const skuPart = parts[1].trim().split(' ')[0].trim();
      return skuPart;
    }
  }
  return '';
}

// ═══ HELPER: resolveProduk ═══
function resolveProduk(namaField) {
  if (!namaField) return '';
  const sku = parseSKUFromNama(String(namaField));
  if (!sku) return '';
  const skuNorm = sku.toLowerCase();
  if (skuMap[skuNorm]) return skuMap[skuNorm];
  // Partial match
  const found = Object.keys(skuMap).find(k => skuNorm.includes(k) || k.includes(skuNorm));
  return found ? skuMap[found] : sku;
}

// ═══ HELPER: getWilayahCol ═══
function getWilayahCol(row, ...keywords) {
  if (!row) return '';
  const normalize = s => String(s).toLowerCase().replace(/[\s\-_]/g, '');
  const normKeys = keywords.map(normalize);
  const key = Object.keys(row).find(k => {
    const nk = normalize(k);
    return normKeys.some(nkw => nk === nkw || nk.includes(nkw) || nkw.includes(nk));
  });
  return key ? String(row[key] || '').trim() : '';
}

// ═══ HELPER: parseRupiah ═══
function parseRupiah(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === 'number') return Math.round(val);
  const s = String(val).replace(/[Rp\s]/g, '').replace(/\./g, '').replace(/,/g, '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

// ═══ HELPER: csvToArray ═══
function csvToArray(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { values.push(cur); cur = ''; }
      else { cur += ch; }
    }
    values.push(cur);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
    return obj;
  });
}

// ═══ SKU FILE HANDLER ═══
function processSKUFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let rows = [];
      if (ext === 'csv') {
        const text = new TextDecoder('utf-8').decode(e.target.result);
        rows = csvToArray(text);
      } else {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      }
      if (!rows.length) { toast('File SKU kosong', 'warn'); return; }
      skuMap = {};
      rows.forEach(r => {
        const kode = (r.kode || r.Kode || r.SKU || r.sku || '').toString().trim().toLowerCase();
        const nama = r.nama_produk || r.NamaProduk || r.nama || r.Nama || r.produk || '';
        if (kode) skuMap[kode] = nama || kode;
      });
      const count = Object.keys(skuMap).length;
      updateSKUBadge(count);
      toast(count + ' SKU dimuat dari file');
    } catch(err) {
      toast('Gagal baca SKU: ' + err.message, 'err');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ═══ DOM READY ═══
document.addEventListener('DOMContentLoaded', function() {
  // Init tahun dropdown
  const yearEl = document.getElementById('uploadBulanY');
  if (yearEl) {
    const now = new Date();
    const curYear = now.getFullYear();
    for (let y = curYear - 2; y <= curYear + 1; y++) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === curYear) opt.selected = true;
      yearEl.appendChild(opt);
    }
  }

  // Set default bulan ke bulan sekarang
  const bulanMEl = document.getElementById('uploadBulanM');
  if (bulanMEl) {
    const curMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    bulanMEl.value = curMonth;
  }

  // File input change
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', function() {
      if (this.files[0]) processFile(this.files[0]);
    });
  }

  // SKU file input change
  const skuFileInput = document.getElementById('skuFileInput');
  if (skuFileInput) {
    skuFileInput.addEventListener('change', function() {
      if (this.files[0]) processSKUFile(this.files[0]);
    });
  }

  // Drag & drop on dropZone
  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    dropZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      this.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function() {
      this.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      this.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const fi = document.getElementById('fileInput');
          if (fi) fi.files = dt.files;
        } catch(err) { /* skip if DataTransfer not supported */ }
        processFile(file);
      }
    });
  }
});
