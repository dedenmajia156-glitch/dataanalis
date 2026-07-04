// ─────────────────────────────────────────────
// ANALISIS WILAYAH
// Uses globals from app.js: processedData, BULAN_NAMES, toast
// ─────────────────────────────────────────────

let wilayahFilter = [];
let wilayahDrillLevel = 'provinsi';
let wilayahDrillStack = [];
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
  const bulanSet = [...new Set(srcData.map(r=>r.tanggal?.slice(0,7)).filter(Boolean))].sort();
  document.getElementById('wFilterBulan').innerHTML = '<option value="">Semua</option>' +
    bulanSet.map(b => { const [y,m]=b.split('-'); return `<option value="${b}">${BULAN_NAMES[+m]} ${y}</option>`; }).join('');

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
  const totalOmzet = data.reduce((s,r)=>s+(r.total_pembayaran||0),0);
  document.getElementById('wStatOrder').textContent = data.length.toLocaleString();
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
  const provCount = {}, provOmzet = {};
  wilayahFilter.forEach(r => {
    if (!r.provinsi) return;
    const p = r.provinsi.trim().toUpperCase();
    provCount[p] = (provCount[p]||0)+1;
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
    if (!groupMap[key]) groupMap[key] = { order:0, omzet:0, produkCount:{} };
    groupMap[key].order++;
    groupMap[key].omzet += r.total_pembayaran||0;
    if (r.produk) groupMap[key].produkCount[r.produk] = (groupMap[key].produkCount[r.produk]||0)+1;
  });

  const sorted = Object.entries(groupMap).sort((a,b)=>b[1].order-a[1].order);
  const bcParts = ['Semua Provinsi', ...wilayahDrillStack.map(s=>s.value)];
  document.getElementById('wBreadcrumb').textContent = bcParts.join(' › ');
  document.getElementById('wBtnBack').style.display = wilayahDrillStack.length ? '' : 'none';

  const levelLabel = {provinsi:'Provinsi',kabupaten:'Kabupaten/Kota',kecamatan:'Kecamatan',kelurahan:'Kelurahan'};
  document.querySelector('#wilayahTable thead tr th').textContent = levelLabel[level]||level;

  const canDrill = level !== 'kelurahan';
  const nextLevel = {provinsi:'kabupaten',kabupaten:'kecamatan',kecamatan:'kelurahan'}[level];

  document.getElementById('wilayahTbody').innerHTML = sorted.map(([name,d])=>{
    const terlaris = Object.entries(d.produkCount).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
    const avg = d.order ? Math.round(d.omzet/d.order) : 0;
    const safeN = name.replace(/'/g,"\\'");
    return `<tr style="cursor:${canDrill?'pointer':'default'}" ${canDrill?`onclick="drillTo('${nextLevel}','${safeN}')"`:''}><td style="font-weight:600">${canDrill?'▶ ':''}${name}</td><td>${d.order.toLocaleString()}</td><td>${fmtRp(d.omzet)}</td><td><span class="badge b-purple">${terlaris}</span></td><td style="color:var(--muted)">${fmtRp(avg)}</td></tr>`;
  }).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:40px">Tidak ada data wilayah</td></tr>';
}

function drillTo(level, value) {
  wilayahDrillStack.push({ level: wilayahDrillLevel, value });
  wilayahDrillLevel = level;
  renderWilayahTable();
}

function drillUp() {
  if (!wilayahDrillStack.length) return;
  const prev = wilayahDrillStack.pop();
  wilayahDrillLevel = prev.level;
  renderWilayahTable();
}
