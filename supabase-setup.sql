-- ============================================================
-- ANALISIS KELUHAN — Supabase Setup
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- Table: batch upload
CREATE TABLE IF NOT EXISTS keluhan_uploads (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_name   TEXT NOT NULL,
  total_rows   INTEGER DEFAULT 0,
  uploaded_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: data keluhan per baris
CREATE TABLE IF NOT EXISTS keluhan_data (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id     UUID REFERENCES keluhan_uploads(id) ON DELETE CASCADE,
  tanggal      DATE,
  nama         TEXT,
  produk       TEXT,
  keluhan      TEXT,
  team         TEXT,
  cs           TEXT,
  status_akhir TEXT,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_keluhan_produk  ON keluhan_data(produk);
CREATE INDEX IF NOT EXISTS idx_keluhan_tanggal ON keluhan_data(tanggal);
CREATE INDEX IF NOT EXISTS idx_keluhan_batch   ON keluhan_data(batch_id);

-- RLS (opsional, aktifkan kalau pakai auth)
-- ALTER TABLE keluhan_uploads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE keluhan_data    ENABLE ROW LEVEL SECURITY;

-- Contoh view: top keluhan per produk
CREATE OR REPLACE VIEW v_top_keluhan_per_produk AS
SELECT
  produk,
  keluhan,
  COUNT(*) AS jumlah
FROM keluhan_data
WHERE keluhan IS NOT NULL AND keluhan <> ''
GROUP BY produk, keluhan
ORDER BY produk, jumlah DESC;
