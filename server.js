require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|pdf/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static("public"));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      stardate NUMERIC(10,1) NOT NULL,
      title TEXT NOT NULL,
      entry TEXT NOT NULL,
      location TEXT DEFAULT 'Unknown Sector',
      attachment TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("Database initialized");
}

function generateStardate() {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 0);
  const diff = now - start;
  const oneDay = 86400000;
  const dayOfYear = Math.floor(diff / oneDay);
  const base = (year - 1987) * 1000;
  const sd = base + Math.round((dayOfYear / 365) * 1000) / 10;
  return sd.toFixed(1);
}

app.get("/api/stardate", (req, res) => {
  res.json({ stardate: generateStardate() });
});

app.get("/api/logs", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM logs ORDER BY created_at DESC");
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/logs/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM logs WHERE id=$1", [req.params.id]);
    rows.length ? res.json(rows[0]) : res.status(404).json({ error: "Log not found" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/logs", upload.single("attachment"), async (req, res) => {
  try {
    const { stardate, title, entry, location } = req.body;
    const attachment = req.file ? `/uploads/${req.file.filename}` : null;
    const { rows } = await pool.query(
      "INSERT INTO logs (stardate, title, entry, location, attachment) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [stardate, title, entry, location || "Unknown Sector", attachment]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/logs/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("DELETE FROM logs WHERE id=$1 RETURNING *", [req.params.id]);
    if (rows.length && rows[0].attachment) {
      const fp = path.join(UPLOAD_DIR, path.basename(rows[0].attachment));
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    rows.length ? res.json({ deleted: true }) : res.status(404).json({ error: "Not found" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Captain's Log running on port ${PORT}`));
});
