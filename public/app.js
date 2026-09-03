// Masa numarasını QR linkinden al: /?masa=5  (masa yoksa PAKET SERVİS modu)
const params = new URLSearchParams(location.search);
const masaParam = params.get("masa");
const paketMi = !masaParam;               // ?masa= yoksa eve sipariş (paket)
const masa = masaParam || "Paket";
if (paketMi) {
  document.querySelector(".masa-rozet").innerHTML = "📦 Paket Servis — Eve Sipariş";
} else {
  document.getElementById("masaNo").textContent = masa;
}

let menu = [];
// sepet: key -> { urun, porsiyon, cikarilan[], eklenen[{ad,fiyat}], birimFiyat, adet }
const sepet = new Map();

// Aktif (gönderilmiş) sipariş + 1.5 dk düzenleme penceresi
let aktifSiparis = null; // { id, token, deadline }
let sayacTimer = null;
let kaydetTimer = null;
let iptalBekliyor = false; // iptal talebi kasadan onay bekliyor
let iptalPollTimer = null;
const DUZENLEME_SURESI = 90 * 1000; // 1.5 dakika

const $ = (id) => document.getElementById(id);
const LS_KEY = "aktifSiparis_masa_" + masa;
const aktifOku = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } };
const aktifYaz = (v) => localStorage.setItem(LS_KEY, JSON.stringify(v));
const aktifSil = () => localStorage.removeItem(LS_KEY);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const KAMPANYA_BASLIK = "Kampanyalı Menülerimiz";
// Sokak hayvanlarına bağış (sepete ürün eklenince bir kez sorulur)
const BAGIS = { id: 9999, ad: "Sokak Hayvanlarına Bağış 🐾", fiyat: 100 };
let bagisSoruldu = false;
// Tantunilerde "Sadece Et / Sadece Tavuk" seçeneği (porsiyon menüsünün yanında)
const sadeceEtiketi = (u) =>
  Array.isArray(u.cikarilabilir) && u.cikarilabilir.length
    ? (/tavuk/i.test(u.ad) ? "Sadece Tavuk" : "Sadece Et")
    : null;

const anahtar = (id, porsiyon, cikarilan, eklenen, sadece) =>
  `${id}|${porsiyon || ""}|${[...cikarilan].sort().join(",")}|${eklenen.map((e) => e.ad).sort().join(",")}|${sadece || ""}`;

// Kategori / ürün emojileri (görseli olmayan ürünler için)
const KAT_EMOJI = { "Et Tantuniler": "🥙", "Tavuk Tantuniler": "🌯", "Yeni Ürünler": "⭐", "Çorbalar": "🥣", "Yan Ürünler": "🍟", "İçecekler": "🥤", "Diğer": "🍽️" };
function urunEmoji(u) {
  const ad = (u.ad || "").toLowerCase();
  if (/ayran/.test(ad)) return "🥛";
  if (/şalgam|salgam|soda/.test(ad)) return "🧉";
  if (/kola|pepsi|7up|yedig|lipton/.test(ad)) return "🥤";
  if (/çorba|corba|paça|paca|beyran|mercimek/.test(ad)) return "🥣";
  if (/patates/.test(ad)) return "🍟";
  if (/burger|hamburger/.test(ad)) return "🍔";
  if (/tavuk/.test(ad)) return "🍗";
  return KAT_EMOJI[u.kategori] || "🥙";
}

