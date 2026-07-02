import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { keluhanList } = req.body;
  if (!keluhanList?.length) return res.status(400).json({ error: 'keluhanList kosong' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY belum diset' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // ── 1. Cek cache di Supabase ──
  const { data: cached } = await sb
    .from('keluhan_ai_cache')
    .select('keluhan, kategori, gejala, penyakit')
    .in('keluhan', keluhanList);

  const cachedMap = {};
  (cached || []).forEach(r => { cachedMap[r.keluhan] = r; });

  // ── 2. Pisah: sudah ada di cache vs belum ──
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
[
  {
    "keluhan": "teks keluhan asli",
    "kategori": "nama kategori",
    "gejala": "gejala utama",
    "penyakit": "Penyakit A, Penyakit B"
  }
]`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
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

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'Claude API error: ' + err });
    }

    const data  = await response.json();
    const text  = data.content[0].text.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(500).json({ error: 'Format respons tidak valid' });

    aiResults = JSON.parse(match[0]);

    // ── 3. Simpan hasil baru ke cache ──
    const toInsert = aiResults.map(r => ({
      keluhan : r.keluhan,
      kategori: r.kategori || 'Lainnya',
      gejala  : r.gejala   || '—',
      penyakit: r.penyakit || '—',
    }));
    if (toInsert.length) {
      await sb.from('keluhan_ai_cache').upsert(toInsert, { onConflict: 'keluhan' });
    }
  }

  // ── 4. Gabung cache + hasil baru ──
  const allCached = Object.values(cachedMap).map(r => ({
    keluhan : r.keluhan,
    kategori: r.kategori,
    gejala  : r.gejala,
    penyakit: r.penyakit,
  }));

  res.json({ result: [...allCached, ...aiResults] });
}
