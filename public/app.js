// Masa numarasını QR linkinden al: /?masa=5
const params = new URLSearchParams(location.search);
const masa = params.get("masa") || "1";
document.getElementById("masaNo").textContent = masa;

let menu = [];
// sepet: key -> { urun, porsiyon, cikarilan[], birimFiyat, adet }
const sepet = new Map();

let duzenlenenId = null;
let duzenlenenToken = null;

const $ = (id) => document.getElementById(id);
const LS_KEY = "aktifSiparis_masa_" + masa;
const aktifOku = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } };
const aktifYaz = (v) => localStorage.setItem(LS_KEY, JSON.stringify(v));
const aktifSil = () => localStorage.removeItem(LS_KEY);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Sepet anahtarı: aynı ürün + porsiyon + çıkarılanlar = tek satır
const anahtar = (id, porsiyon, cikarilan) => `${id}|${porsiyon || ""}|${[...cikarilan].sort().join(",")}`;

// --- Menüyü yükle ve ekrana bas ---
fetch("/api/menu")
  .then((r) => r.json())
  .then((data) => {
    menu = data.urunler || [];
    const c = $("menu");
    c.innerHTML = "";

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
      grup.get(katAd).forEach((u) => c.appendChild(urunKarti(u)));
    });

    aktifSiparisiKontrolEt();
  });

function urunKarti(u) {
  const div = document.createElement("div");
  div.className = "urun";
  div.dataset.id = u.id;

  const porsiyonlu = Array.isArray(u.porsiyonlar) && u.porsiyonlar.length > 0;
  const ilk = porsiyonlu ? u.porsiyonlar[0] : null;
  const basFiyat = porsiyonlu ? ilk.fiyat : u.fiyat;
  const basKalori = porsiyonlu ? ilk.kalori : u.kalori;

  const resimHtml = u.resim ? `<img src="/${esc(u.resim)}" alt="${esc(u.ad)}" onerror="this.style.display='none'">` : "";

  const porsiyonHtml = porsiyonlu
    ? `<select class="porsiyon-sec">
        ${u.porsiyonlar.map((p) => `<option value="${esc(p.ad)}" data-fiyat="${p.fiyat}" data-kalori="${esc(p.kalori || "")}">${esc(p.ad)}</option>`).join("")}
      </select>`
    : "";

  const cikarHtml = Array.isArray(u.cikarilabilir) && u.cikarilabilir.length
    ? `<div class="cikar-grup">
        <span class="cikar-baslik">İstemediklerin:</span>
        ${u.cikarilabilir.map((m) => `<button type="button" class="cikar-chip" data-mal="${esc(m)}">${esc(m)}</button>`).join("")}
      </div>`
    : "";

  div.innerHTML = `
    ${resimHtml}
    <div class="urun-bilgi">
      <h3>${esc(u.ad)} ${basKalori ? `<span class="kalori">${esc(basKalori)} kcal</span>` : ""}</h3>
      ${u.aciklama ? `<p>${esc(u.aciklama)}</p>` : ""}
      ${porsiyonHtml}
      ${cikarHtml}
      <div class="urun-alt">
        <span class="fiyat">${basFiyat} ₺</span>
        <button class="ekle-btn">Sepete Ekle</button>
      </div>
    </div>`;

  // Porsiyon değişince fiyat + kalori güncelle
  const sec = div.querySelector(".porsiyon-sec");
  if (sec) {
    sec.onchange = () => {
      const opt = sec.options[sec.selectedIndex];
      div.querySelector(".fiyat").textContent = opt.dataset.fiyat + " ₺";
      const kal = div.querySelector(".kalori");
      if (kal) kal.textContent = (opt.dataset.kalori || "") + (opt.dataset.kalori ? " kcal" : "");
    };
  }
  // Çıkar chip toggle
  div.querySelectorAll(".cikar-chip").forEach((chip) => {
    chip.onclick = () => chip.classList.toggle("aktif");
  });
  // Sepete ekle
  div.querySelector(".ekle-btn").onclick = () => sepeteEkle(u, div);
  return div;
}

function sepeteEkle(u, kart) {
  const sec = kart.querySelector(".porsiyon-sec");
  const porsiyon = sec ? sec.value : null;
  const birimFiyat = sec ? Number(sec.options[sec.selectedIndex].dataset.fiyat) : u.fiyat;
  const cikarilan = [...kart.querySelectorAll(".cikar-chip.aktif")].map((c) => c.dataset.mal);

  const k = anahtar(u.id, porsiyon, cikarilan);
  const mevcut = sepet.get(k);
  if (mevcut) mevcut.adet += 1;
  else sepet.set(k, { urun: u, porsiyon, cikarilan, birimFiyat, adet: 1 });

  guncelleSepetCubugu();
  const btn = kart.querySelector(".ekle-btn");
  btn.textContent = "Eklendi ✓";
  btn.classList.add("eklendi");
  setTimeout(() => { btn.textContent = "Sepete Ekle"; btn.classList.remove("eklendi"); }, 1000);
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
    row.innerHTML = `
      <div class="s-sol">
        <span class="s-ad">${esc(e.urun.ad)}${e.porsiyon ? " • " + esc(e.porsiyon) : ""}</span>
        ${e.cikarilan.length ? `<span class="s-cikar">Çıkar: ${esc(e.cikarilan.join(", "))}</span>` : ""}
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
    id: e.urun.id, ad: e.urun.ad, porsiyon: e.porsiyon, cikarilan: e.cikarilan, adet: e.adet, fiyat: e.birimFiyat,
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
    const k = anahtar(it.id, it.porsiyon, cikarilan);
    sepet.set(k, { urun, porsiyon: it.porsiyon || null, cikarilan, birimFiyat: it.fiyat, adet: it.adet });
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