// --- Menüyü yükle ve ekrana bas ---
fetch("/api/menu")
  .then((r) => r.json())
  .then((data) => {
    menu = data.urunler || [];
    const c = $("menuAlani");
    const nav = $("katNav");
    c.innerHTML = "";
    nav.innerHTML = "";

    // Kampanyalar en üstte ayrı bölüm; yoksa hiç görünmez
    const kampanyalar = menu.filter((u) => u.kampanya);
    const normaller = menu.filter((u) => !u.kampanya);

    const kategoriler = [];
    const grup = new Map();
    if (kampanyalar.length) { grup.set(KAMPANYA_BASLIK, kampanyalar); kategoriler.push(KAMPANYA_BASLIK); }
    normaller.forEach((u) => {
      const k = u.kategori || "Diğer";
      if (!grup.has(k)) { grup.set(k, []); kategoriler.push(k); }
      grup.get(k).push(u);
    });

    kategoriler.forEach((katAd, i) => {
      const secId = "kat-" + i;
      const chip = document.createElement("button");
      chip.className = "kat-chip";
      chip.textContent = katAd;
      chip.dataset.hedef = secId;
      chip.onclick = () => document.getElementById(secId).scrollIntoView({ behavior: "smooth", block: "start" });
      nav.appendChild(chip);

      const kampanyaBolumu = katAd === KAMPANYA_BASLIK;
      const sec = document.createElement("section");
      sec.className = "kat-bolum" + (kampanyaBolumu ? " kampanya-bolum" : "");
      sec.id = secId;
      const h = document.createElement("h2");
      h.className = "kategori" + (kampanyaBolumu ? " kategori-kampanya" : "");
      h.textContent = katAd;
      sec.appendChild(h);
      grup.get(katAd).forEach((u, j) => {
        const kart = urunKarti(u);
        kart.style.animationDelay = Math.min(j * 0.04, 0.3) + "s";
        sec.appendChild(kart);
      });
      c.appendChild(sec);
    });

    scrollSpy();
    aktifDurumuGeriYukle();
  });

function urunTuru(u) {
  const s = ((u.ad || "") + " " + (u.kategori || "")).toLowerCase();
  if (s.includes("tavuk")) return "tavuk";
  if (u.kategori === "Et Tantuniler" || u.kategori === "Yeni Ürünler") return "et";
  return "";
}

function urunKarti(u) {
  const div = document.createElement("div");
  const tur = urunTuru(u);
  div.className = "urun" + (u.kampanya ? " urun--kampanya" : tur ? " urun--" + tur : "");
  div.dataset.id = u.id;

  const porsiyonlu = Array.isArray(u.porsiyonlar) && u.porsiyonlar.length > 0;
  const basFiyat = porsiyonlu ? u.porsiyonlar[0].fiyat : u.fiyat;
  const basKalori = (porsiyonlu && u.porsiyonlar[0].kalori) || u.kalori || "";

  const medalyon = `<div class="urun-medalyon"><span class="medalyon-emoji">${urunEmoji(u)}</span>${u.resim ? `<img src="/${esc(u.resim)}" alt="${esc(u.ad)}" loading="lazy" width="106" height="106" onerror="this.remove()">` : ""}</div>`;

  const porsiyonHtml = porsiyonlu
    ? `<select class="porsiyon-sec">
        ${u.porsiyonlar.map((p) => `<option value="${esc(p.ad)}" data-fiyat="${p.fiyat}" data-kalori="${esc(p.kalori || "")}">${esc(p.ad)}</option>`).join("")}
      </select>`
    : "";

  const cikarHtml = Array.isArray(u.cikarilabilir) && u.cikarilabilir.length
    ? `<div class="ozel-grup"><span class="ozel-baslik">İstemediklerin</span>
        ${u.cikarilabilir.map((m) => `<button type="button" class="cikar-chip" data-mal="${esc(m)}">${esc(m)}</button>`).join("")}</div>`
    : "";

  // Ayrı kutucuk: "Sadece Et İstiyorum" / "Sadece Tavuk İstiyorum"
  const sadeceAd = sadeceEtiketi(u);
  const sadeceHtml = sadeceAd
    ? `<button type="button" class="sadece-kutu" data-sadece="${esc(sadeceAd)}">${esc(sadeceAd)} İstiyorum</button>`
    : "";

  const ekleHtml = Array.isArray(u.eklenebilir) && u.eklenebilir.length
    ? `<div class="ozel-grup"><span class="ozel-baslik">Ekstra ekle</span>
        ${u.eklenebilir.map((e) => `<button type="button" class="ekle-chip" data-ad="${esc(e.ad)}" data-fiyat="${e.fiyat}">+ ${esc(e.ad)}${e.fiyat ? " (" + e.fiyat + "₺)" : ""}</button>`).join("")}</div>`
    : "";

  div.innerHTML = `
    ${medalyon}
    <div class="urun-bilgi">
      <div class="urun-ust">
        <h3>${esc(u.ad)}</h3>
        ${basKalori ? `<span class="kalori">${esc(basKalori)} kcal</span>` : ""}
      </div>
      ${u.aciklama ? `<p class="urun-aciklama">${esc(u.aciklama)}</p>` : ""}
      ${porsiyonHtml}
      ${cikarHtml}
      ${ekleHtml}
      ${sadeceHtml}
      <div class="urun-alt">
        <span class="fiyat">${u.eskiFiyat ? `<s class="eski-fiyat">${u.eskiFiyat} ₺</s> ` : ""}${basFiyat} ₺</span>
        <button class="ekle-btn">＋ Sepete Ekle</button>
      </div>
    </div>`;

  const sec = div.querySelector(".porsiyon-sec");
  if (sec) {
    sec.onchange = () => {
      const opt = sec.options[sec.selectedIndex];
      guncelleFiyatGosterim(div, u);
      const kal = div.querySelector(".kalori");
      if (kal && opt.dataset.kalori) kal.textContent = opt.dataset.kalori + " kcal";
    };
  }
  div.querySelectorAll(".cikar-chip").forEach((chip) => (chip.onclick = () => chip.classList.toggle("aktif")));
  const sk = div.querySelector(".sadece-kutu");
  if (sk) sk.onclick = () => sk.classList.toggle("aktif");
  div.querySelectorAll(".ekle-chip").forEach((chip) => (chip.onclick = () => { chip.classList.toggle("aktif"); guncelleFiyatGosterim(div, u); }));
  div.querySelector(".ekle-btn").onclick = () => sepeteEkle(u, div);
  return div;
}

