// ─────────────────────────────────────────────
// ANALISIS WILAYAH
// Uses globals from app.js: processedData, BULAN_NAMES, toast
// ─────────────────────────────────────────────

let wilayahFilter = [];
let wilayahDrillLevel = 'provinsi';
let wilayahDrillStack = [];
let wilayahPage = 1;
const WILAYAH_PAGE_SIZE = 10;
let leafletMap = null;
let geoLayer = null;

function fmtRp(val) {
  if (!val || isNaN(val)) return 'Rp 0';
  if (val >= 1e9)  return 'Rp ' + (val/1e9).toFixed(1) + ' M';
  if (val >= 1e6)  return 'Rp ' + (val/1e6).toFixed(1) + ' jt';
  return 'Rp ' + Number(val).toLocaleString('id-ID');
}

function renderWilayah() {
  const srcData = orderData.length ? orderData : processedData;
  const hasData = srcData.some(r => r.provinsi || r.kabupaten);
  if (!hasData) {
    document.getElementById('emptyWilayah').style.display = 'block';
    document.getElementById('wilayahDashboard').style.display = 'none';
    return;
  }
  document.getElementById('emptyWilayah').style.display = 'none';
  document.getElementById('wilayahDashboard').style.display = 'block';

  const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
  const setOpts = (id, vals) => {
    const el = document.getElementById(id);
    el.innerHTML = '<option value="">Semua</option>' + vals.map(v=>`<option value="${v}">${v}</option>`).join('');
  };
  setOpts('wFilterProduk', uniq(srcData.map(r=>r.produk)));
  setOpts('wFilterTeam',   uniq(srcData.map(r=>r.team)));

  // Hanya tampilkan bulan yang benar-benar ada ordernya
  const monthOrders = {};
  srcData.forEach(r => {
    const m = r.tanggal?.slice(0,7);
    if (m) monthOrders[m] = (monthOrders[m]||0) + (r.total_order||1);
  });
  const bulanSet = Object.keys(monthOrders).filter(m => monthOrders[m] > 0).sort().reverse();
  document.getElementById('wFilterBulan').innerHTML = '<option value="">Semua</option>' +
    bulanSet.map(b => { const [y,m]=b.split('-'); return `<option value="${b}">${BULAN_NAMES[+m]} ${y}</option>`; }).join('');

  applyWilayahFilters();
}

async function onWilayahBulanChange() {
  const val = document.getElementById('wFilterBulan').value;
  if (val === '') {
    // "Semua" dipilih → load semua via RPC kalau belum
    orderDataLoaded = false;
    await loadOrderData('semua');
    renderWilayah();
    return;
  }
  applyWilayahFilters();
}

function applyWilayahFilters() {
  const fp = document.getElementById('wFilterProduk').value;
  const ft = document.getElementById('wFilterTeam').value;
  const fb = document.getElementById('wFilterBulan').value;

  const srcData = orderData.length ? orderData : processedData;
  wilayahFilter = srcData.filter(r => {
    if (fp && r.produk !== fp) return false;
    if (ft && r.team   !== ft) return false;
    if (fb && r.tanggal && !r.tanggal.startsWith(fb)) return false;
    return true;
  });

  wilayahDrillLevel = 'provinsi';
  wilayahDrillStack = [];
  wilayahPage = 1;
  updateWilayahStats();
  renderWilayahMap();
  renderWilayahTable();
}

function resetWilayahFilters() {
  ['wFilterProduk','wFilterTeam','wFilterBulan'].forEach(id => document.getElementById(id).value='');
  applyWilayahFilters();
}

function updateWilayahStats() {
  const data = wilayahFilter;
  const totalOrder  = data.reduce((s,r)=>s+(r.total_order||1),0);
  const totalOmzet  = data.reduce((s,r)=>s+(r.total_pembayaran||0),0);
  document.getElementById('wStatOrder').textContent = totalOrder.toLocaleString();
  document.getElementById('wStatOmzet').textContent = fmtRp(totalOmzet);
  document.getElementById('wStatKab').textContent   = new Set(data.map(r=>r.kabupaten).filter(Boolean)).size;
  document.getElementById('wStatProv').textContent  = new Set(data.map(r=>r.provinsi).filter(Boolean)).size;
}

