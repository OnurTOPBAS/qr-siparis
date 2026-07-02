// Masa numarasını QR linkinden al: /?masa=5
const params = new URLSearchParams(location.search);
const masa = params.get("masa") || "1";
document.getElementById("masaNo").textContent = masa;

let menu = [];
const sepet = new Map(); // id -> { urun, adet }

// Düzenleme durumu: aktif siparişi düzenliyorsak id + token dolu olur
let duzenlenenId = null;
let duzenlenenToken = null;

const $ = (id) => document.getElementById(id);
const LS_KEY = "aktifSiparis_masa_" + masa;

// localStorage: bu cihazın bu masadaki aktif siparişi {id, token}
const aktifOku = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } };
const aktifYaz = (v) => localStorage.setItem(LS_KEY, JSON.stringify(v));
const aktifSil = () => localStorage.removeItem(LS_KEY);

// --- Menüyü yükle ve ekrana bas ---
fetch("/api/menu")
  .then((r) => r.json())
  .then((data) => {
    menu = data.urunler || [];
    const c = $("menu");
    c.innerHTML = "";

    // Ürünleri kategoriye göre grupla (ilk görülme sırasını koru)
    const kategoriler = [];
    const grup = new Map();
    menu.forEach((u) => {
      const k = u.kategori || "Diğer";
      if (!grup.has(k)) { grup.set(k, []); kategoriler.push(k); }
      grup.get(k).push(u);
    });

    kategoriler.forEach((katAd) => {
      const h = document.createElement("h2");
      h.className = "kategori";
      h.textContent = katAd;
      c.appendChild(h);

      grup.get(katAd).forEach((u) => {
        const div = document.createElement("div");
        div.className = "urun";
        div.innerHTML = `
          <img src="${u.resim}" alt="${u.ad}" onerror="this.style.visibility='hidden'">
          <div class="urun-bilgi">
            <h3>${u.ad}</h3>
            <p>${u.aciklama || ""}</p>
            <div class="urun-alt">
              <span class="fiyat">${u.fiyat} ₺</span>
              <div class="adet-kontrol" data-id="${u.id}">
                <button class="eksi">−</button>
                <span class="adet">0</span>
                <button class="arti">+</button>
              </div>
            </div>
          </div>`;
        div.querySelector(".arti").onclick = () => degistir(u, 1);
        div.querySelector(".eksi").onclick = () => degistir(u, -1);
        c.appendChild(div);
      });
    });

    aktifSiparisiKontrolEt(); // menü yüklendikten sonra aktif sipariş var mı bak
  });

function degistir(urun, delta) {
  const mevcut = sepet.get(urun.id)?.adet || 0;
  const yeni = Math.max(0, mevcut + delta);
  if (yeni === 0) sepet.delete(urun.id);
  else sepet.set(urun.id, { urun, adet: yeni });

  const el = document.querySelector(`.adet-kontrol[data-id="${urun.id}"] .adet`);
  if (el) el.textContent = yeni;
  guncelleSepetCubugu();
}

function toplamlar() {
  let adet = 0, tutar = 0;
  for (const { urun, adet: a } of sepet.values()) { adet += a; tutar += urun.fiyat * a; }
  return { adet, tutar };
}

function guncelleSepetCubugu() {
  const { adet, tutar } = toplamlar();
  $("sepetAdet").textContent = adet;
  $("sepetToplam").textContent = tutar;
  $("sepetBtn").hidden = adet === 0;
}

// --- Sepet paneli ---
$("sepetBtn").onclick = () => { cizSepet(); $("sepetPanel").hidden = false; };
$("kapatBtn").onclick = () => ($("sepetPanel").hidden = true);

function cizSepet() {
  const liste = $("sepetListe");
  liste.innerHTML = "";
  for (const { urun, adet } of sepet.values()) {
    const row = document.createElement("div");
    row.className = "sepet-satir";
    row.innerHTML = `
      <span class="s-ad">${urun.ad}</span>
      <div class="adet-kontrol" data-id="${urun.id}">
        <button class="eksi">−</button>
        <span class="adet">${adet}</span>
        <button class="arti">+</button>
      </div>
      <span class="s-fiyat">${urun.fiyat * adet} ₺</span>`;
    row.querySelector(".arti").onclick = () => { degistir(urun, 1); cizSepet(); };
    row.querySelector(".eksi").onclick = () => { degistir(urun, -1); cizSepet(); };
    liste.appendChild(row);
  }
  $("panelToplam").textContent = toplamlar().tutar;
  if (sepet.size === 0) $("sepetPanel").hidden = true;
}