// Kategori şeridi kaydırma takibi
function scrollSpy() {
  const chipler = [...document.querySelectorAll(".kat-chip")];
  const nav = $("katNav");
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const id = e.target.id;
      chipler.forEach((ch) => ch.classList.toggle("aktif", ch.dataset.hedef === id));
      const aktif = chipler.find((ch) => ch.dataset.hedef === id);
      if (aktif) nav.scrollTo({ left: aktif.offsetLeft - 16, behavior: "smooth" });
    });
  }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
  document.querySelectorAll(".kat-bolum").forEach((b) => obs.observe(b));
}

function guncelleFiyatGosterim(kart, u) {
  const sec = kart.querySelector(".porsiyon-sec");
  let fiyat = sec ? Number(sec.options[sec.selectedIndex].dataset.fiyat) : u.fiyat;
  kart.querySelectorAll(".ekle-chip.aktif").forEach((c) => (fiyat += Number(c.dataset.fiyat) || 0));
  kart.querySelector(".fiyat").innerHTML = (u.eskiFiyat ? `<s class="eski-fiyat">${u.eskiFiyat} ₺</s> ` : "") + fiyat + " ₺";
}

function sepeteEkle(u, kart) {
  const sec = kart.querySelector(".porsiyon-sec");
  const porsiyon = sec ? sec.value : null;
  const porsiyonFiyat = sec ? Number(sec.options[sec.selectedIndex].dataset.fiyat) : u.fiyat;
  const cikarilan = [...kart.querySelectorAll(".cikar-chip.aktif")].map((c) => c.dataset.mal);
  const eklenen = [...kart.querySelectorAll(".ekle-chip.aktif")].map((c) => ({ ad: c.dataset.ad, fiyat: Number(c.dataset.fiyat) || 0 }));
  const sadeceBtn = kart.querySelector(".sadece-kutu");
  const sadece = sadeceBtn && sadeceBtn.classList.contains("aktif") ? sadeceBtn.dataset.sadece : null;
  const birimFiyat = porsiyonFiyat + eklenen.reduce((s, e) => s + e.fiyat, 0);

  const k = anahtar(u.id, porsiyon, cikarilan, eklenen, sadece);
  const mevcut = sepet.get(k);
  if (mevcut) mevcut.adet += 1;
  else sepet.set(k, { urun: u, porsiyon, cikarilan, eklenen, sadece, birimFiyat, adet: 1 });

  guncelleSepetCubugu();
  sepetVurgula(); // sepet logosunu zıplat + rozet pop (dikkat çekici)
  otoKaydetTetikle(); // aktif siparişteysek değişikliği kaydet
  const btn = kart.querySelector(".ekle-btn");
  btn.textContent = "Eklendi ✓";
  btn.classList.add("eklendi");
  setTimeout(() => { btn.textContent = "＋ Sepete Ekle"; btn.classList.remove("eklendi"); }, 1000);
  bagisSor();
}

// Sepete ekleyince sepet logosunu vurgula (bounce + halka + rozet pop)
function sepetVurgula() {
  const fab = $("sepetBtn");
  const badge = $("sepetAdet");
  if (fab) { fab.classList.remove("vurgu"); void fab.offsetWidth; fab.classList.add("vurgu"); }
  if (badge) { badge.classList.remove("pop"); void badge.offsetWidth; badge.classList.add("pop"); }
}

