import express from "express";
import session from "express-session";
import multer from "multer";
import QRCode from "qrcode";
import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;
const DATA = join(__dirname, "data");
const MENU_PATH = join(DATA, "menu.json");
const ORDERS_PATH = join(DATA, "orders.json");
const TABLES_PATH = join(DATA, "tables.json");
const CONFIG_PATH = join(DATA, "config.json");
const IMG_DIR = join(__dirname, "public", "img");
const VIEWS = join(__dirname, "views"); // public dışı: auth'suz erişilemez

// --- Basit JSON dosya yardımcıları ---
const oku = (p, varsayilan) => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : varsayilan;
  } catch {
    return varsayilan;
  }
};
const yaz = (p, veri) => {
  try {
    writeFileSync(p, JSON.stringify(veri, null, 2));
  } catch (e) {
    console.error("Yazma hatası:", p, e.message);
  }
};

// --- Ayarlar (şifre burada; yoksa varsayılanla oluşturulur) ---
let config = oku(CONFIG_PATH, null);
if (!config) {
  config = { adminSifre: "admin123", siteAdi: "Suat Usta Tantuni" };
  yaz(CONFIG_PATH, config);
}

// --- Siparişler ---
let orders = oku(ORDERS_PATH, []);
let nextId = orders.reduce((m, o) => Math.max(m, o.id), 0) + 1;
const kaydetOrders = () => yaz(ORDERS_PATH, orders);

// --- Masalar ---
let tables = oku(TABLES_PATH, null);
if (!tables) {
  tables = [1, 2, 3, 4, 5].map((n) => ({ id: n, ad: String(n) }));
  yaz(TABLES_PATH, tables);
}
const kaydetTables = () => yaz(TABLES_PATH, tables);

// --- Middleware ---
app.use(express.json());
app.use(
  session({
    secret: "qr-siparis-gizli-anahtar-degistir",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 saat
  })
);
app.use(express.static(join(__dirname, "public")));

// Admin koruması: giriş yoksa engelle
const girisGerekli = (req, res, next) => {
  if (req.session?.giris) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Giriş gerekli" });
  return res.redirect("/admin/login");
};

// Görsel yükleme (multer)
const upload = multer({
  storage: multer.diskStorage({
    destination: IMG_DIR,
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, "urun-" + Date.now() + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// ============ MÜŞTERİ (açık) ============
app.get("/", (_req, res) => res.sendFile(join(__dirname, "public", "index.html")));

app.get("/api/menu", (_req, res) => res.json(oku(MENU_PATH, { urunler: [] })));

app.post("/api/order", (req, res) => {
  const { masa, urunler, not } = req.body || {};
  if (!masa || !Array.isArray(urunler) || urunler.length === 0) {
    return res.status(400).json({ error: "Masa ve en az bir ürün gerekli" });
  }
  const items = urunler.map((u) => ({
    ad: String(u.ad || "").slice(0, 100),
    adet: Math.max(1, parseInt(u.adet, 10) || 1),
    fiyat: Number(u.fiyat) || 0,
  }));
  const order = {
    id: nextId++,
    masa: String(masa).slice(0, 20),
    urunler: items,
    not: String(not || "").slice(0, 300),
    toplam: items.reduce((s, i) => s + i.fiyat * i.adet, 0),
    durum: "yeni",
    tarih: new Date().toISOString(),
  };
  orders.push(order);
  kaydetOrders();
  io.emit("newOrder", order);
  res.status(201).json({ ok: true, id: order.id });
});

// ============ ADMIN GİRİŞ ============
app.get("/admin/login", (req, res) => {
  if (req.session?.giris) return res.redirect("/admin");
  res.sendFile(join(VIEWS, "login.html"));
});
app.post("/admin/login", (req, res) => {
  if ((req.body?.sifre || "") === config.adminSifre) {
    req.session.giris = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Şifre hatalı" });
});
app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ============ ADMIN (korumalı) ============
app.get("/admin", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "siparisler.html")));
app.get("/admin/menu", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "menu.html")));
app.get("/admin/masalar", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "masalar.html")));
app.get("/admin/rapor", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "rapor.html")));

// --- Menü yönetimi ---
app.get("/api/admin/menu", girisGerekli, (_req, res) => res.json(oku(MENU_PATH, { urunler: [] })));

