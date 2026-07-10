// ─────────────────────────────────────────────
// CHARTS
// ─────────────────────────────────────────────
// Globals used from app.js: charts, normK, txtColor/gridColor helpers

const PAL = ['#7c6ff7','#38bdf8','#22c55e','#f59e0b','#ef4444','#fb923c',
             '#a78bfa','#34d399','#fb7185','#60a5fa','#f472b6','#4ade80',
             '#facc15','#e879f9','#fbbf24','#818cf8'];

const txtColor  = () => document.body.classList.contains('light') ? '#1a1f36' : '#e2e8f0';
const gridColor = () => document.body.classList.contains('light') ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';

function killChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function countMap(arr, fn) {
  const m = {};
  arr.forEach(x => { const k = fn(x); if(k) m[k] = (m[k]||0)+1; });
  return m;
}
function sorted(m, n=999) {
  return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

function renderCharts(data) {
  const wk = data.filter(r => r.keluhan.trim());

  // TOP 15 KELUHAN horizontal bar
  killChart('top');
  const km = countMap(wk, r => normK(r.keluhan));
  const topK = sorted(km, 15);
  if (topK.length) {
    charts['top'] = new Chart(document.getElementById('chartTop').getContext('2d'), {
      type: 'bar',
      data: {
        labels: topK.map(([k]) => k.length>45 ? k.slice(0,45)+'…' : k),
        datasets: [{
          data: topK.map(([,v])=>v),
          backgroundColor: topK.map((_,i) => PAL[i%PAL.length]+'bb'),
          borderColor: topK.map((_,i) => PAL[i%PAL.length]),
          borderWidth: 1.5, borderRadius: 5,
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: { anchor:'end', align:'end', color: txtColor(), font:{size:11,weight:'bold'} }
        },
        scales: {
          x: { ticks:{color:txtColor(),font:{size:11},stepSize:1,precision:0}, grid:{color:gridColor()}, min:0 },
          y: { ticks:{color:txtColor(),font:{size:11}}, grid:{display:false} }
        }
      },
      plugins: [ChartDataLabels]
    });
  }

  // DONUT distribusi per produk
  killChart('pie');
  const pm = countMap(wk, r => r.produk || 'Lainnya');
  const topP = sorted(pm, 8);
  if (topP.length) {
    charts['pie'] = new Chart(document.getElementById('chartPie').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: topP.map(([k])=>k),
        datasets: [{
          data: topP.map(([,v])=>v),
          backgroundColor: topP.map((_,i)=>PAL[i%PAL.length]+'bb'),
          borderColor: topP.map((_,i)=>PAL[i%PAL.length]),
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: {
          legend: { position:'right', labels:{color:txtColor(),font:{size:11},padding:10,boxWidth:12} },
          datalabels: {
            formatter:(v,c)=>{
              const t = c.dataset.data.reduce((a,b)=>a+b,0);
              return Math.round(v/t*100)+'%';
            },
            color:'#fff', font:{size:10,weight:'bold'}
          }
        }
      },
      plugins: [ChartDataLabels]
    });
  }

  // STACKED per produk × top keluhan
  killChart('stacked');
  const prodList = sorted(pm, 7).map(([k])=>k);
  const kelList  = sorted(km, 7).map(([k])=>k);
  if (prodList.length && kelList.length) {
    charts['stacked'] = new Chart(document.getElementById('chartStacked').getContext('2d'), {
      type: 'bar',
      data: {
        labels: prodList,
        datasets: kelList.map((kel,i) => ({
          label: kel.length>25 ? kel.slice(0,25)+'…' : kel,
          data: prodList.map(p => wk.filter(r=>r.produk===p && normK(r.keluhan)===kel).length),
          backgroundColor: PAL[i%PAL.length]+'bb',
          borderColor: PAL[i%PAL.length],
          borderWidth: 1, borderRadius: 3,
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels:{color:txtColor(),font:{size:11},padding:10} },
          datalabels: { display: false }
        },
        scales: {
          x: { stacked:true, ticks:{color:txtColor()}, grid:{display:false} },
          y: { stacked:true, ticks:{color:txtColor()}, grid:{color:gridColor()} }
        }
      }
    });
  }
}

// ─────────────────────────────────────────────
// RANK LIST
// ─────────────────────────────────────────────
function renderRank(data) {
  const wk  = data.filter(r => r.keluhan.trim());
  const km  = countMap(wk, r => normK(r.keluhan));
  const top = sorted(km, 15);
  const max = top[0]?.[1] || 1;
  document.getElementById('rankList').innerHTML = top.map(([kel,cnt],i) => {
    const cls = i===0?'rn-1':i===1?'rn-2':i===2?'rn-3':'rn-x';
    const prods = [...new Set(wk.filter(r=>normK(r.keluhan)===kel).map(r=>r.produk))].join(', ');
    return `<div class="rank-item">
      <div class="rank-no ${cls}">${i+1}</div>
      <div class="rank-info">
        <div class="rank-text" title="${kel}">${kel}</div>
        <div class="rank-meta">${prods||'—'}</div>
      </div>
      <div class="rank-bar-outer"><div class="rank-bar-inner" style="width:${Math.round(cnt/max*100)}%"></div></div>
      <div class="rank-cnt">${cnt}</div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// TABLE
// ─────────────────────────────────────────────
function renderTable(data, page) {
  const wk    = data.filter(r => r.keluhan.trim());
  const start = (page-1)*PAGE_SIZE;
  const rows  = wk.slice(start, start+PAGE_SIZE);

  document.getElementById('tableBody').innerHTML = rows.map((r,i) => `
    <tr>
      <td style="color:var(--muted)">${start+i+1}</td>
      <td>${r.tanggal||'—'}</td>
      <td>${r.nama||'—'}</td>
      <td><span class="badge b-purple">${r.produk||'—'}</span></td>
      <td style="max-width:260px;word-break:break-word">${r.keluhan}</td>
      <td>${r.team||'—'}</td>
      <td>${r.cs||'—'}</td>
      <td>${badgeStatus(r.status)}</td>
      <td style="font-size:12px;color:var(--muted);white-space:nowrap">${r.resi||'—'}</td>
    </tr>`).join('');

  renderPagination(wk.length, page);
}

function renderPagination(total, page) {
  const totalPages = Math.ceil(total/PAGE_SIZE);
  const pg = document.getElementById('pgWrap');
  pg.innerHTML = '';
  if (totalPages <= 1) return;

  const range = [];
  if (totalPages <= 7) {
    for (let i=1;i<=totalPages;i++) range.push(i);
  } else {
    range.push(1);
    if (page > 3) range.push('…');
    for (let i=Math.max(2,page-1);i<=Math.min(totalPages-1,page+1);i++) range.push(i);
    if (page < totalPages-2) range.push('…');
    range.push(totalPages);
  }
  range.forEach(p => {
    if (p==='…') { pg.innerHTML += `<span style="color:var(--muted);padding:0 4px">…</span>`; return; }
    pg.innerHTML += `<button class="pg-btn ${p===page?'active':''}" onclick="changePage(${p})">${p}</button>`;
  });
  pg.innerHTML += `<span class="pg-info">${total.toLocaleString()} keluhan</span>`;
}

function changePage(p) {
  currentPage = p;
  renderTable(currentFilter, p);
  document.querySelector('.table-card').scrollIntoView({behavior:'smooth',block:'start'});
}

function badgeStatus(s) {
  if (!s) return '—';
  const sl = s.toLowerCase();
  if (sl.includes('lunas')||sl.includes('selesai')||sl.includes('success')) return `<span class="badge b-green">${s}</span>`;
  if (sl.includes('batal')||sl.includes('cancel')||sl.includes('retur'))   return `<span class="badge b-red">${s}</span>`;
  if (sl.includes('proses')||sl.includes('pending'))                        return `<span class="badge b-yellow">${s}</span>`;
  return `<span class="badge b-blue">${s}</span>`;
}

// ─────────────────────────────────────────────
// AI RESULT RENDER
// ─────────────────────────────────────────────
function renderAIResult(data) {
  const res = document.getElementById('aiResult');
  if (!Object.keys(aiResultMap).length) return;

  // Hitung per kategori
  const katCount = {};
  const katKeluhan = {};
  data.filter(r=>r.keluhan.trim()).forEach(r => {
    const ai = aiResultMap[normK(r.keluhan)];
    const kat = ai?.kategori || 'Lainnya';
    katCount[kat]   = (katCount[kat]   || 0) + 1;
    if (!katKeluhan[kat]) katKeluhan[kat] = new Set();
    katKeluhan[kat].add(normK(r.keluhan));
  });

  const sortedKat = Object.entries(katCount).sort((a,b)=>b[1]-a[1]);

  // Kategori cards
  const cards = sortedKat.map(([kat, cnt]) => {
    const col = katColor(kat);
    return `<div class="ai-kat-card" style="border-left:3px solid ${col}">
      <div class="ai-kat-name">${kat}</div>
      <div class="ai-kat-count" style="color:${col}">${cnt}</div>
      <div class="ai-kat-sub">${katKeluhan[kat].size} jenis keluhan</div>
    </div>`;
  }).join('');

  // Detail table — unique keluhan dengan AI info
  const uniqueRows = [...new Set(data.filter(r=>r.keluhan.trim()).map(r=>normK(r.keluhan)))]
    .map(k => ({ keluhan: k, cnt: data.filter(r=>normK(r.keluhan)===k).length, ai: aiResultMap[k] }))
    .filter(r => r.ai)
    .sort((a,b) => b.cnt - a.cnt);

  const tableRows = uniqueRows.map((r,i) => {
    const col = katColor(r.ai.kategori);
    return `<tr>
      <td style="color:var(--muted)">${i+1}</td>
      <td style="max-width:200px;word-break:break-word">${r.keluhan}</td>
      <td><span class="kat-badge" style="background:${col}22;color:${col}">${r.ai.kategori}</span></td>
      <td style="font-size:12px">${r.ai.gejala}</td>
      <td style="font-size:12px;color:var(--muted)">${r.ai.penyakit}</td>
      <td style="font-weight:700;color:var(--accent)">${r.cnt}</td>
    </tr>`;
  }).join('');

  res.innerHTML = `
    <div class="ai-kategori-grid">${cards}</div>
    <div style="padding:0 20px 20px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);margin-bottom:12px">Detail per Keluhan</div>
      <div class="ai-detail-wrap">
        <table>
          <thead><tr>
            <th>#</th><th>Keluhan</th><th>Kategori</th><th>Gejala Utama</th><th>Kemungkinan Penyakit</th><th>Jumlah</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
// DOWNLOAD PDF
// ─────────────────────────────────────────────
function downloadAIPDF() {
  if (!Object.keys(aiResultMap).length) { toast('⚠️ Jalankan analisis AI dulu', 'warn'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const batchName = document.getElementById('sb-file').textContent || 'Keluhan';
  const now = new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });

  // ── HEADER ──
  doc.setFillColor(124, 111, 247);
  doc.rect(0, 0, 297, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Laporan Analisis Keluhan — Adsy', 14, 12);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(batchName + '  |  ' + now, 297 - 14, 12, { align: 'right' });

  // ── SUMMARY KATEGORI ──
  const wk = currentFilter.filter(r => r.keluhan.trim());
  const katCount = {};
  wk.forEach(r => {
    const ai  = aiResultMap[normK(r.keluhan)];
    const kat = ai?.kategori || 'Lainnya';
    katCount[kat] = (katCount[kat] || 0) + 1;
  });
  const sortedKat = Object.entries(katCount).sort((a,b) => b[1]-a[1]);

  doc.setTextColor(30, 30, 50);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Ringkasan Kategori', 14, 27);

  // Summary table kategori
  doc.autoTable({
    startY: 30,
    head: [['Kategori', 'Jumlah Keluhan', '%']],
    body: sortedKat.map(([kat, cnt]) => [
      kat,
      cnt.toString(),
      Math.round(cnt / wk.length * 100) + '%'
    ]),
    theme: 'grid',
    headStyles: { fillColor: [124, 111, 247], textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [245, 245, 255] },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
    margin: { left: 14, right: 14 },
    tableWidth: 100,
  });

  // ── DETAIL TABLE ──
  const detailY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Detail Keluhan — Kategori, Gejala & Kemungkinan Penyakit', 14, detailY);

  const uniqueRows = [...new Set(wk.map(r => normK(r.keluhan)))]
    .map(k => ({ keluhan: k, cnt: wk.filter(r => normK(r.keluhan) === k).length, ai: aiResultMap[k] }))
    .filter(r => r.ai)
    .sort((a, b) => b.cnt - a.cnt);

  doc.autoTable({
    startY: detailY + 3,
    head: [['#', 'Keluhan', 'Kategori', 'Gejala Utama', 'Kemungkinan Penyakit', 'Jml']],
    body: uniqueRows.map((r, i) => [
      i + 1,
      r.keluhan,
      r.ai.kategori,
      r.ai.gejala,
      r.ai.penyakit,
      r.cnt,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [30, 30, 50], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 248, 255] },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      1: { cellWidth: 60 },
      2: { cellWidth: 38 },
      3: { cellWidth: 45 },
      4: { cellWidth: 95 },
      5: { cellWidth: 12, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
    didParseCell(data) {
      if (data.column.index === 2 && data.section === 'body') {
        const col = katColor(data.cell.text[0]);
        const rgb = hexToRgb(col);
        if (rgb) data.cell.styles.textColor = rgb;
      }
    }
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Halaman ${i} dari ${pageCount}  —  Generated by Product Analis Adsy`, 297 / 2, 205, { align: 'center' });
  }

  doc.save(`Analisis-Keluhan-${batchName}-${now}.pdf`);
  toast('✅ PDF berhasil didownload!');
}

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? [parseInt(r[1],16), parseInt(r[2],16), parseInt(r[3],16)] : null;
}