// --- Sokak hayvanlarına bağış popup'ı ---
function bagisSepetteMi() {
  return [...sepet.values()].some((e) => e.urun.id === BAGIS.id);
}
function bagisSor() {
  if (bagisSoruldu || bagisSepetteMi()) return;
  bagisSoruldu = true;
  setTimeout(() => ($("bagisPopup").hidden = false), 500); // "Eklendi ✓" görünsün sonra çıksın
}
$("bagisEvet").onclick = () => {
  $("bagisPopup").hidden = true;
  if (bagisSepetteMi()) return;
  sepet.set(anahtar(BAGIS.id, null, [], [], null), {
    urun: BAGIS, porsiyon: null, cikarilan: [], eklenen: [], sadece: null, birimFiyat: BAGIS.fiyat, adet: 1,
  });
  guncelleSepetCubugu();
  otoKaydetTetikle();
  gosterToast("Teşekkürler! 🐾 100 ₺ bağış siparişine eklendi.");
};
$("bagisHayir").onclick = () => ($("bagisPopup").hidden = true);

// --- Google yorum daveti (link tanımlıysa göster) ---
let iyzicoAktif = false;
let minPaketTutar = 0;
fetch("/api/ayarlar")
  .then((r) => r.json())
  .then((a) => {
    if (a.googleYorumUrl) {
      $("yorumLink").href = a.googleYorumUrl;
      $("yorumKutu").hidden = false;
    }
    minPaketTutar = Number(a.minPaketTutar) || 0;
    // Yemek kartı markalarını doldur
    if (Array.isArray(a.yemekKartlari) && $("pkYemekKart")) {
      $("pkYemekKart").innerHTML = '<option value="">Seçiniz…</option>' + a.yemekKartlari.map((k) => `<option value="${k}">${k}</option>`).join("");
    }
    // Online ödeme (iyzico) aktifse "yakında" seçeneğini kullanılabilir yap
    iyzicoAktif = !!a.iyzicoAktif;
    if (iyzicoAktif) {
      const secim = document.querySelector('.pk-secim.pasif');
      if (secim) {
        secim.classList.remove("pasif");
        const rb = secim.querySelector('input[value="online"]');
        if (rb) rb.disabled = false;
        const small = secim.querySelector("small");
        if (small) small.remove();
      }
    }
  })
  .catch(() => {});

function toplamlar() {
  let adet = 0, tutar = 0;
  for (const e of sepet.values()) { adet += e.adet; tutar += e.birimFiyat * e.adet; }
  return { adet, tutar };
}

function guncelleSepetCubugu() {
  const { adet } = toplamlar();
  $("sepetAdet").textContent = adet;
  // Sepet logosu: ürün varsa ya da aktif sipariş varsa görünür
  $("sepetBtn").hidden = adet === 0 && !aktifSiparis;
}

// --- Sepet paneli ---
$("sepetBtn").onclick = () => { panelModunuAyarla(); if (aktifSiparis) sayacGuncelle(); cizSepet(); $("sepetPanel").hidden = false; };
$("kapatBtn").onclick = () => ($("sepetPanel").hidden = true);

