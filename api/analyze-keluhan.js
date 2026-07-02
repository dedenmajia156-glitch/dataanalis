export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { keluhanList } = req.body;
  if (!keluhanList?.length) return res.status(400).json({ error: 'keluhanList kosong' });

  const apiKey  = process.env.ANTHROPIC_API_KEY;
  const sbUrl   = process.env.SUPABASE_URL;
  const sbKey   = process.env.SUPABASE_ANON_KEY;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY belum diset' });

  // ── 1. Cek cache di Supabase via REST ──
  let cachedMap = {};
  if (sbUrl && sbKey) {
    try {
      const inList = keluhanList.map(k => k.replace(/,/g,' ')).join(',');
      const cacheRes = await fetch(
        `${sbUrl}/rest/v1/keluhan_ai_cache?select=keluhan,kategori,gejala,penyakit&keluhan=in.(${encodeURIComponent(inList)})`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      if (cacheRes.ok) {
        const cached = await cacheRes.json();
        (cached || []).forEach(r => { cachedMap[r.keluhan] = r; });
      }
    } catch(e) { /* skip cache error */ }
  }

  // ── 2. Pisah: sudah cache vs belum ──
  const needAI = keluhanList.filter(k => !cachedMap[k]);
  let aiResults = [];

  if (needAI.length) {
    const prompt = `Kamu adalah analis kesehatan produk herbal Indonesia. Analisis daftar keluhan customer berikut.

Untuk setiap keluhan, berikan:
1. kategori: kategori utama keluhan (contoh: "Tulang & Sendi", "Pernapasan", "Pencernaan", "Reproduksi Pria", "Imunitas", "Metabolisme", "Kardiovaskular", "Kepala & Saraf", "Kulit", "Lainnya")
2. gejala: gejala utama dalam 2-4 kata
3. penyakit: 1-3 kemungkinan penyakit/kondisi yang relevan

Daftar keluhan:
${needAI.map((k, i) => `${i + 1}. ${k}`).join('\n')}

Jawab HANYA dalam format JSON array seperti ini, tanpa teks lain:
[{"keluhan":"teks keluhan asli","kategori":"nama kategori","gejala":"gejala utama","penyakit":"Penyakit A, Penyakit B"}]`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(500).json({ error: 'Claude API error: ' + err });
    }

    const claudeData = await claudeRes.json();
    const text  = claudeData.content[0].text.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(500).json({ error: 'Format respons Claude tidak valid' });

    aiResults = JSON.parse(match[0]);

    // ── 3. Simpan ke cache via Supabase REST ──
    if (sbUrl && sbKey && aiResults.length) {
      const toInsert = aiResults.map(r => ({
        keluhan : r.keluhan,
        kategori: r.kategori || 'Lainnya',
        gejala  : r.gejala   || '—',
        penyakit: r.penyakit || '—',
      }));
      await fetch(`${sbUrl}/rest/v1/keluhan_ai_cache`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(toInsert),
      });
    }
  }

  // ── 4. Gabung cache + hasil baru ──
  const fromCache = Object.values(cachedMap).map(r => ({
    keluhan: r.keluhan, kategori: r.kategori, gejala: r.gejala, penyakit: r.penyakit,
  }));

  res.json({ result: [...fromCache, ...aiResults] });
}