function renderWilayahMap() {
  if (typeof L === 'undefined') return;
  if (!leafletMap) {
    leafletMap = L.map('wilayahMap', { zoomControl:true, scrollWheelZoom:false }).setView([-2.5,118],4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:18}).addTo(leafletMap);
  }
  // Force re-render tiles setelah layout berubah
  setTimeout(() => { leafletMap.invalidateSize(); leafletMap.setView([-2.5,118],4); }, 100);
  const provCount = {}, provOmzet = {};
  wilayahFilter.forEach(r => {
    if (!r.provinsi) return;
    const p = r.provinsi.trim().toUpperCase();
    provCount[p] = (provCount[p]||0)+(r.total_order||1);
    provOmzet[p] = (provOmzet[p]||0)+(r.total_pembayaran||0);
  });
  const maxCount = Math.max(...Object.values(provCount),1);
  if (geoLayer) { leafletMap.removeLayer(geoLayer); geoLayer=null; }

  fetch('https://raw.githubusercontent.com/superpikar/indonesia-geojson/master/indonesia.geojson')
    .then(r=>r.json()).then(geo=>{
      geoLayer = L.geoJSON(geo, {
        style: feature => {
          const name = (feature.properties.state||feature.properties.name||'').toUpperCase();
          const cnt = Object.keys(provCount).reduce((f,k)=>name.includes(k)||k.includes(name)?provCount[k]:f,0);
          const intensity = cnt/maxCount;
          return { fillColor: cnt>0?`rgba(124,111,247,${0.15+intensity*0.75})`:'rgba(124,111,247,0.05)', weight:1, color:'#7c6ff7', fillOpacity:1 };
        },
        onEachFeature: (feature, layer) => {
          const name = (feature.properties.state||feature.properties.name||'').toUpperCase();
          const cnt = Object.keys(provCount).reduce((f,k)=>name.includes(k)||k.includes(name)?provCount[k]:f,0);
          const omz = Object.keys(provOmzet).reduce((f,k)=>name.includes(k)||k.includes(name)?provOmzet[k]:f,0);
          layer.bindTooltip(`<b>${feature.properties.state||feature.properties.name}</b><br>${cnt} order · ${fmtRp(omz)}`,{sticky:true});
          layer.on('click', ()=>{
            const key = Object.keys(provCount).find(k=>name.includes(k)||k.includes(name));
            if (key) drillTo('kabupaten', key);
          });
        }
      }).addTo(leafletMap);
    }).catch(()=>{});
}

