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

const kalemleriDuzenle = (urunler) =>
  urunler.map((u) => ({
    id: Number(u.id) || null,
    ad: String(u.ad || "").slice(0, 100),
    porsiyon: u.porsiyon ? String(u.porsiyon).slice(0, 60) : null,
    cikarilan: Array.isArray(u.cikarilan)
      ? u.cikarilan.slice(0, 10).map((x) => String(x).slice(0, 40))
      : [],
    eklenen: Array.isArray(u.eklenen)
      ? u.eklenen.slice(0, 10).map((e) => ({ ad: String(e.ad || "").slice(0, 40), fiyat: Number(e.fiyat) || 0 }))
      : [],
    adet: Math.max(1, parseInt(u.adet, 10) || 1),
    fiyat: Number(u.fiyat) || 0,
  }));
// Admin'e giden kopyada gizli token'ı sızdırma
const gizle = (o) => { const { token, ...rest } = o; return rest; };

app.post("/api/order", (req, res) => {
  const { masa, urunler, not } = req.body || {};
  if (!masa || !Array.isArray(urunler) || urunler.length === 0) {
    return res.status(400).json({ error: "Masa ve en az bir ürün gerekli" });
  }
  const items = kalemleriDuzenle(urunler);
  const masaAd = String(masa).slice(0, 20);
  // Bu masanın bugünkü kaçıncı siparişi?
  const bugunBasi = new Date(); bugunBasi.setHours(0, 0, 0, 0);
  const masaBugunAdet = orders.filter((x) => x.masa === masaAd && new Date(x.tarih) >= bugunBasi).length;
  const order = {
    id: nextId++,
    token: crypto.randomUUID(), // sadece sipariş sahibinin düzenleyebilmesi için
    masa: masaAd,
    siraNo: masaBugunAdet + 1, // masa bazlı günlük sıra
    urunler: items,
    not: String(not || "").slice(0, 300),
    toplam: items.reduce((s, i) => s + i.fiyat * i.adet, 0),
    durum: "yeni",
    tarih: new Date().toISOString(),
  };
  orders.push(order);
  kaydetOrders();
  io.emit("newOrder", gizle(order));
  res.status(201).json({ ok: true, id: order.id, token: order.token });
});

// Müşteri kendi siparişini görür (durum kontrolü için)
app.get("/api/order/:id", (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Sipariş bulunamadı" });
  res.json({ id: o.id, masa: o.masa, urunler: o.urunler, not: o.not, toplam: o.toplam, durum: o.durum });
});

// Müşteri siparişini düzenler — sadece "yeni" durumdayken ve doğru token ile
app.put("/api/order/:id", (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Sipariş bulunamadı" });
  if ((req.body?.token || "") !== o.token) return res.status(403).json({ error: "Yetki yok" });
  if (o.durum !== "yeni") return res.status(409).json({ error: "Sipariş hazırlanıyor, artık düzenlenemez" });
  const { urunler, not } = req.body || {};
  if (!Array.isArray(urunler) || urunler.length === 0) return res.status(400).json({ error: "En az bir ürün gerekli" });
  o.urunler = kalemleriDuzenle(urunler);
  o.not = String(not || "").slice(0, 300);
  o.toplam = o.urunler.reduce((s, i) => s + i.fiyat * i.adet, 0);
  kaydetOrders();
  io.emit("orderChanged", gizle(o));
  res.json({ ok: true });
});

// Müşteri siparişini iptal eder — sadece "yeni" durumdayken ve doğru token ile
app.delete("/api/order/:id", (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Sipariş bulunamadı" });
  if ((req.body?.token || "") !== o.token) return res.status(403).json({ error: "Yetki yok" });
  if (o.durum !== "yeni") return res.status(409).json({ error: "Sipariş hazırlanıyor, iptal edilemez" });
  orders = orders.filter((x) => x.id !== o.id);
  kaydetOrders();
  io.emit("orderRemoved", { id: o.id });
  res.json({ ok: true });
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
app.get("/admin/gecmis", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "gecmis.html")));

// --- Menü yönetimi ---
app.get("/api/admin/menu", girisGerekli, (_req, res) => res.json(oku(MENU_PATH, { urunler: [] })));

