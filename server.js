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
  config = { adminSifre: "admin123", siteAdi: "Suat Usta Tantuni", googleYorumUrl: "" };
  yaz(CONFIG_PATH, config);
}
if (config.googleYorumUrl === undefined) { config.googleYorumUrl = ""; yaz(CONFIG_PATH, config); }
// Oturum imza anahtarı: yoksa rastgele üret ve sakla (sabit hardcoded anahtar güvensiz)
if (!config.sessionSecret) { config.sessionSecret = crypto.randomUUID() + crypto.randomUUID(); yaz(CONFIG_PATH, config); }

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
    secret: config.sessionSecret,
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

// Müşteri tarafı ayarlar (şifre vb. sızdırmadan)
app.get("/api/ayarlar", (_req, res) => res.json({ siteAdi: config.siteAdi || "", googleYorumUrl: config.googleYorumUrl || "" }));

// Bağış: menüde olmayan özel kalem, fiyatı sunucuda sabit
const BAGIS_ID = 9999;
const BAGIS_AD = "Sokak Hayvanlarına Bağış 🐾";
const BAGIS_FIYAT = 100;

// GÜVENLİK: fiyat ve ürün adı istemciden ASLA kabul edilmez.
// Her kalem menüden doğrulanır, fiyat sunucuda hesaplanır.
function kalemleriDuzenle(urunler) {
  const menu = oku(MENU_PATH, { urunler: [] });
  const kalemler = [];

  for (const u of (Array.isArray(urunler) ? urunler : []).slice(0, 50)) {
    const id = Number(u?.id) || null;
    const adet = Math.min(50, Math.max(1, parseInt(u?.adet, 10) || 1));

    if (id === BAGIS_ID) {
      kalemler.push({ id, ad: BAGIS_AD, porsiyon: null, sadece: null, cikarilan: [], eklenen: [], adet, fiyat: BAGIS_FIYAT });
      continue;
    }

    const mu = menu.urunler.find((x) => x.id === id);
    if (!mu) continue; // menüde yoksa siparişe alınmaz

    // Fiyat: porsiyon varsa onun fiyatı, yoksa ürün fiyatı
    let porsiyon = null;
    let birim = Number(mu.fiyat) || 0;
    if (Array.isArray(mu.porsiyonlar) && mu.porsiyonlar.length) {
      const p = mu.porsiyonlar.find((x) => x.ad === u?.porsiyon) || mu.porsiyonlar[0];
      porsiyon = p.ad;
      birim = Number(p.fiyat) || 0;
    }

    // Sadece menüde tanımlı malzemeler çıkarılabilir
    const izinliCikar = Array.isArray(mu.cikarilabilir) ? mu.cikarilabilir : [];
    const cikarilan = Array.isArray(u?.cikarilan)
      ? [...new Set(u.cikarilan.filter((x) => izinliCikar.includes(x)))].slice(0, 10)
      : [];

    // Ekstralar: sadece menüde tanımlı olanlar, menüdeki fiyatıyla
    const eklenen = [];
    if (Array.isArray(u?.eklenen)) {
      for (const e of u.eklenen.slice(0, 10)) {
        const me = (mu.eklenebilir || []).find((x) => x.ad === e?.ad);
        if (me && !eklenen.some((y) => y.ad === me.ad)) {
          eklenen.push({ ad: me.ad, fiyat: Number(me.fiyat) || 0 });
          birim += Number(me.fiyat) || 0;
        }
      }
    }

    // "Sadece Et/Tavuk" yalnızca tantunilerde geçerli
    const sadece = izinliCikar.length && /^Sadece /i.test(String(u?.sadece || ""))
      ? String(u.sadece).slice(0, 40) : null;

    kalemler.push({ id, ad: mu.ad, porsiyon, sadece, cikarilan, eklenen, adet, fiyat: Math.max(0, birim) });
  }
  return kalemler;
}
// Admin'e giden kopyada gizli token'ı sızdırma
const gizle = (o) => { const { token, ...rest } = o; return rest; };