function renderWilayahTable() {
  let data = [...wilayahFilter];
  wilayahDrillStack.forEach(s => {
    data = data.filter(r => (r[s.level]||'').toLowerCase() === s.value.toLowerCase());
  });

  const level = wilayahDrillLevel;
  const groupMap = {};
  data.forEach(r => {
    const key = (r[level]||'').trim() || '(Tidak Ada Data)';
    if (!groupMap[key]) groupMap[key] = { order:0, omzet:0, delivered:0, rts:0, produkCount:{} };
    const qty = r.total_order||1;
    groupMap[key].order += qty;
    groupMap[key].omzet += r.total_pembayaran||0;
    const cls = classifyStatus(r.status);
    if (cls === 'delivered') groupMap[key].delivered += qty;
    else if (cls === 'rts')  groupMap[key].rts       += qty;
    if (r.produk) groupMap[key].produkCount[r.produk] = (groupMap[key].produkCount[r.produk]||0)+qty;
  });

  const sorted = Object.entries(groupMap).sort((a,b)=>b[1].order-a[1].order);
  const totalPages = Math.max(1, Math.ceil(sorted.length / WILAYAH_PAGE_SIZE));
  if (wilayahPage > totalPages) wilayahPage = 1;
  const pageData = sorted.slice((wilayahPage-1)*WILAYAH_PAGE_SIZE, wilayahPage*WILAYAH_PAGE_SIZE);

  const bcParts = ['Semua Provinsi', ...wilayahDrillStack.map(s=>s.value)];
  document.getElementById('wBreadcrumb').textContent = bcParts.join(' › ');
  document.getElementById('wBtnBack').style.display = wilayahDrillStack.length ? '' : 'none';

  const levelLabel = {provinsi:'Provinsi',kabupaten:'Kabupaten/Kota',kecamatan:'Kecamatan',kelurahan:'Kelurahan'};
  document.querySelector('#wilayahTable thead tr th').textContent = levelLabel[level]||level;

  const canDrill = level !== 'kelurahan';
  const nextLevel = {provinsi:'kabupaten',kabupaten:'kecamatan',kecamatan:'kelurahan'}[level];

  document.getElementById('wilayahTbody').innerHTML = pageData.map(([name,d])=>{
    const terlaris = Object.entries(d.produkCount).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
    const safeN    = name.replace(/'/g,"\\'");
    const pctDeliv = d.order ? Math.round(d.delivered/d.order*100) : 0;
    const pctRts   = d.order ? Math.round(d.rts/d.order*100) : 0;
    return `<tr style="cursor:${canDrill?'pointer':'default'}" ${canDrill?`onclick="drillTo('${nextLevel}','${safeN}')"`:''}>`+
      `<td style="font-weight:600">${canDrill?'▶ ':''}${name}</td>`+
      `<td style="font-weight:700">${d.order.toLocaleString()}</td>`+
      `<td><span style="color:#22c55e;font-weight:600">${d.delivered.toLocaleString()}</span> <span style="font-size:11px;color:var(--muted)">(${pctDeliv}%)</span></td>`+
      `<td><span style="color:#ef4444;font-weight:600">${d.rts.toLocaleString()}</span> <span style="font-size:11px;color:var(--muted)">(${pctRts}%)</span></td>`+
      `<td>${fmtRp(d.omzet)}</td>`+
      `<td><span class="badge b-purple">${terlaris}</span></td>`+
      `</tr>`;
  }).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px">Tidak ada data wilayah</td></tr>';

  // Pagination
  const pgWrap = document.getElementById('wPgWrap');
  if (totalPages <= 1) { pgWrap.innerHTML = ''; return; }
  let pg = '';
  pg += `<button class="pg-btn" ${wilayahPage===1?'disabled':''} onclick="wGoPage(${wilayahPage-1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && Math.abs(i - wilayahPage) > 2 && i !== 1 && i !== totalPages) {
      if (i === wilayahPage - 3 || i === wilayahPage + 3) pg += `<span class="pg-btn" style="pointer-events:none">…</span>`;
      continue;
    }
    pg += `<button class="pg-btn${i===wilayahPage?' active':''}" onclick="wGoPage(${i})">${i}</button>`;
  }
  pg += `<button class="pg-btn" ${wilayahPage===totalPages?'disabled':''} onclick="wGoPage(${wilayahPage+1})">›</button>`;
  pgWrap.innerHTML = pg;
}

function wGoPage(p) {
  wilayahPage = p;
  renderWilayahTable();
}

function drillTo(level, value) {
  wilayahDrillStack.push({ level: wilayahDrillLevel, value });
  wilayahDrillLevel = level;
  wilayahPage = 1;
  renderWilayahTable();
}

function drillUp() {
  if (!wilayahDrillStack.length) return;
  const prev = wilayahDrillStack.pop();
  wilayahDrillLevel = prev.level;
  wilayahPage = 1;
  renderWilayahTable();
}

// ─── helper: klasifikasi status pengiriman ───
function classifyStatus(s) {
  if (!s) return 'lainnya';
  const sl = s.toLowerCase();
  if (sl.includes('rts') || sl.includes('return') || sl.includes('retur') || sl.includes('kembali')) return 'rts';
  if (sl.includes('lunas') || sl.includes('selesai') || sl.includes('success') ||
      sl.includes('terkirim') || sl.includes('delivered') || sl.includes('diterima') || sl.includes('deliv')) return 'delivered';
  return 'lainnya';
}

// ─── helper: format rupiah lengkap (untuk PDF/Excel) ───
function fmtRpFull(val) {
  if (!val || isNaN(val)) return 'Rp 0';
  return 'Rp ' + Number(Math.round(val)).toLocaleString('id-ID');
}

// ─── helper: ambil data sesuai drill level + stack saat ini ───
function getCurrentViewData() {
  let data = [...wilayahFilter];
  wilayahDrillStack.forEach(s => {
    data = data.filter(r => (r[s.level]||'').toLowerCase() === s.value.toLowerCase());
  });
  const level = wilayahDrillLevel;
  const groupMap = {};
  data.forEach(r => {
    const key = (r[level]||'').trim() || '(Tidak Ada Data)';
    if (!groupMap[key]) groupMap[key] = { order:0, omzet:0, delivered:0, rts:0, produkCount:{} };
    const qty = r.total_order||1;
    groupMap[key].order += qty;
    groupMap[key].omzet += r.total_pembayaran||0;
    const cls = classifyStatus(r.status);
    if (cls === 'delivered') groupMap[key].delivered += qty;
    else if (cls === 'rts')  groupMap[key].rts       += qty;
    if (r.produk) groupMap[key].produkCount[r.produk] = (groupMap[key].produkCount[r.produk]||0)+qty;
  });
  return Object.entries(groupMap).sort((a,b)=>b[1].order-a[1].order).map(([name, d]) => {
    const terlaris = Object.entries(d.produkCount).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
    const avg = d.order ? Math.round(d.omzet/d.order) : 0;
    return { name, order: d.order, omzet: d.omzet, delivered: d.delivered, rts: d.rts, terlaris, avg };
  });
}

// ─── helper: agregasi per level (untuk Excel semua sheet) ───
function getWilayahLevelData(level) {
  const parentKey = { provinsi: null, kabupaten: 'provinsi', kecamatan: 'kabupaten', kelurahan: 'kecamatan' };
  const groupMap = {};
  wilayahFilter.forEach(r => {
    const key = (r[level]||'').trim();
    if (!key) return;
    const parent = parentKey[level] ? (r[parentKey[level]]||'') : null;
    if (!groupMap[key]) groupMap[key] = { order:0, omzet:0, delivered:0, rts:0, produkCount:{}, parent: parent||'' };
    const qty = r.total_order||1;
    groupMap[key].order += qty;
    groupMap[key].omzet += r.total_pembayaran||0;
    const cls = classifyStatus(r.status);
    if (cls === 'delivered') groupMap[key].delivered += qty;
    else if (cls === 'rts')  groupMap[key].rts       += qty;
    if (r.produk) groupMap[key].produkCount[r.produk] = (groupMap[key].produkCount[r.produk]||0)+qty;
  });
  return Object.entries(groupMap).sort((a,b)=>b[1].order-a[1].order).map(([name, d]) => {
    const terlaris = Object.entries(d.produkCount).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
    const avg = d.order ? Math.round(d.omzet/d.order) : 0;
    return { name, parent: d.parent, order: d.order, omzet: d.omzet, delivered: d.delivered, rts: d.rts, terlaris, avg };
  });
}

// ─── DOWNLOAD EXCEL ───
function downloadWilayahExcel() {
  if (!wilayahFilter.length) { toast('Tidak ada data untuk didownload', 'warn'); return; }

  const wb = XLSX.utils.book_new();
  const levels    = ['provinsi','kabupaten','kecamatan','kelurahan'];
  const labelMap  = { provinsi:'Provinsi', kabupaten:'Kabupaten-Kota', kecamatan:'Kecamatan', kelurahan:'Kelurahan' };
  const parentLbl = { provinsi:null, kabupaten:'Provinsi', kecamatan:'Kabupaten-Kota', kelurahan:'Kecamatan' };

  levels.forEach(level => {
    const rows = getWilayahLevelData(level).map(d => {
      const pctDeliv = d.order ? Math.round(d.delivered/d.order*100) : 0;
      const pctRts   = d.order ? Math.round(d.rts/d.order*100) : 0;
      const row = {};
      row[labelMap[level]]     = d.name;
      if (parentLbl[level]) row[parentLbl[level]] = d.parent;
      row['Total Order']       = d.order;
      row['Delivered']         = d.delivered;
      row['% Delivered']       = pctDeliv + '%';
      row['RTS']               = d.rts;
      row['% RTS']             = pctRts + '%';
      row['Total Pembayaran']  = d.omzet;
      row['Produk Terlaris']   = d.terlaris;
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    const colW = [{ wch:35 }];
    if (parentLbl[level]) colW.push({ wch:35 });
    colW.push({ wch:14 },{ wch:20 },{ wch:30 },{ wch:18 });
    ws['!cols'] = colW;
    XLSX.utils.book_append_sheet(wb, ws, labelMap[level]);
  });

  const fp = document.getElementById('wFilterProduk').value;
  const ft = document.getElementById('wFilterTeam').value;
  const fb = document.getElementById('wFilterBulan').value;
  const suffix = [fp, ft, fb].filter(Boolean).join('_') || 'Semua';

  try {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob  = new Blob([wbout], { type: 'application/octet-stream' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href = url;
    a.download = `Analisis_Wilayah_${suffix}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('✅ Excel berhasil didownload!');
  } catch(e) {
    toast('Gagal download Excel: ' + e.message, 'err');
  }
}

