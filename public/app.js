// Masa numarasını QR linkinden al: /?masa=5
const params = new URLSearchParams(location.search);
const masa = params.get("masa") || "1";
document.getElementById("masaNo").textContent = masa;

// Köz kıvılcımları (hero'da yükselen közler)
(function kozOlustur() {
  const kat = document.getElementById("kozLayer");
  if (!kat) return;
  const yuk = kat.clientHeight || 340;
  for (let i = 0; i < 26; i++) {
    const e = document.createElement("span");
    e.className = "ember";
    const boyut = 3 + Math.random() * 6;
    e.style.left = Math.random() * 100 + "%";
    e.style.width = e.style.height = boyut + "px";
    e.style.setProperty("--kayma", (Math.random() * 70 - 35) + "px");
    e.style.setProperty("--yuk", (yuk + 20) + "px");
    e.style.animationDuration = (3 + Math.random() * 4).toFixed(2) + "s";
    e.style.animationDelay = (Math.random() * 6).toFixed(2) + "s";
    kat.appendChild(e);
  }
})();

let menu = [];
// sepet: key -> { urun, porsiyon, cikarilan[], eklenen[{ad,fiyat}], birimFiyat, adet }
const sepet = new Map();

let duzenlenenId = null;
let duzenlenenToken = null;

const $ = (id) => document.getElementById(id);
const LS_KEY = "aktifSiparis_masa_" + masa;
const aktifOku = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } };
const aktifYaz = (v) => localStorage.setItem(LS_KEY, JSON.stringify(v));
const aktifSil = () => localStorage.removeItem(LS_KEY);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const anahtar = (id, porsiyon, cikarilan, eklenen) =>
  `${id}|${porsiyon || ""}|${[...cikarilan].sort().join(",")}|${eklenen.map((e) => e.ad).sort().join(",")}`;

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

    const kategoriler = [];
    const grup = new Map();
    menu.forEach((u) => {
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

      const sec = document.createElement("section");
      sec.className = "kat-bolum";
      sec.id = secId;
      const h = document.createElement("h2");
      h.className = "kategori";
      h.innerHTML = `<span class="kat-emoji">${KAT_EMOJI[katAd] || "🍽️"}</span> ${esc(katAd)}`;
      sec.appendChild(h);
      grup.get(katAd).forEach((u, j) => {
        const kart = urunKarti(u);
        kart.style.animationDelay = Math.min(j * 0.04, 0.3) + "s";
        sec.appendChild(kart);
      });
      c.appendChild(sec);
    });

    scrollSpy();
    aktifSiparisiKontrolEt();
  });

function urunKarti(u) {
  const div = document.createElement("div");
  div.className = "urun";
  div.dataset.id = u.id;

  const porsiyonlu = Array.isArray(u.porsiyonlar) && u.porsiyonlar.length > 0;
  const basFiyat = porsiyonlu ? u.porsiyonlar[0].fiyat : u.fiyat;
  const basKalori = (porsiyonlu && u.porsiyonlar[0].kalori) || u.kalori || "";

  const medalyon = `<div class="urun-medalyon"><span class="medalyon-emoji">${urunEmoji(u)}</span>${u.resim ? `<img src="/${esc(u.resim)}" alt="" onerror="this.remove()">` : ""}</div>`;

  const porsiyonHtml = porsiyonlu
    ? `<select class="porsiyon-sec">
        ${u.porsiyonlar.map((p) => `<option value="${esc(p.ad)}" data-fiyat="${p.fiyat}" data-kalori="${esc(p.kalori || "")}">${esc(p.ad)}</option>`).join("")}
      </select>`
    : "";

  const cikarHtml = Array.isArray(u.cikarilabilir) && u.cikarilabilir.length
    ? `<div class="ozel-grup"><span class="ozel-baslik">İstemediklerin</span>
        ${u.cikarilabilir.map((m) => `<button type="button" class="cikar-chip" data-mal="${esc(m)}">${esc(m)}</button>`).join("")}</div>`
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
      <div class="urun-alt">
        <span class="fiyat">${basFiyat} ₺</span>
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
  kart.querySelector(".fiyat").textContent = fiyat + " ₺";
}

function sepeteEkle(u, kart) {
  const sec = kart.querySelector(".porsiyon-sec");
  const porsiyon = sec ? sec.value : null;
  const porsiyonFiyat = sec ? Number(sec.options[sec.selectedIndex].dataset.fiyat) : u.fiyat;
  const cikarilan = [...kart.querySelectorAll(".cikar-chip.aktif")].map((c) => c.dataset.mal);
  const eklenen = [...kart.querySelectorAll(".ekle-chip.aktif")].map((c) => ({ ad: c.dataset.ad, fiyat: Number(c.dataset.fiyat) || 0 }));
  const birimFiyat = porsiyonFiyat + eklenen.reduce((s, e) => s + e.fiyat, 0);

  const k = anahtar(u.id, porsiyon, cikarilan, eklenen);
  const mevcut = sepet.get(k);
  if (mevcut) mevcut.adet += 1;
  else sepet.set(k, { urun: u, porsiyon, cikarilan, eklenen, birimFiyat, adet: 1 });

  guncelleSepetCubugu();
  const btn = kart.querySelector(".ekle-btn");
  btn.textContent = "Eklendi ✓";
  btn.classList.add("eklendi");
  setTimeout(() => { btn.textContent = "＋ Sepete Ekle"; btn.classList.remove("eklendi"); }, 1000);
}

