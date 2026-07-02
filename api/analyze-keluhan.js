export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { keluhanList } = req.body;
  if (!keluhanList?.length) return res.status(400).json({ error: 'keluhanList kosong' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY belum diset' });

  const prompt = `Kamu adalah analis kesehatan produk herbal Indonesia. Analisis daftar keluhan customer berikut.

Untuk setiap keluhan, berikan:
1. kategori: kategori utama keluhan (contoh: "Tulang & Sendi", "Pernapasan", "Pencernaan", "Reproduksi Pria", "Imunitas", "Metabolisme", "Kardiovaskular", "Kepala & Saraf", "Kulit", "Lainnya")
2. gejala: gejala utama dalam 2-4 kata
3. penyakit: 1-3 kemungkinan penyakit/kondisi yang relevan

Daftar keluhan:
${keluhanList.map((k, i) => `${i + 1}. ${k}`).join('\n')}

Jawab HANYA dalam format JSON array seperti ini, tanpa teks lain:
[
  {
    "keluhan": "teks keluhan asli",
    "kategori": "nama kategori",
    "gejala": "gejala utama",
    "penyakit": "Penyakit A, Penyakit B"
  }
]`;

  try {
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

    const result = JSON.parse(match[0]);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
