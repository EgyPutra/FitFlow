# FitFlow

Pelacak kebugaran: catat latihan, log makanan, dan tanya coach yang membaca data kamu.

**Zero dependencies.** Tidak ada `npm install`. Backend memakai modul bawaan Node saja (`node:http`, `node:sqlite`, `node:crypto`), frontend vanilla JS tanpa build step.

---

## Menjalankan

```bash
node server.js
```

Buka http://localhost:3000

Butuh **Node.js 22.5+** (untuk `node:sqlite`). Cek dengan `node --version`.

### Isi data demo (opsional)

```bash
node scripts/seed.js
```

Membuat akun berisi 70 hari riwayat latihan dan 30 hari catatan makan:

| | |
|---|---|
| Email | `demo@fitflow.app` |
| Password | `demo1234` |

---

## Fitur

**Summary** — activity rings (kalori / protein / langkah) di Canvas, grafik 7 hari, streak, insight harian.
**Workout** — 7 template rutin, log set/rep/beban, estimasi kalori otomatis via MET, riwayat + volume.
**Nutrition** — cari dari database atau input makanan secara manual. Makro dihitung ulang saat porsi diubah.
**Profile** — analisis 30 hari (tren volume vs periode sebelumnya), coach chat, 3 nada coach, target makro otomatis.

Target kalori & makro dihitung dari **Mifflin-St Jeor** + activity multiplier + penyesuaian goal. Bisa juga diisi manual.

---

## Environment variables

Semua opsional — jalan tanpa konfigurasi apa pun.

| Variable | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port server |
| `JWT_SECRET` | dev secret | **Wajib diganti di produksi** |
| `DATABASE_PATH` | `data/fitflow.db` | Lokasi file SQLite |
| `CORS_ORIGIN` | *(mati)* | Set kalau frontend beda domain |

Buat secret yang kuat:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Hosting

Database SQLite adalah **satu file**, jadi butuh **persistent disk** — bukan filesystem ephemeral. Kalau tidak, data hilang tiap deploy.

### Railway / Render / Fly.io

1. Push repo ini ke GitHub, hubungkan ke platform pilihan.
2. Start command: `node server.js`
3. Tambahkan **volume** dan mount, misal ke `/data`.
4. Set env:
   ```
   JWT_SECRET=<hasil generate di atas>
   DATABASE_PATH=/data/fitflow.db
   ```

Platform mengisi `PORT` otomatis — server sudah membacanya.

### VPS (systemd)

```ini
# /etc/systemd/system/fitflow.service
[Unit]
Description=FitFlow
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/fitflow
ExecStart=/usr/bin/node server.js
Environment=JWT_SECRET=ganti_ini
Environment=DATABASE_PATH=/var/lib/fitflow/fitflow.db
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now fitflow
```

Taruh di belakang Nginx/Caddy untuk HTTPS.

### Catatan penting

- **Backup** = salin file `.db` saja.

---

## API

Semua endpoint `/api/*`. Butuh header `Authorization: Bearer <token>` kecuali register/login/health.

| Method | Endpoint | Fungsi |
|---|---|---|
| POST | `/api/auth/register` | Daftar, balas token + user |
| POST | `/api/auth/login` | Masuk |
| GET | `/api/auth/me` | User saat ini |
| PUT | `/api/profile` | Update profil (+ hitung ulang makro) |
| GET | `/api/summary` | Data dashboard |
| PUT | `/api/stats/steps` | Simpan langkah |
| GET/POST | `/api/workouts` | List / buat latihan |
| GET/PUT/DELETE | `/api/workouts/:id` | Detail / ubah / hapus |
| GET/POST | `/api/routines` | Template rutin |
| DELETE | `/api/routines/:id` | Hapus rutin sendiri |
| GET | `/api/food/search?q=` | Cari makanan |
| POST | `/api/nutrition/log` | Catat makanan |
| GET | `/api/nutrition/daily?day=` | Makanan + total harian |
| DELETE | `/api/nutrition/:id` | Hapus catatan |
| GET/DELETE | `/api/coach/history` | Riwayat chat |
| POST | `/api/coach/chat` | Kirim pesan ke coach |
| POST | `/api/coach/analyze` | Analisis 30 hari |
| POST | `/api/coach/plan` | Rencana mingguan |
| GET | `/api/health` | Health check |

---

## Struktur

```
fitflow/
├── server.js              HTTP server, static files, router, rate limit
├── src/
│   ├── db.js              Skema SQLite + seed template rutin
│   ├── auth.js            scrypt hashing, JWT HS256, hitung makro
│   ├── ai.js              Mock AI  ← ganti di sini untuk Claude asli
│   └── routes.js          Semua handler REST
├── public/
│   ├── index.html         App shell
│   ├── app.css            Dark glass morphism, mobile-first
│   ├── app.js             Router, state, 4 halaman
│   └── manifest.webmanifest + ikon
├── scripts/seed.js        Data demo
└── data/fitflow.db        Database (dibuat otomatis)
```

## Keamanan

Sudah termasuk: password scrypt + salt, JWT ditandatangani HMAC, perbandingan timing-safe, parameterized query (anti SQL injection), escaping HTML di semua render (anti XSS), proteksi path traversal, rate limit 120 req/menit per IP, batas body 12 MB.

Sebelum produksi: **ganti `JWT_SECRET`** dan pakai HTTPS.