function cizSepet() {
  const liste = $("sepetListe");
  liste.innerHTML = "";
  for (const [k, e] of sepet.entries()) {
    const row = document.createElement("div");
    row.className = "sepet-satir";

    const cikChips = (e.urun.cikarilabilir || []).map((m) => {
      const aktif = e.cikarilan.includes(m);
      return `<button type="button" class="cikar-chip${aktif ? " aktif" : ""}" data-tip="cikar" data-deger="${esc(m)}">${esc(m)}</button>`;
    }).join("");
    const sadeceAd = sadeceEtiketi(e.urun);
    const sadeceSelect = sadeceAd
      ? `<button type="button" class="sadece-kutu ss-sadece${e.sadece ? " aktif" : ""}" data-sadece="${esc(sadeceAd)}">${esc(sadeceAd)} İstiyorum</button>`
      : "";
    const ekChips = (e.urun.eklenebilir || []).map((x) => {
      const aktif = e.eklenen.some((y) => y.ad === x.ad);
      return `<button type="button" class="ekle-chip${aktif ? " aktif" : ""}" data-tip="ekle" data-deger="${esc(x.ad)}" data-fiyat="${x.fiyat}">+ ${esc(x.ad)}${x.fiyat ? " (" + x.fiyat + "₺)" : ""}</button>`;
    }).join("");

    row.innerHTML = `
      <div class="ss-ust">
        <span class="s-ad">${esc(e.urun.ad)}${e.porsiyon ? " • " + esc(e.porsiyon) : ""}</span>
        <button class="ss-sil" title="Sepetten çıkar" aria-label="${esc(e.urun.ad)} ürününü sepetten çıkar">✕</button>
      </div>
      ${cikChips ? `<div class="ss-ops"><span class="ss-baslik">İstemediklerin</span>${cikChips}</div>` : ""}
      ${sadeceSelect}
      ${ekChips ? `<div class="ss-ops"><span class="ss-baslik">Ekstra ekle</span>${ekChips}</div>` : ""}
      <div class="ss-alt">
        <div class="adet-kontrol">
          <button class="eksi" aria-label="${esc(e.urun.ad)} adetini azalt">−</button>
          <span class="adet" aria-live="polite">${e.adet}</span>
          <button class="arti" aria-label="${esc(e.urun.ad)} adetini artır">+</button>
        </div>
        <span class="s-fiyat">${e.birimFiyat * e.adet} ₺</span>
      </div>`;

    row.querySelector(".arti").onclick = () => { e.adet += 1; guncelleSepetCubugu(); cizSepet(); otoKaydetTetikle(); };
    row.querySelector(".eksi").onclick = () => { e.adet -= 1; if (e.adet <= 0) sepet.delete(k); guncelleSepetCubugu(); cizSepet(); otoKaydetTetikle(); };
    row.querySelector(".ss-sil").onclick = () => { sepet.delete(k); guncelleSepetCubugu(); cizSepet(); otoKaydetTetikle(); };
    row.querySelectorAll("[data-tip]").forEach((chip) => {
      chip.onclick = () => opsiyonDegistir(k, e, chip.dataset.tip, chip.dataset.deger, Number(chip.dataset.fiyat) || 0);
    });
    const ic = row.querySelector(".ss-sadece");
    if (ic) ic.onclick = () => { e.sadece = e.sadece ? null : ic.dataset.sadece; yenidenAnahtarla(e); guncelleSepetCubugu(); cizSepet(); otoKaydetTetikle(); };
    liste.appendChild(row);
  }
  $("panelToplam").textContent = toplamlar().tutar;
  if (sepet.size === 0) $("sepetPanel").hidden = true;
}

// Sepet içinden malzeme çıkar/ekle
function opsiyonDegistir(oldKey, e, tip, deger, fiyat) {
  const eklenenToplam = () => e.eklenen.reduce((s, x) => s + x.fiyat, 0);
  const porsiyonFiyat = e.birimFiyat - eklenenToplam(); // taban (porsiyon) fiyatı
  if (tip === "cikar") {
    const i = e.cikarilan.indexOf(deger);
    if (i >= 0) e.cikarilan.splice(i, 1); else e.cikarilan.push(deger);
  } else {
    const i = e.eklenen.findIndex((x) => x.ad === deger);
    if (i >= 0) e.eklenen.splice(i, 1); else e.eklenen.push({ ad: deger, fiyat });
  }
  e.birimFiyat = porsiyonFiyat + eklenenToplam();
  yenidenAnahtarla(e);
  guncelleSepetCubugu();
  cizSepet();
  otoKaydetTetikle();
}

// Kalemi güncel özelliklerine göre yeniden anahtarla (aynı yapı varsa birleştir)
function yenidenAnahtarla(e) {
  for (const [key, val] of [...sepet.entries()]) { if (val === e) sepet.delete(key); }
  const yeniKey = anahtar(e.urun.id, e.porsiyon, e.cikarilan, e.eklenen, e.sadece);
  const mevcut = sepet.get(yeniKey);
  if (mevcut) mevcut.adet += e.adet; else sepet.set(yeniKey, e);
}

// --- Sepet -> sunucu formatı ---
function sepetPayload() {
  return [...sepet.values()].map((e) => ({
    id: e.urun.id, ad: e.urun.ad, porsiyon: e.porsiyon, sadece: e.sadece || null,
    cikarilan: e.cikarilan, eklenen: e.eklenen, adet: e.adet, fiyat: e.birimFiyat,
  }));
}

