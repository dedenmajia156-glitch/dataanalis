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

// ═══ HELPER: resolve produk dari DB (handle SKU yang belum ter-resolve) ═══
function reProduk(p) {
  if (!p) return '';
  const norm = p.trim().toLowerCase();
  // exact match sebagai SKU
  if (skuMap[norm]) return skuMap[norm];
  // partial match
  const found = Object.keys(skuMap).find(k => norm.includes(k) || k.includes(norm));
  if (found) return skuMap[found];
  // Cek apakah nilai ini adalah nama produk yang valid (ada di values skuMap)
  const isValidName = Object.values(skuMap).some(v => v.toLowerCase() === norm);
  return isValidName ? p : '';
}

// ═══ HELPER: fetch semua rows pakai pagination (bypass limit 1000 Supabase) ═══
async function fetchAll(queryFn) {
  const PAGE = 1000;
  let all = [], from = 0;
  while (true) {
    const { data, error } = await queryFn(from, from + PAGE - 1);
    if (error) throw error;
    if (data?.length) all = all.concat(data);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ═══ LOAD ALL DATA (hanya keluhan_data — cepat untuk startup) ═══
async function loadAllData() {
  if (!sbClient) return;
  try {
    toast('Memuat data keluhan...');
    const keluhanRows = await fetchAll(
      (f, t) => sbClient.from('keluhan_data').select('*').order('created_at', { ascending: true }).range(f, t)
    );
    if (keluhanRows.length) {
      processedData = keluhanRows.map(r => ({
        tanggal: r.tanggal||'', nama: r.nama||'', produk: reProduk(r.produk),
        keluhan: r.keluhan||'', team: r.team||'', cs: r.cs||'', ekspedisi: r.ekspedisi||'',
        status: r.status_akhir||'', resi: r.resi||'', provinsi: r.provinsi||'',
        kabupaten: r.kabupaten||'', kecamatan: r.kecamatan||'',
        kelurahan: r.kelurahan||'', total_pembayaran: parseRupiah(r.total_pembayaran),
      }));
    }
    const sbFile = document.getElementById('sb-file');
    const sbCount = document.getElementById('sb-count');
    if (sbFile) sbFile.textContent = 'Semua Batch';
    if (sbCount) sbCount.textContent = processedData.length.toLocaleString() + ' keluhan';

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
    orderData = []; // reset, akan di-load saat buka Analisis Wilayah
  } catch(e) {
    console.warn('loadAllData error:', e);
  }
}

// ═══ LOAD ORDER DATA (lazy — default 1 bulan terakhir, Semua pakai RPC) ═══
let orderDataLoaded = false;
let ekspedisiData = [];
let ekspedisiDataLoaded = false;

async function loadEkspedisiData() {
  if (!sbClient || ekspedisiDataLoaded) return;
  try {
    const rows = await fetchAll((f, t) =>
      sbClient.from('order_data')
        .select('ekspedisi, status_akhir, tanggal, team, produk, cs, total_pembayaran, provinsi, kabupaten, kecamatan, kelurahan')
        .range(f, t)
    );
    ekspedisiData = rows
      .map(r => ({
        ekspedisi: (r.ekspedisi||'').toUpperCase().trim(),
        status:    r.status_akhir||'',
        tanggal:   r.tanggal||'',
        team:      r.team||'',
        produk:    reProduk(r.produk),
        cs:               r.cs||'',
        total_pembayaran: parseRupiah(r.total_pembayaran),
        provinsi:  r.provinsi||'',
        kabupaten: r.kabupaten||'',
        kecamatan: r.kecamatan||'',
        kelurahan: r.kelurahan||'',
      }))
      .filter(r => r.ekspedisi);
    ekspedisiDataLoaded = true;
  } catch(e) {
    console.warn('loadEkspedisiData error:', e);
  }
}

function mapOrderRow(r) {
  return {
    provinsi: r.provinsi||'', kabupaten: r.kabupaten||'',
    kecamatan: r.kecamatan||'', kelurahan: r.kelurahan||'',
    produk: reProduk(r.produk), team: r.team||'',
    tanggal: r.tanggal||'', status: r.status_akhir||'',
    total_order: 1,
    total_pembayaran: parseRupiah(r.total_pembayaran),
  };
}

function mapRpcRow(r) {
  return {
    provinsi: r.provinsi||'', kabupaten: r.kabupaten||'',
    kecamatan: r.kecamatan||'', kelurahan: r.kelurahan||'',
    produk: reProduk(r.produk), team: r.team||'',
    tanggal: r.bulan ? r.bulan + '-01' : '', status: r.status_akhir||'',
    total_order: Number(r.total_order)||0,
    total_pembayaran: Number(r.total_pembayaran)||0,
  };
}

async function loadOrderData() {
  if (!sbClient || orderDataLoaded) return;
  try {
    toast('Memuat data wilayah...');
    const rows = await fetchAll((f, t) => sbClient.rpc('get_wilayah_stats').range(f, t));
    // DEBUG: lihat bulan apa saja yang ada di RPC
    const bulanList = [...new Set(rows.map(r => r.bulan).filter(Boolean))].sort();
    console.log('[DEBUG] Bulan dari RPC get_wilayah_stats:', bulanList);
    console.log('[DEBUG] Total rows RPC:', rows.length, '| Sample row:', rows[0]);
    orderData = rows.map(mapRpcRow);
    orderDataLoaded = true;
    toast('Data wilayah siap — ' + orderData.length.toLocaleString() + ' kombinasi area');
  } catch(e) {
    console.warn('loadOrderData error:', e);
    toast('Gagal memuat data wilayah: ' + errMsg(e), 'err');
  }
}

// ═══ LOAD BATCH ═══
async function loadBatch(batchId, batchName) {
  if (!sbClient) return;
  try {
    // Load order_data + keluhan_data for this batch — parallel
    const [orders, keluhanRows] = await Promise.all([
      fetchAll((f, t) => sbClient.from('order_data').select('*').eq('batch_id', batchId).order('created_at', { ascending: true }).range(f, t)),
      fetchAll((f, t) => sbClient.from('keluhan_data').select('*').eq('batch_id', batchId).order('created_at', { ascending: true }).range(f, t)),
    ]);
    if (orders.length) {
      orderData = orders.map(r => ({
        tanggal: r.tanggal||'', nama: r.nama||'', produk: reProduk(r.produk),
        keluhan: r.keluhan||'', team: r.team||'', cs: r.cs||'', ekspedisi: r.ekspedisi||'',
        status: r.status_akhir||'', resi: r.resi||'', provinsi: r.provinsi||'',
        kabupaten: r.kabupaten||'', kecamatan: r.kecamatan||'',
        kelurahan: r.kelurahan||'', total_pembayaran: parseRupiah(r.total_pembayaran),
      }));
    }
    if (keluhanRows.length) {
      processedData = keluhanRows.map(r => ({
        tanggal: r.tanggal||'', nama: r.nama||'', produk: reProduk(r.produk),
        keluhan: r.keluhan||'', team: r.team||'', cs: r.cs||'', ekspedisi: r.ekspedisi||'',
        status: r.status_akhir||'', resi: r.resi||'', provinsi: r.provinsi||'',
        kabupaten: r.kabupaten||'', kecamatan: r.kecamatan||'',
        kelurahan: r.kelurahan||'', total_pembayaran: parseRupiah(r.total_pembayaran),
      }));
    }

    orderDataLoaded = false; // reset supaya wilayah reload batch ini
    const sbFile  = document.getElementById('sb-file');
    const sbCount = document.getElementById('sb-count');
    if (sbFile)  sbFile.textContent  = batchName || 'Batch';
    if (sbCount) sbCount.textContent = processedData.length.toLocaleString() + ' keluhan';

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
          // Pakai header:1 dulu untuk dapat raw headers (handle duplikat kolom)
          const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (rawRows.length < 2) return;
          const headers = rawRows[0];
          // Buat header unik: duplikat diberi suffix _2, _3 dst
          const headerCount = {};
          const uniqueHeaders = headers.map(h => {
            const key = String(h).trim();
            if (!headerCount[key]) { headerCount[key] = 1; return key; }
            headerCount[key]++;
            return key + '_' + headerCount[key];
          });
          const rows = rawRows.slice(1).map(row => {
            const obj = {};
            uniqueHeaders.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
            return obj;
          });
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

      // Auto-detect bulan & tahun dari tanggal di file
      autoDetectBulan(allRows);

    } catch(err) {
      setStatus('err', 'Gagal baca file: ' + err.message);
      console.error('processFile error:', err);
    }
  };

  reader.readAsArrayBuffer(file);
}

// ═══ AUTO DETECT BULAN DARI FILE ═══
function autoDetectBulan(rows) {
  // Ambil kolom tanggal dari beberapa baris pertama
  const tglKeys = ['Tanggal', 'tanggal', 'Date', 'date', 'TglOrder', 'Tgl Order'];
  const monthCount = {};
  let parsed = 0;

  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const row = rows[i];
    let tglRaw = null;
    for (const k of tglKeys) { if (row[k] !== undefined && row[k] !== '') { tglRaw = row[k]; break; } }
    if (!tglRaw) continue;
    const d = normDate(tglRaw); // tanpa expectedYM — murni untuk deteksi
    if (!d) continue;
    const ym = d.slice(0, 7); // "YYYY-MM"
    monthCount[ym] = (monthCount[ym] || 0) + 1;
    parsed++;
  }

  if (!parsed) return; // tidak bisa detect, biarkan form apa adanya

  // Ambil bulan paling banyak muncul
  const detected = Object.entries(monthCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!detected) return;

  const [y, m] = detected.split('-');
  const bulanMEl = document.getElementById('uploadBulanM');
  const bulanYEl = document.getElementById('uploadBulanY');
  if (bulanMEl) bulanMEl.value = m;
  if (bulanYEl) bulanYEl.value = y;

  toast('Bulan terdeteksi otomatis: ' + BULAN_NAMES[+m] + ' ' + y, 'ok');
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
    const rawMapped = rawData.map(row => {
      const namaRaw = getAny(row, 'Nama', 'nama', 'NamaCustomer', 'nama customer', 'Customer', 'Nama Customer') || '';
      const namaCustomer = namaRaw.includes('|') ? namaRaw.split('|')[0].trim() : namaRaw.trim();
      const tglRaw = getAny(row, 'Tanggal', 'tanggal', 'Date', 'date', 'TglOrder', 'Tgl Order');

      return {
        tanggal:          bulanVal + '-01',
        nama:             namaCustomer,
        produk:           resolveProduk(namaRaw),
        keluhan:          (getCol(row, ck) || '').trim(),
        team:             teamForm,
        cs:               getAny(row, 'CS', 'CSA', 'csa', 'cs') ||
                          parseCSFromInstruksi(getWilayahCol(row, 'instruksipengiriman', 'instruksi')),
        status:           getAny(row, 'Status Akhir', 'StatusAkhir', 'Status', 'status'),
        resi:             getAny(row, 'NO RESI', 'No Resi', 'No. Resi', 'Nomor Resi', 'NoResi', 'NomorResi', 'NORESI', 'Resi', 'resi', 'no resi'),
        provinsi:         getWilayahCol(row, 'provinsi', 'prov'),
        kabupaten:        getWilayahCol(row, 'kabupaten', 'kab', 'kotakab', 'kotamadya'),
        kecamatan:        getWilayahCol(row, 'kecamatan', 'kec'),
        kelurahan:        getWilayahCol(row, 'kelurahan', 'kel', 'desa'),
        total_pembayaran: parseRupiah(getWilayahCol(row, 'totalpembayaran', 'totalbayar', 'totalbayaran')),
        ekspedisi:        parseEkspedisi(getWilayahCol(row, 'pembayaran')) ||
                          parseEkspedisi(getAny(row, 'No', 'no', 'nomor', 'Nomor')),
      };
    });

    // Buang rows yang benar-benar kosong (tidak ada nama, produk, cs, keluhan, total)
    allMapped = rawMapped.filter(r =>
      r.nama || r.produk || r.cs || r.keluhan || r.total_pembayaran
    );

    const skipped = rawMapped.length - allMapped.length;
    if (skipped > 0) toast(skipped + ' baris kosong di-skip', 'warn');

    // processedData = hanya rows yang ada produk atau keluhan
    processedData = allMapped.filter(r => r.produk || r.keluhan);
    // orderData local = semua rows valid
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
    toast('Error proses file: ' + errMsg(err), 'err');
    console.error('analyzeData error:', err);
  }
}

