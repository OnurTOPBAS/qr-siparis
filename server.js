import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;
const MENU_PATH = join(__dirname, "data", "menu.json");
const ORDERS_PATH = join(__dirname, "data", "orders.json");

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// --- Sipariş deposu (bellek + basit dosya kalıcılığı) ---
let orders = [];
let nextId = 1;

function loadOrders() {
  if (existsSync(ORDERS_PATH)) {
    try {
      orders = JSON.parse(readFileSync(ORDERS_PATH, "utf-8"));
      nextId = orders.reduce((m, o) => Math.max(m, o.id), 0) + 1;
    } catch {
      orders = [];
    }
  }
}
function saveOrders() {
  try {
    writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
  } catch (e) {
    console.error("Sipariş kaydedilemedi:", e.message);
  }
}
loadOrders();

// --- Rotalar ---
// Ana sayfa: müşteri menüsü (QR bunu açar, ?masa=5 gibi)
app.get("/", (_req, res) => res.sendFile(join(__dirname, "public", "index.html")));
// Kasa / admin paneli
app.get("/admin", (_req, res) => res.sendFile(join(__dirname, "public", "admin.html")));
// Satış raporları
app.get("/admin/rapor", (_req, res) => res.sendFile(join(__dirname, "public", "rapor.html")));

// Menüyü ver
app.get("/api/menu", (_req, res) => {
  try {
    res.json(JSON.parse(readFileSync(MENU_PATH, "utf-8")));
  } catch {
    res.status(500).json({ error: "Menü okunamadı" });
  }
});

// Yeni sipariş al
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
  const toplam = items.reduce((s, i) => s + i.fiyat * i.adet, 0);

  const order = {
    id: nextId++,
    masa: String(masa).slice(0, 20),
    urunler: items,
    not: String(not || "").slice(0, 300),
    toplam,
    durum: "yeni", // yeni | hazir
    tarih: new Date().toISOString(),
  };
  orders.push(order);
  saveOrders();

  io.emit("newOrder", order); // kasadaki tüm admin panellerine anında düş
  res.status(201).json({ ok: true, id: order.id });
});

// Satış raporu: günlük / haftalık / aylık (bu gün / bu hafta / bu ay)
app.get("/api/report", (_req, res) => {
  const now = new Date();
  const gunBasi = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Haftanın başı = Pazartesi
  const gun = now.getDay(); // 0=Pazar ... 6=Cumartesi
  const pazartesiFarki = gun === 0 ? 6 : gun - 1;
  const haftaBasi = new Date(gunBasi);
  haftaBasi.setDate(gunBasi.getDate() - pazartesiFarki);
  const ayBasi = new Date(now.getFullYear(), now.getMonth(), 1);

  function ozet(baslangic) {
    const filt = orders.filter((o) => new Date(o.tarih) >= baslangic);
    const urunMap = new Map();
    let ciro = 0;
    for (const o of filt) {
      ciro += o.toplam;
      for (const u of o.urunler) {
        const k = urunMap.get(u.ad) || { ad: u.ad, adet: 0, ciro: 0 };
        k.adet += u.adet;
        k.ciro += u.fiyat * u.adet;
        urunMap.set(u.ad, k);
      }
    }
    const urunler = [...urunMap.values()].sort((a, b) => b.adet - a.adet);
    return { ciro, siparis: filt.length, urunler };
  }

  res.json({
    gunluk: ozet(gunBasi),
    haftalik: ozet(haftaBasi),
    aylik: ozet(ayBasi),
  });
});

// --- Socket.io (canlı bildirim) ---
io.on("connection", (socket) => {
  // Admin bağlanınca bekleyen siparişleri gönder
  const aktif = orders.filter((o) => o.durum !== "hazir");
  socket.emit("initOrders", aktif);

  // Sipariş hazır/teslim işaretle
  socket.on("markDone", (id) => {
    const o = orders.find((x) => x.id === id);
    if (o) {
      o.durum = "hazir";
      saveOrders();
      io.emit("orderUpdated", { id, durum: "hazir" });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n  QR Sipariş sistemi çalışıyor:`);
  console.log(`   Müşteri menü : http://localhost:${PORT}/?masa=1`);
  console.log(`   Kasa / Admin : http://localhost:${PORT}/admin\n`);
});