// Panel modu: yeni sepet mi, aktif sipariş mi?
function panelModunuAyarla() {
  const aktif = !!aktifSiparis;
  $("panelBaslik").textContent = aktif ? "Siparişin" : "Sepetim";
  $("panelSayac").hidden = !aktif;
  $("siparisIptalBtn").hidden = !aktif;
  $("siparisVerBtn").textContent = aktif ? "Değişiklikleri Kaydet" : "Siparişi Gönder";
}

// Not değişince de (aktif siparişte) kaydet
$("not").oninput = otoKaydetTetikle;

// Siparişi sunucuya gönder (masa: doğrudan; paket: adres formundan gelen bilgilerle)
async function siparisGonder(ekstra) {
  const r = await fetch("/api/order", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masa, urunler: sepetPayload(), not: $("not").value.trim(), ...ekstra }),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "gonder"); }
  const d = await r.json();
  aktifSiparis = { id: d.id, token: d.token, deadline: Date.now() + DUZENLEME_SURESI };
  aktifYaz(aktifSiparis);
  panelModunuAyarla();
  sayacBaslat();
  gosterToast("Siparişin alındı! 1.5 dk içinde ekleme/değişiklik yapabilirsin 🧡");
}

// --- Gönder / Kaydet butonu ---
$("siparisVerBtn").onclick = async () => {
  if (sepet.size === 0) return;
  // Aktif siparişte: değişiklikleri kaydet
  if (aktifSiparis) {
    const btn = $("siparisVerBtn"); btn.disabled = true; const em = btn.textContent; btn.textContent = "Kaydediliyor...";
    try { await kaydet(true); } catch { alert("İşlem başarısız, lütfen tekrar deneyin."); btn.textContent = em; } finally { btn.disabled = false; }
    return;
  }
  // Paket modunda: minimum tutar kontrolü, sonra adres + ödeme formunu aç
  if (paketMi) {
    const { tutar } = toplamlar();
    if (tutar < minPaketTutar) {
      gosterToast("Online sipariş için minimum sepet tutarı " + minPaketTutar + " ₺ (sepetin: " + tutar + " ₺)");
      return;
    }
    paketFormAc();
    return;
  }
  // Masa modunda: doğrudan gönder
  const btn = $("siparisVerBtn"); btn.disabled = true; const em = btn.textContent; btn.textContent = "Gönderiliyor...";
  try { await siparisGonder({}); } catch { alert("İşlem başarısız, lütfen tekrar deneyin."); btn.textContent = em; } finally { btn.disabled = false; }
};

// --- Paket servis: teslimat + ödeme formu ---
const PK_KEY = "paketAdres";
function paketFormAc() {
  try {
    const s = JSON.parse(localStorage.getItem(PK_KEY) || "{}"); // önceki adresi hatırla
    if (s.ad) $("pkAd").value = s.ad;
    if (s.telefon) $("pkTel").value = s.telefon;
    if (s.email) $("pkEmail").value = s.email;
    if (s.mahalle) $("pkMahalle").value = s.mahalle;
    if (s.adres) $("pkAdres").value = s.adres;
  } catch {}
  $("pkToplam").textContent = [...sepet.values()].reduce((s, e) => s + e.birimFiyat * e.adet, 0);
  $("pkHata").hidden = true;
  emailAlaniGuncelle();
  $("paketPanel").hidden = false;
  document.body.style.overflow = "hidden";
}
// Ödeme yöntemine göre ek alanları göster: online→e-posta, yemek kartı→marka seçimi
function emailAlaniGuncelle() {
  const secili = document.querySelector('input[name="odeme"]:checked');
  const v = secili ? secili.value : "";
  $("pkEmailAlan").hidden = v !== "online";
  if ($("pkYemekKartAlan")) $("pkYemekKartAlan").hidden = v !== "yemekkart";
}
document.querySelectorAll('input[name="odeme"]').forEach((r) => r.addEventListener("change", emailAlaniGuncelle));
function paketFormKapat() { $("paketPanel").hidden = true; document.body.style.overflow = ""; }
$("paketKapat").onclick = paketFormKapat;