// ─── DOWNLOAD PDF ───
function downloadWilayahPDF() {
  if (!wilayahFilter.length) { toast('Tidak ada data untuk didownload', 'warn'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const levelLabel = { provinsi:'Provinsi', kabupaten:'Kabupaten/Kota', kecamatan:'Kecamatan', kelurahan:'Kelurahan' };
  const bcParts    = ['Semua Provinsi', ...wilayahDrillStack.map(s => s.value)];
  const fp = document.getElementById('wFilterProduk').value;
  const ft = document.getElementById('wFilterTeam').value;
  const fb = document.getElementById('wFilterBulan').value;
  const filterInfo = [fp && `Produk: ${fp}`, ft && `Team: ${ft}`, fb && `Bulan: ${fb}`].filter(Boolean).join('  |  ') || 'Semua Data';

  // Header
  doc.setFontSize(14); doc.setFont('helvetica','bold');
  doc.text('Laporan Analisis Wilayah — Product Analis', 14, 14);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text(`Level: ${levelLabel[wilayahDrillLevel]}   |   Lokasi: ${bcParts.join(' › ')}`, 14, 21);
  doc.text(`Filter: ${filterInfo}`, 14, 27);

  // Stats row
  const totalOrder = document.getElementById('wStatOrder').textContent;
  const totalOmzet = document.getElementById('wStatOmzet').textContent;
  const totalKab   = document.getElementById('wStatKab').textContent;
  const totalProv  = document.getElementById('wStatProv').textContent;
  doc.setFontSize(8); doc.setTextColor(100);
  doc.text(`Total Order: ${totalOrder}   Total Pembayaran: ${totalOmzet}   Kabupaten: ${totalKab}   Provinsi: ${totalProv}`, 14, 33);
  doc.setTextColor(0);

  // Table
  const rows = getCurrentViewData();
  doc.autoTable({
    startY: 37,
    head: [[ levelLabel[wilayahDrillLevel], 'Total Order', 'Delivered', '% Deliv', 'RTS', '% RTS', 'Total Pembayaran', 'Produk Terlaris' ]],
    body: rows.map(r => {
      const pctDeliv = r.order ? Math.round(r.delivered/r.order*100) : 0;
      const pctRts   = r.order ? Math.round(r.rts/r.order*100) : 0;
      return [
        r.name,
        r.order.toLocaleString('id-ID'),
        r.delivered.toLocaleString('id-ID'),
        pctDeliv + '%',
        r.rts.toLocaleString('id-ID'),
        pctRts + '%',
        fmtRpFull(r.omzet),
        r.terlaris,
      ];
    }),
    styles:             { fontSize: 8, cellPadding: 2.5 },
    headStyles:         { fillColor: [124,111,247], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245,244,255] },
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 22, halign: 'right' },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 18, halign: 'right' },
      5: { cellWidth: 14, halign: 'center' },
      6: { cellWidth: 38, halign: 'right' },
      7: { cellWidth: 'auto' },
    },
    margin: { left: 14, right: 14 }
  });

  // Footer tiap halaman
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5); doc.setTextColor(150);
    doc.text(
      `Halaman ${i} dari ${pageCount}   —   Dicetak: ${new Date().toLocaleDateString('id-ID')}`,
      14, doc.internal.pageSize.height - 7
    );
  }

  const suffix = [fp, ft, fb].filter(Boolean).join('_') || 'Semua';
  doc.save(`Analisis_Wilayah_${suffix}.pdf`);
  toast('✅ PDF berhasil didownload!');
}