app.post("/api/admin/menu/urun", girisGerekli, (req, res) => {
  const menu = oku(MENU_PATH, { urunler: [] });
  const { id, ad, kategori, fiyat, aciklama, resim } = req.body || {};
  if (!ad || !kategori || fiyat == null) return res.status(400).json({ error: "Ad, kategori ve fiyat zorunlu" });
  if (id) {
    const u = menu.urunler.find((x) => x.id === id);
    if (!u) return res.status(404).json({ error: "Ürün bulunamadı" });
    Object.assign(u, { ad, kategori, fiyat: Number(fiyat), aciklama: aciklama || "" });
    if (resim) u.resim = resim;
  } else {
    const yeniId = menu.urunler.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    menu.urunler.push({ id: yeniId, ad, kategori, fiyat: Number(fiyat), aciklama: aciklama || "", resim: resim || "" });
  }
  yaz(MENU_PATH, menu);
  res.json({ ok: true });
});

app.delete("/api/admin/menu/urun/:id", girisGerekli, (req, res) => {
  const menu = oku(MENU_PATH, { urunler: [] });
  menu.urunler = menu.urunler.filter((x) => x.id !== Number(req.params.id));
  yaz(MENU_PATH, menu);
  res.json({ ok: true });
});

// Görsel yükleme → kaydedilen dosyanın yolunu döner
app.post("/api/admin/upload", girisGerekli, upload.single("gorsel"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Geçerli bir görsel seçin" });
  res.json({ ok: true, resim: "img/" + req.file.filename });
});

// --- Masa yönetimi ---
app.get("/api/admin/tables", girisGerekli, (_req, res) => res.json(tables));
app.post("/api/admin/tables", girisGerekli, (req, res) => {
  const ad = String(req.body?.ad || "").trim().slice(0, 20);
  if (!ad) return res.status(400).json({ error: "Masa adı gerekli" });
  if (tables.some((t) => t.ad === ad)) return res.status(400).json({ error: "Bu masa zaten var" });
  const id = tables.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  tables.push({ id, ad });
  kaydetTables();
  res.json({ ok: true });
});
app.delete("/api/admin/tables/:id", girisGerekli, (req, res) => {
  tables = tables.filter((t) => t.id !== Number(req.params.id));
  kaydetTables();
  res.json({ ok: true });
});

// QR üret (verilen url için PNG data URL)
app.get("/api/admin/qr", girisGerekli, async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ error: "url gerekli" });
    const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });
    res.json({ ok: true, dataUrl });
  } catch {
    res.status(500).json({ error: "QR üretilemedi" });
  }
});

// --- Satış raporu (bugün / bu hafta / bu ay) ---
app.get("/api/report", girisGerekli, (_req, res) => {
  const now = new Date();
  const gunBasi = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const gun = now.getDay();
  const haftaBasi = new Date(gunBasi);
  haftaBasi.setDate(gunBasi.getDate() - (gun === 0 ? 6 : gun - 1));
  const ayBasi = new Date(now.getFullYear(), now.getMonth(), 1);

  const ozet = (baslangic) => {
    const filt = orders.filter((o) => new Date(o.tarih) >= baslangic);
    const map = new Map();
    let ciro = 0;
    for (const o of filt) {
      ciro += o.toplam;
      for (const u of o.urunler) {
        const k = map.get(u.ad) || { ad: u.ad, adet: 0, ciro: 0 };
        k.adet += u.adet;
        k.ciro += u.fiyat * u.adet;
        map.set(u.ad, k);
      }
    }
    return { ciro, siparis: filt.length, urunler: [...map.values()].sort((a, b) => b.adet - a.adet) };
  };
  res.json({ gunluk: ozet(gunBasi), haftalik: ozet(haftaBasi), aylik: ozet(ayBasi) });
});

// ============ SOCKET.IO ============
io.on("connection", (socket) => {
  socket.emit("initOrders", orders.filter((o) => o.durum !== "hazir"));
  socket.on("markDone", (id) => {
    const o = orders.find((x) => x.id === id);
    if (o) {
      o.durum = "hazir";
      kaydetOrders();
      io.emit("orderUpdated", { id, durum: "hazir" });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n  QR Sipariş sistemi çalışıyor:`);
  console.log(`   Müşteri menü : http://localhost:${PORT}/?masa=1`);
  console.log(`   Admin panel  : http://localhost:${PORT}/admin  (şifre: ${config.adminSifre})\n`);
});