$("paketOnayBtn").onclick = async () => {
  const ad = $("pkAd").value.trim();
  const telefon = $("pkTel").value.trim();
  const email = $("pkEmail").value.trim();
  const mahalle = $("pkMahalle").value.trim();
  const adres = $("pkAdres").value.trim();
  const secili = document.querySelector('input[name="odeme"]:checked');
  const odeme = secili ? secili.value : "";
  const hata = (m) => { const h = $("pkHata"); h.textContent = m; h.hidden = false; };
  if (!ad) return hata("Ad soyad gerekli.");
  if (!telefon || telefon.replace(/\D/g, "").length < 10) return hata("Geçerli bir telefon numarası girin.");
  if (!adres) return hata("Açık adres gerekli.");
  if (!odeme) return hata("Ödeme yöntemi seçin.");
  if (odeme === "online" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return hata("Online ödeme için geçerli bir e-posta girin.");
  let yemekKarti = "";
  if (odeme === "yemekkart") {
    yemekKarti = $("pkYemekKart") ? $("pkYemekKart").value : "";
    if (!yemekKarti) return hata("Hangi yemek kartı ile ödeyeceğini seç.");
  }
  localStorage.setItem(PK_KEY, JSON.stringify({ ad, telefon, email, mahalle, adres }));
  const btn = $("paketOnayBtn"); btn.disabled = true; const em = btn.textContent;
  btn.textContent = odeme === "online" ? "Ödeme açılıyor..." : "Gönderiliyor...";
  try {
    if (odeme === "online") {
      await onlineOdemeBaslat({ ad, telefon, email, mahalle, adres }); // iyzico ödeme formunu açar
    } else {
      await siparisGonder({ tip: "paket", musteri: { ad, telefon, mahalle, adres, yemekKarti }, odeme });
      paketFormKapat();
    }
  } catch (e) {
    hata(e.message === "gonder" ? "Gönderilemedi, tekrar deneyin." : e.message);
    btn.textContent = em;
  } finally { btn.disabled = false; }
};

// --- Online ödeme (iyzico ödeme formu) ---
async function onlineOdemeBaslat(musteri) {
  const r = await fetch("/api/payment/baslat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urunler: sepetPayload(), not: $("not").value.trim(), musteri }),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Ödeme başlatılamadı"); }
  const d = await r.json();
  iyzicoFormGoster(d.checkoutFormContent);
}

function iyzicoFormGoster(html) {
  paketFormKapat();
  $("iyziOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById("iyzipay-checkout-form").innerHTML = "";
  // iyzico script'i (innerHTML script çalıştırmaz; createContextualFragment çalıştırır)
  const frag = document.createRange().createContextualFragment(html);
  document.body.appendChild(frag);
}
$("iyziKapat").onclick = () => {
  $("iyziOverlay").hidden = true;
  document.body.style.overflow = "";
  document.getElementById("iyzipay-checkout-form").innerHTML = "";
};

// --- İptal talebi (kasadan onay gerekir) ---
$("siparisIptalBtn").onclick = async () => {
  if (!aktifSiparis || iptalBekliyor) return;
  if (!confirm("İptal talebi göndermek istiyor musun? Onay kasadan gelir.")) return;
  try {
    const r = await fetch("/api/order/" + aktifSiparis.id + "/iptal-talep", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: aktifSiparis.token }),
    });
    if (!r.ok) throw new Error();
    iptalBekliyor = true;
    iptalUIGuncelle();
    iptalPollBaslat();
    gosterToast("İptal talebin kasaya iletildi, onay bekleniyor.");
  } catch { alert("Talep gönderilemedi, tekrar dene."); }
};

function iptalUIGuncelle() {
  const b = $("siparisIptalBtn");
  if (iptalBekliyor) {
    b.textContent = "⏳ İptal onayı bekleniyor...";
    b.disabled = true;
    $("panelSayac").innerHTML = "⏳ <b>İptal talebin kasaya iletildi</b>, onay bekleniyor.";
  } else {
    b.textContent = "Siparişi İptal Et";
    b.disabled = false;
  }
}

// Talep sonucunu izle (onay = 404, ret = iptalTalebi false)
function iptalPollBaslat() {
  clearInterval(iptalPollTimer);
  iptalPollTimer = setInterval(async () => {
    if (!aktifSiparis) { clearInterval(iptalPollTimer); return; }
    try {
      const r = await fetch("/api/order/" + aktifSiparis.id);
      if (r.status === 404) {
        clearInterval(iptalPollTimer);
        gosterToast("İptal talebin onaylandı — siparişin iptal edildi.");
        kilitle();
        return;
      }
      const o = await r.json();
      if (!o.iptalTalebi) {
        clearInterval(iptalPollTimer);
        iptalBekliyor = false;
        iptalUIGuncelle();
        sayacGuncelle();
        gosterToast("İptal talebin reddedildi — siparişin devam ediyor.");
      }
    } catch {}
  }, 4000);
}