// ═══ SAVE TO SUPABASE ═══
async function saveToSupabase() {
  if (!sbClient) { toast('Supabase belum terhubung', 'err'); return; }
  const name = document.getElementById('batchName')?.value || 'Upload ' + new Date().toLocaleDateString('id-ID');
  toast('Menyimpan batch ke database...');
  try {
    // 1. Insert batch metadata
    const { data: batch, error: e1 } = await sbClient
      .from('keluhan_uploads')
      .insert({ batch_name: name, total_rows: allMapped.length })
      .select().single();
    if (e1) throw Object.assign(e1, { _step: 'Gagal simpan batch metadata' });

    // 2. Save SEMUA order ke order_data
    const orderRows = allMapped.map(r => ({
      batch_id:         batch.id,
      tanggal:          r.tanggal || null,
      nama:             r.nama || null,
      produk:           r.produk || null,
      keluhan:          r.keluhan || null,
      team:             r.team || null,
      cs:               r.cs || null,
      status_akhir:     r.status || null,
      resi:             r.resi || null,
      provinsi:         r.provinsi || null,
      kabupaten:        r.kabupaten || null,
      kecamatan:        r.kecamatan || null,
      kelurahan:        r.kelurahan || null,
      total_pembayaran: r.total_pembayaran || null,
      ekspedisi:        r.ekspedisi || null,
    }));

    const totalChunks = Math.ceil(orderRows.length / 500);
    for (let i = 0, chunk = 1; i < orderRows.length; i += 500, chunk++) {
      toast('Menyimpan order... ' + chunk + '/' + totalChunks);
      const { error } = await sbClient.from('order_data').insert(orderRows.slice(i, i + 500));
      if (error) throw Object.assign(error, { _step: 'Gagal simpan order_data (chunk ' + chunk + ')' });
    }

    // 3. Save hanya keluhan ke keluhan_data
    const keluhanRows = allMapped.filter(r => r.keluhan?.trim()).map(r => ({
      batch_id:         batch.id,
      tanggal:          r.tanggal || null,
      nama:             r.nama || null,
      produk:           r.produk || null,
      keluhan:          r.keluhan || null,
      team:             r.team || null,
      cs:               r.cs || null,
      status_akhir:     r.status || null,
      resi:             r.resi || null,
      provinsi:         r.provinsi || null,
      kabupaten:        r.kabupaten || null,
      kecamatan:        r.kecamatan || null,
      kelurahan:        r.kelurahan || null,
      total_pembayaran: r.total_pembayaran || null,
      ekspedisi:        r.ekspedisi || null,
    }));

    const totalKChunks = Math.ceil(keluhanRows.length / 500);
    for (let i = 0, chunk = 1; i < keluhanRows.length; i += 500, chunk++) {
      toast('Menyimpan keluhan... ' + chunk + '/' + totalKChunks);
      const { error } = await sbClient.from('keluhan_data').insert(keluhanRows.slice(i, i + 500));
      if (error) throw Object.assign(error, { _step: 'Gagal simpan keluhan_data (chunk ' + chunk + ')' });
    }

    orderDataLoaded = false; // reset wilayah cache
    toast('Tersimpan! ' + orderRows.length + ' order, ' + keluhanRows.length + ' keluhan.');
    await loadAllData();
  } catch(err) {
    const step = err._step ? '[' + err._step + '] ' : '';
    toast(step + errMsg(err), 'err');
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
  const headers = ['Tanggal','Nama','Produk','Keluhan','Team','CS','Status','No Resi'];
  const rows = wk.map(r => [r.tanggal, r.nama, r.produk, r.keluhan, r.team, r.cs, r.status, r.resi||'']);
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

  setOpts('filterProduk',    uniq(data.map(r => r.produk)));
  setOpts('filterTeam',      uniq(data.map(r => r.team)));
  setOpts('filterCS',        uniq(data.map(r => r.cs)));

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
  const fp = document.getElementById('filterProduk')?.value    || '';
  const ft = document.getElementById('filterTeam')?.value      || '';
  const fc = document.getElementById('filterCS')?.value        || '';
  const fb = document.getElementById('filterBulan')?.value     || '';
  const fs = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();

  currentFilter = processedData.filter(r => {
    if (fp && r.produk     !== fp) return false;
    if (ft && r.team       !== ft) return false;
    if (fc && r.cs         !== fc) return false;
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

  // Lazy load + render wilayah saat buka halaman itu
  if (name === 'wilayah') {
    const doRender = () => {
      renderWilayah();
      loadEkspedisiData().then(() => {
        // Isi dropdown ekspedisi setelah data siap
        const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
        const el = document.getElementById('wFilterEkspedisi');
        if (ekspedisiData.length) {
          const setO = (id, vals) => {
            const e = document.getElementById(id);
            if (e) e.innerHTML = '<option value="">Semua</option>' + vals.map(v=>`<option value="${v}">${v}</option>`).join('');
          };
          setO('wFilterCS',        uniq(ekspedisiData.map(r=>r.cs).filter(Boolean)));
          setO('wFilterEkspedisi', uniq(ekspedisiData.map(r=>r.ekspedisi).filter(Boolean)));
        }
        renderEkspedisi();
      });
    };
    if (!orderDataLoaded) {
      loadOrderData().then(doRender);
    } else {
      doRender();
    }
  }
}

// ═══ THEME ═══
function applyTheme(isLight) {
  const sunIcon = '<svg id="themeIcon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const moonIcon = '<svg id="themeIcon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>';
  if (isLight) {
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
  }
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) themeBtn.innerHTML = isLight ? (moonIcon + ' Dark') : (sunIcon + ' Light');
}

function toggleTheme() {
  const isLight = !document.body.classList.contains('light');
  applyTheme(isLight);
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
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
  if (type === 'ok')           el.classList.add('ok');
  else if (type === 'err')     el.classList.add('err');
  else if (type === 'loading') el.classList.add('loading');
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
  // error stays longer (8s), warn medium (5s), info short (3.5s)
  const dur = type === 'err' ? 8000 : type === 'warn' ? 5000 : 3500;
  el._t = setTimeout(() => { el.className = 'toast'; }, dur);
}

// ═══ EXTRACT ERROR MESSAGE ═══
function errMsg(e) {
  if (!e) return 'Unknown error';
  // Supabase error object
  if (e.message && e.details) return e.message + ' — ' + e.details;
  if (e.message && e.hint)    return e.message + ' (' + e.hint + ')';
  if (e.message)              return e.message;
  if (e.error_description)    return e.error_description;
  if (typeof e === 'string')  return e;
  return JSON.stringify(e);
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

// ═══ HELPER: parseEkspedisi dari kolom Pembayaran ═══
// "COD JNE" → "JNE", "COD JNT MENG" → "JNT"
function parseEkspedisi(pembayaran) {
  if (!pembayaran) return '';
  const s = String(pembayaran).toUpperCase();
  const couriers = ['SICEPAT','ANTERAJA','NINJA','PAXEL','WAHANA','TIKI','GOSEND','GRAB','SAP','LION','REX','IDL','JNE','JNT'];
  for (const c of couriers) {
    if (s.includes(c)) return c;
  }
  return '';
}

// ═══ HELPER: parseCS dari kolom Instruksi Pengiriman ═══
// "Pengirim CS Sari/Adv.Ahmad/Mufid" → "CS Sari"
function parseCSFromInstruksi(instruksi) {
  if (!instruksi) return '';
  const m = String(instruksi).match(/\bCS\s+([^\/,]+)/i);
  return m ? ('CS ' + m[1].trim()) : '';
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
function normDate(val, expectedYM) {
  // expectedYM = "YYYY-MM" dari form bulan — dipakai untuk deteksi swap DD/MM vs MM/DD
  if (!val) return null;

  // Jika Date object dari SheetJS (cellDates:true)
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y  = val.getFullYear();
    const mo = String(val.getMonth() + 1).padStart(2, '0');
    const d  = String(val.getDate()).padStart(2, '0');
    const result = y + '-' + mo + '-' + d;

    // Deteksi swap: Excel kadang baca "05/01/2026" (DD/MM) jadi "2026-05-01" (MM/DD)
    // Cirinya: day=01 di result, dan YYYY-MM tidak sesuai expectedYM
    if (expectedYM && d === '01' && result.slice(0,7) !== expectedYM) {
      // Coba swap: pakai mo sebagai day, expectedYM sebagai bulan
      const swappedDay = mo.padStart(2,'0');
      const [ey, em] = expectedYM.split('-');
      const candidate = ey + '-' + em + '-' + swappedDay;
      const swappedDayNum = parseInt(swappedDay, 10);
      if (swappedDayNum >= 1 && swappedDayNum <= 31) return candidate;
    }
    return result;
  }

  const s = String(val).trim();
  if (!s) return null;

  // yyyy-mm-dd (with or without time)
  const mISO = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mISO) return mISO[1];

  // Ambil bagian tanggal saja (buang waktu: "14/01/2026 07:05:26" → "14/01/2026")
  const datePart = s.split(/[\s,]+/)[0];

  // dd/mm/yyyy atau dd-mm-yyyy
  const m1 = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const [, d, mo, y] = m1;
    return y + '-' + mo.padStart(2,'0') + '-' + d.padStart(2,'0');
  }

  // Fallback native parse
  const dt = new Date(datePart);
  if (!isNaN(dt.getTime())) {
    return dt.getFullYear() + '-' +
           String(dt.getMonth()+1).padStart(2,'0') + '-' +
           String(dt.getDate()).padStart(2,'0');
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
  // Kalau tidak ada di SKU map → return '' (jangan tampilkan kode mentah)
  return found ? skuMap[found] : '';
}

// ═══ HELPER: getWilayahCol ═══
function getWilayahCol(row, ...keywords) {
  if (!row) return '';
  const normalize = s => String(s).toLowerCase().replace(/[\s\-_]/g, '');
  const normKeys = keywords.map(normalize);
  const keys = Object.keys(row);
  // 1. Exact match dulu
  let key = keys.find(k => normKeys.includes(normalize(k)));
  // 2. Kolom mengandung keyword (tapi bukan sebaliknya — hindari false positive)
  if (!key) key = keys.find(k => normKeys.some(nkw => normalize(k).includes(nkw)));
  return key ? String(row[key] ?? '').trim() : '';
}

// ═══ HELPER: parseRupiah ═══
function parseRupiah(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === 'number') return Math.round(val);
  // Hapus simbol mata uang, spasi, karakter non-numerik kecuali . dan ,
  let s = String(val).trim().replace(/[Rp$€IDR\s]/gi, '');
  if (!s) return 0;

  const hasDot   = s.includes('.');
  const hasComma = s.includes(',');

  if (hasDot && hasComma) {
    // Tentukan separator mana yang terakhir → itu decimal
    // "1.500.000,50" → Indonesian: buang titik, ganti koma jadi titik
    // "1,500,000.50" → English: buang koma
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasDot) {
    // "150.000" → 3 digit setelah titik terakhir = ribuan Indonesia, bukan desimal
    const afterDot = s.split('.').pop();
    if (afterDot.length === 3) s = s.replace(/\./g, ''); // ribuan
    // else biarkan → desimal biasa
  } else if (hasComma) {
    // "150,000" → ribuan English; "150,50" → desimal
    const afterComma = s.split(',').pop();
    if (afterComma.length === 3) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  }

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
  // Restore theme
  applyTheme(localStorage.getItem('theme') === 'light');

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