// --- Siparişi gönder / güncelle ---
$("siparisVerBtn").onclick = async () => {
  if (sepet.size === 0) return;
  const btn = $("siparisVerBtn");
  btn.disabled = true;
  btn.textContent = duzenlenenId ? "Kaydediliyor..." : "Gönderiliyor...";
  const urunler = [...sepet.values()].map(({ urun, adet }) => ({ id: urun.id, ad: urun.ad, adet, fiyat: urun.fiyat }));
  const not = $("not").value.trim();

  try {
    let r;
    if (duzenlenenId) {
      // Düzenleme → PUT
      r = await fetch("/api/order/" + duzenlenenId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: duzenlenenToken, urunler, not }),
      });
    } else {
      // Yeni sipariş → POST
      r = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masa, urunler, not }),
      });
    }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || "Hata");
    }
    const d = await r.json();
    if (!duzenlenenId) aktifYaz({ id: d.id, token: d.token }); // yeni siparişi hatırla

    sepetiTemizle();
    duzenlenenId = null;
    duzenlenenToken = null;
    btn.textContent = "Siparişi Gönder";
    $("sepetPanel").hidden = true;
    $("onayMasa").textContent = masa;
    $("onay").hidden = false;
  } catch (e) {
    alert(e.message === "Sipariş hazırlanıyor, artık düzenlenemez"
      ? "Siparişiniz hazırlanmaya başladı, artık değiştirilemiyor."
      : "İşlem başarısız, lütfen tekrar deneyin.");
    if (String(e.message).includes("hazırlan")) { aktifSil(); serdiGizle(); }
  } finally {
    btn.disabled = false;
    if (!duzenlenenId) btn.textContent = "Siparişi Gönder";
  }
};

function sepetiTemizle() {
  sepet.clear();
  $("not").value = "";
  guncelleSepetCubugu();
  document.querySelectorAll(".adet-kontrol .adet").forEach((e) => (e.textContent = "0"));
}

// --- Onay ekranı butonları ---
$("onayKapat").onclick = () => { $("onay").hidden = true; aktifSiparisiKontrolEt(); };
$("onayDuzenle").onclick = () => { $("onay").hidden = true; duzenlemeBaslat(); };
$("onayIptal").onclick = () => { $("onay").hidden = true; siparisIptal(); };

// --- Aktif sipariş şeridi ---
$("seritDuzenle").onclick = duzenlemeBaslat;
$("seritIptal").onclick = siparisIptal;
const serdiGoster = () => ($("aktifSerit").hidden = false);
const serdiGizle = () => ($("aktifSerit").hidden = true);

// Sayfa açılınca / onay kapanınca: aktif sipariş hâlâ "yeni" mi?
async function aktifSiparisiKontrolEt() {
  const a = aktifOku();
  if (!a) return serdiGizle();
  try {
    const r = await fetch("/api/order/" + a.id);
    if (!r.ok) { aktifSil(); return serdiGizle(); }
    const o = await r.json();
    if (o.durum === "yeni") serdiGoster();
    else { aktifSil(); serdiGizle(); } // hazırlandı → düzenleme kapalı
  } catch { serdiGizle(); }
}

// Düzenlemeyi başlat: mevcut siparişi sepete yükle, panel aç
async function duzenlemeBaslat() {
  const a = aktifOku();
  if (!a) return;
  const r = await fetch("/api/order/" + a.id);
  if (!r.ok) { aktifSil(); serdiGizle(); return alert("Sipariş bulunamadı."); }
  const o = await r.json();
  if (o.durum !== "yeni") {
    aktifSil(); serdiGizle();
    return alert("Siparişiniz hazırlanmaya başladı, artık değiştirilemiyor.");
  }
  // Sepeti siparişten doldur
  sepetiTemizle();
  o.urunler.forEach((it) => {
    const urun = menu.find((m) => m.id === it.id) || { id: it.id, ad: it.ad, fiyat: it.fiyat };
    sepet.set(urun.id, { urun, adet: it.adet });
    const el = document.querySelector(`.adet-kontrol[data-id="${urun.id}"] .adet`);
    if (el) el.textContent = it.adet;
  });
  $("not").value = o.not || "";
  duzenlenenId = a.id;
  duzenlenenToken = a.token;
  guncelleSepetCubugu();
  $("siparisVerBtn").textContent = "Değişiklikleri Kaydet";
  cizSepet();
  $("sepetPanel").hidden = false;
}

// Siparişi iptal et
async function siparisIptal() {
  const a = aktifOku();
  if (!a) return;
  if (!confirm("Siparişiniz iptal edilsin mi?")) return;
  const r = await fetch("/api/order/" + a.id, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: a.token }),
  });
  if (r.ok) {
    aktifSil(); serdiGizle();
    alert("Siparişiniz iptal edildi.");
  } else {
    const d = await r.json().catch(() => ({}));
    if (r.status === 409) { aktifSil(); serdiGizle(); }
    alert(d.error === "Sipariş hazırlanıyor, iptal edilemez"
      ? "Siparişiniz hazırlanmaya başladı, artık iptal edilemiyor."
      : "İptal edilemedi.");
  }
}