function toplamlar() {
  let adet = 0, tutar = 0;
  for (const e of sepet.values()) { adet += e.adet; tutar += e.birimFiyat * e.adet; }
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
  for (const [k, e] of sepet.entries()) {
    const row = document.createElement("div");
    row.className = "sepet-satir";
    const ekstra = e.eklenen.length ? `<span class="s-ekle">+ ${esc(e.eklenen.map((x) => x.ad).join(", "))}</span>` : "";
    const cikar = e.cikarilan.length ? `<span class="s-cikar">Çıkar: ${esc(e.cikarilan.join(", "))}</span>` : "";
    row.innerHTML = `
      <div class="s-sol">
        <span class="s-ad">${esc(e.urun.ad)}${e.porsiyon ? " • " + esc(e.porsiyon) : ""}</span>
        ${cikar}${ekstra}
      </div>
      <div class="adet-kontrol">
        <button class="eksi">−</button>
        <span class="adet">${e.adet}</span>
        <button class="arti">+</button>
      </div>
      <span class="s-fiyat">${e.birimFiyat * e.adet} ₺</span>`;
    row.querySelector(".arti").onclick = () => { e.adet += 1; guncelleSepetCubugu(); cizSepet(); };
    row.querySelector(".eksi").onclick = () => {
      e.adet -= 1;
      if (e.adet <= 0) sepet.delete(k);
      guncelleSepetCubugu();
      cizSepet();
    };
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
  const urunler = [...sepet.values()].map((e) => ({
    id: e.urun.id, ad: e.urun.ad, porsiyon: e.porsiyon, cikarilan: e.cikarilan, eklenen: e.eklenen, adet: e.adet, fiyat: e.birimFiyat,
  }));
  const not = $("not").value.trim();

  try {
    let r;
    if (duzenlenenId) {
      r = await fetch("/api/order/" + duzenlenenId, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: duzenlenenToken, urunler, not }),
      });
    } else {
      r = await fetch("/api/order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masa, urunler, not }),
      });
    }
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Hata"); }
    const d = await r.json();
    if (!duzenlenenId) aktifYaz({ id: d.id, token: d.token });

    sepetiTemizle();
    duzenlenenId = null; duzenlenenToken = null;
    $("siparisVerBtn").textContent = "Siparişi Gönder";
    $("sepetPanel").hidden = true;
    $("onayMasa").textContent = masa;
    $("onay").hidden = false;
  } catch (e) {
    if (String(e.message).includes("hazırlan")) {
      aktifSil(); serdiGizle();
      alert("Siparişiniz hazırlanmaya başladı, artık değiştirilemiyor.");
    } else {
      alert("İşlem başarısız, lütfen tekrar deneyin.");
    }
  } finally {
    btn.disabled = false;
    if (!duzenlenenId) btn.textContent = "Siparişi Gönder";
  }
};

function sepetiTemizle() {
  sepet.clear();
  $("not").value = "";
  guncelleSepetCubugu();
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

async function aktifSiparisiKontrolEt() {
  const a = aktifOku();
  if (!a) return serdiGizle();
  try {
    const r = await fetch("/api/order/" + a.id);
    if (!r.ok) { aktifSil(); return serdiGizle(); }
    const o = await r.json();
    if (o.durum === "yeni") serdiGoster();
    else { aktifSil(); serdiGizle(); }
  } catch { serdiGizle(); }
}

async function duzenlemeBaslat() {
  const a = aktifOku();
  if (!a) return;
  const r = await fetch("/api/order/" + a.id);
  if (!r.ok) { aktifSil(); serdiGizle(); return alert("Sipariş bulunamadı."); }
  const o = await r.json();
  if (o.durum !== "yeni") { aktifSil(); serdiGizle(); return alert("Siparişiniz hazırlanmaya başladı, artık değiştirilemiyor."); }

  sepetiTemizle();
  o.urunler.forEach((it) => {
    const urun = menu.find((m) => m.id === it.id) || { id: it.id, ad: it.ad };
    const cikarilan = it.cikarilan || [];
    const eklenen = it.eklenen || [];
    const k = anahtar(it.id, it.porsiyon, cikarilan, eklenen);
    sepet.set(k, { urun, porsiyon: it.porsiyon || null, cikarilan, eklenen, birimFiyat: it.fiyat, adet: it.adet });
  });
  $("not").value = o.not || "";
  duzenlenenId = a.id;
  duzenlenenToken = a.token;
  guncelleSepetCubugu();
  $("siparisVerBtn").textContent = "Değişiklikleri Kaydet";
  cizSepet();
  $("sepetPanel").hidden = false;
}

async function siparisIptal() {
  const a = aktifOku();
  if (!a) return;
  if (!confirm("Siparişiniz iptal edilsin mi?")) return;
  const r = await fetch("/api/order/" + a.id, {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: a.token }),
  });
  if (r.ok) { aktifSil(); serdiGizle(); alert("Siparişiniz iptal edildi."); }
  else {
    if (r.status === 409) { aktifSil(); serdiGizle(); }
    alert("İptal edilemedi (sipariş hazırlanıyor olabilir).");
  }
}