// --- Kaydetme (aktif siparişte otomatik + manuel) ---
function otoKaydetTetikle() {
  if (!aktifSiparis) return;
  clearTimeout(kaydetTimer);
  kaydetTimer = setTimeout(() => kaydet(false), 900);
}
async function kaydet(manuel) {
  if (!aktifSiparis || sepet.size === 0) return;
  try {
    const r = await fetch("/api/order/" + aktifSiparis.id, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: aktifSiparis.token, urunler: sepetPayload(), not: $("not").value.trim() }),
    });
    if (r.status === 409) { kilitle(); gosterToast("Siparişin hazırlanıyor, artık değiştirilemiyor."); return; }
    if (r.ok && manuel) gosterToast("Değişiklikler kaydedildi ✓");
  } catch {}
}

// --- Geri sayım (1.5 dk) ---
function sayacBaslat() {
  clearInterval(sayacTimer);
  $("sayacPill").hidden = false;
  sayacGuncelle();
  sayacTimer = setInterval(sayacGuncelle, 1000);
}
function sayacGuncelle() {
  if (!aktifSiparis) return;
  const kalan = Math.max(0, Math.round((aktifSiparis.deadline - Date.now()) / 1000));
  const metin = Math.floor(kalan / 60) + ":" + String(kalan % 60).padStart(2, "0");
  $("sayacMetin").textContent = metin;
  $("panelSayac").innerHTML = `⏱ <b>${metin}</b> içinde ürün ekleyebilir, değiştirebilir veya not yazabilirsin.`;
  $("sayacPill").classList.toggle("bitiyor", kalan <= 15);
  if (kalan <= 0) sureDoldu();
}
async function sureDoldu() {
  clearInterval(sayacTimer);
  await kaydet(false); // son hali kaydet
  kilitle();
  gosterToast("Süre doldu — siparişin kesinleşti. Afiyet olsun! 🧡");
}

// Aktif siparişi bitir/temizle
function kilitle() {
  clearInterval(sayacTimer); sayacTimer = null;
  clearTimeout(kaydetTimer);
  clearInterval(iptalPollTimer);
  iptalBekliyor = false;
  aktifSiparis = null;
  aktifSil();
  sepet.clear();
  $("not").value = "";
  $("siparisIptalBtn").disabled = false;
  $("siparisIptalBtn").textContent = "Siparişi İptal Et";
  panelModunuAyarla();
  guncelleSepetCubugu();
  $("sepetPanel").hidden = true;
  $("sayacPill").hidden = true;
  $("sepetBtn").hidden = true;
}

// Sayfa açılınca aktif siparişi (süre dolmadıysa) geri yükle
async function aktifDurumuGeriYukle() {
  const a = aktifOku();
  if (!a || !a.deadline || Date.now() >= a.deadline) { if (a) aktifSil(); return; }
  try {
    const r = await fetch("/api/order/" + a.id);
    if (!r.ok) { aktifSil(); return; }
    const o = await r.json();
    if (o.durum !== "yeni") { aktifSil(); return; }
    sepet.clear();
    o.urunler.forEach((it) => {
      const urun = menu.find((m) => m.id === it.id) || { id: it.id, ad: it.ad };
      const cikarilan = it.cikarilan || [];
      const eklenen = it.eklenen || [];
      const sadece = it.sadece || null;
      sepet.set(anahtar(it.id, it.porsiyon, cikarilan, eklenen, sadece), { urun, porsiyon: it.porsiyon || null, cikarilan, eklenen, sadece, birimFiyat: it.fiyat, adet: it.adet });
    });
    $("not").value = o.not || "";
    aktifSiparis = a;
    panelModunuAyarla();
    guncelleSepetCubugu();
    sayacBaslat();
    if (o.iptalTalebi) { iptalBekliyor = true; iptalUIGuncelle(); iptalPollBaslat(); }
  } catch { aktifSil(); }
}

// --- Toast bildirim ---
let toastTimer = null;
function gosterToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("goster"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("goster"); setTimeout(() => (t.hidden = true), 300); }, 3400);
}