app.post("/api/order", (req, res) => {
  const { masa, urunler, not } = req.body || {};
  if (!masa || !Array.isArray(urunler) || urunler.length === 0) {
    return res.status(400).json({ error: "Masa ve en az bir ürün gerekli" });
  }
  const items = kalemleriDuzenle(urunler);
  if (!items.length) return res.status(400).json({ error: "Geçerli ürün bulunamadı" });
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
  res.json({ id: o.id, masa: o.masa, urunler: o.urunler, not: o.not, toplam: o.toplam, durum: o.durum, iptalTalebi: !!o.iptalTalebi });
});

// Müşteri siparişini düzenler — sadece "yeni" durumdayken ve doğru token ile
app.put("/api/order/:id", (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Sipariş bulunamadı" });
  if ((req.body?.token || "") !== o.token) return res.status(403).json({ error: "Yetki yok" });
  if (o.durum !== "yeni") return res.status(409).json({ error: "Sipariş hazırlanıyor, artık düzenlenemez" });
  const { urunler, not } = req.body || {};
  if (!Array.isArray(urunler) || urunler.length === 0) return res.status(400).json({ error: "En az bir ürün gerekli" });
  const yeniKalemler = kalemleriDuzenle(urunler);
  if (!yeniKalemler.length) return res.status(400).json({ error: "Geçerli ürün bulunamadı" });
  o.urunler = yeniKalemler;
  o.not = String(not || "").slice(0, 300);
  o.toplam = o.urunler.reduce((s, i) => s + i.fiyat * i.adet, 0);
  kaydetOrders();
  io.emit("orderChanged", gizle(o));
  res.json({ ok: true });
});

// Müşteri iptal TALEBİ oluşturur — admin onayı gerekir (doğrudan silme yok)
app.post("/api/order/:id/iptal-talep", (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Sipariş bulunamadı" });
  if ((req.body?.token || "") !== o.token) return res.status(403).json({ error: "Yetki yok" });
  if (o.durum !== "yeni") return res.status(409).json({ error: "Sipariş hazırlanıyor" });
  o.iptalTalebi = true;
  kaydetOrders();
  io.emit("orderChanged", gizle(o)); // kasaya iptal talebini bildir
  res.json({ ok: true });
});

// Doğrudan silme müşteriye kapalı
app.delete("/api/order/:id", (_req, res) => res.status(403).json({ error: "İptal için kasadan onay gerekir" }));

// ============ ADMIN GİRİŞ ============
app.get("/admin/login", (req, res) => {
  if (req.session?.giris) return res.redirect("/panel");
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
app.get(["/admin", "/panel"], girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "siparisler.html"))); // /panel: hosting WAF /admin/ yolunu resetlediği için alternatif adres
app.get("/admin/menu", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "menu.html")));
app.get("/admin/masalar", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "masalar.html")));
app.get("/admin/rapor", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "rapor.html")));
app.get("/admin/gecmis", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "gecmis.html")));
app.get("/admin/kampanya", girisGerekli, (_req, res) => res.sendFile(join(VIEWS, "kampanya.html")));

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
    if (g.kampanya) { u.kampanya = true; if (Number(g.eskiFiyat)) u.eskiFiyat = Number(g.eskiFiyat); }
  } else {
    const yeniId = menu.urunler.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    const yeni = { id: yeniId, ...temel, resim: g.resim || "" };
    if (porsiyonlar.length) yeni.porsiyonlar = porsiyonlar;
    if (cikarilabilir.length) yeni.cikarilabilir = cikarilabilir;
    if (eklenebilir.length) yeni.eklenebilir = eklenebilir;
    if (g.kampanya) { yeni.kampanya = true; if (Number(g.eskiFiyat)) yeni.eskiFiyat = Number(g.eskiFiyat); }
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

// --- İptal talebi onay / ret (admin) ---
app.post("/api/admin/order/:id/iptal-onayla", girisGerekli, (req, res) => {
  const id = Number(req.params.id);
  if (!orders.some((x) => x.id === id)) return res.status(404).json({ error: "Sipariş yok" });
  orders = orders.filter((x) => x.id !== id);
  kaydetOrders();
  io.emit("orderRemoved", { id });
  res.json({ ok: true });
});
app.post("/api/admin/order/:id/iptal-reddet", girisGerekli, (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Sipariş yok" });
  o.iptalTalebi = false;
  kaydetOrders();
  io.emit("orderChanged", gizle(o));
  res.json({ ok: true });
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