app.post("/api/admin/menu/urun", girisGerekli, (req, res) => {
  const menu = oku(MENU_PATH, { urunler: [] });
  const g = req.body || {};
  if (!g.ad || !g.kategori || g.fiyat == null) return res.status(400).json({ error: "Ad, kategori ve fiyat zorunlu" });

  const temel = {
    ad: String(g.ad).slice(0, 100),
    kategori: String(g.kategori).slice(0, 50),
    fiyat: Number(g.fiyat) || 0,
    aciklama: g.aciklama ? String(g.aciklama).slice(0, 200) : "",
    kalori: g.kalori ? String(g.kalori).slice(0, 30) : "",
  };
  const porsiyonlar = Array.isArray(g.porsiyonlar)
    ? g.porsiyonlar
        .map((p) => ({ ad: String(p.ad || "").slice(0, 60), fiyat: Number(p.fiyat) || 0, kalori: String(p.kalori || "").slice(0, 30) }))
        .filter((p) => p.ad)
    : [];
  const cikarilabilir = Array.isArray(g.cikarilabilir)
    ? g.cikarilabilir.map((x) => String(x).slice(0, 40)).filter(Boolean)
    : [];
  const eklenebilir = Array.isArray(g.eklenebilir)
    ? g.eklenebilir
        .map((e) => ({ ad: String(e.ad || "").slice(0, 40), fiyat: Number(e.fiyat) || 0 }))
        .filter((e) => e.ad)
    : [];

  if (g.id) {
    const u = menu.urunler.find((x) => x.id === Number(g.id));
    if (!u) return res.status(404).json({ error: "Ürün bulunamadı" });
    // eski alanları temizle (id + resim hariç), sonra yeniden yaz
    Object.keys(u).forEach((k) => { if (k !== "id" && k !== "resim") delete u[k]; });
    Object.assign(u, temel);
    if (g.resim) u.resim = g.resim;
    if (u.resim === undefined) u.resim = "";
    if (porsiyonlar.length) u.porsiyonlar = porsiyonlar;
    if (cikarilabilir.length) u.cikarilabilir = cikarilabilir;
    if (eklenebilir.length) u.eklenebilir = eklenebilir;
  } else {
    const yeniId = menu.urunler.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    const yeni = { id: yeniId, ...temel, resim: g.resim || "" };
    if (porsiyonlar.length) yeni.porsiyonlar = porsiyonlar;
    if (cikarilabilir.length) yeni.cikarilabilir = cikarilabilir;
    if (eklenebilir.length) yeni.eklenebilir = eklenebilir;
    menu.urunler.push(yeni);
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
        const etiket = u.porsiyon ? `${u.ad} (${u.porsiyon})` : u.ad;
        const k = map.get(etiket) || { ad: etiket, adet: 0, ciro: 0 };
        k.adet += u.adet;
        k.ciro += u.fiyat * u.adet;
        map.set(etiket, k);
      }
    }
    return { ciro, siparis: filt.length, urunler: [...map.values()].sort((a, b) => b.adet - a.adet) };
  };
  res.json({ gunluk: ozet(gunBasi), haftalik: ozet(haftaBasi), aylik: ozet(ayBasi) });
});

// Günün geçmiş siparişleri (bugün, tüm durumlar)
app.get("/api/admin/gecmis", girisGerekli, (_req, res) => {
  const now = new Date();
  const gunBasi = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const bugun = orders
    .filter((o) => new Date(o.tarih) >= gunBasi)
    .map(gizle)
    .sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  res.json({ siparisler: bugun, adet: bugun.length, ciro: bugun.reduce((s, o) => s + o.toplam, 0) });
});

// ============ SOCKET.IO ============
io.on("connection", (socket) => {
  socket.emit("initOrders", orders.filter((o) => o.durum !== "hazir").map(gizle));
  socket.on("markDone", (id) => {
    const o = orders.find((x) => x.id === id);
    if (o) {
      o.durum = "hazir";
      kaydetOrders();
      io.emit("orderRemoved", { id }); // hazırlanınca panelden kalkar + müşteri düzenlemesi kilitlenir
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n  QR Sipariş sistemi çalışıyor:`);
  console.log(`   Müşteri menü : http://localhost:${PORT}/?masa=1`);
  console.log(`   Admin panel  : http://localhost:${PORT}/admin  (şifre: ${config.adminSifre})\n`);
});
