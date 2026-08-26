// WebSocket bu sunucuda (LiteSpeed) kapalı; doğrudan polling'e sabitliyoruz.
// Böylece başarısız websocket denemesi bağlantıyı takmaz + uygulama uyanırken kopmaz.
const socket = io({
  transports: ["polling"],
  upgrade: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 3000,
  timeout: 20000,
});
const $ = (id) => document.getElementById(id);
const siparislerEl = $("siparisler");

let sesAcik = false;
const zilSesi = new Audio("/sounds/zil.mp3");
zilSesi.volume = 1.0; // ses seviyesi: en fazla 1.0 (üstü hata verir, kod durur!)

// Çıkış
$("cikis").onclick = async () => {
  await fetch("/admin/logout", { method: "POST" });
  location.href = "/admin/login";
};

// --- Bildirim sesi (MP3) ---
$("sesAc").onclick = () => {
  sesAcik = true;
  $("sesAc").textContent = "🔊 Ses Açık";
  $("sesAc").classList.add("aktif");
  zilSesi.play().catch(() => {}); // tarayıcı kilidini aç + test sesi
};

let zilDurdurZamanlayici = null;
function bipCal() {
  if (!sesAcik) return;
  clearTimeout(zilDurdurZamanlayici);
  zilSesi.currentTime = 0; // arka arkaya siparişlerde baştan çalsın
  zilSesi.play().catch(() => {});
  // 2 saniye sonra durdur
  zilDurdurZamanlayici = setTimeout(() => {
    zilSesi.pause();
    zilSesi.currentTime = 0;
  }, 2000);
}

// --- Termal fiş yazdırma ---
let otoYazdir = localStorage.getItem("otoYazdir") === "1";
guncelleYazdirBtn();
$("otoYazdir").onclick = () => {
  otoYazdir = !otoYazdir;
  localStorage.setItem("otoYazdir", otoYazdir ? "1" : "0");
  guncelleYazdirBtn();
};
function guncelleYazdirBtn() {
  const b = $("otoYazdir");
  b.textContent = otoYazdir ? "🖨️ Oto Yazdır: Açık" : "🖨️ Oto Yazdır: Kapalı";
  b.classList.toggle("aktif", otoYazdir);
}

function fisYazdir(o) {
  const saat = new Date(o.tarih).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const satirlar = o.urunler.map((u) => {
    const bas = `${u.adet}x ${u.ad}${u.porsiyon ? " (" + u.porsiyon + ")" : ""}`;
    let alt = "";
    if (u.sadece) alt += `<div class="fs-not"><b>** ${esc(u.sadece.toUpperCase())} **</b></div>`;
    if (u.cikarilan && u.cikarilan.length) alt += `<div class="fs-not">- ${esc(u.cikarilan.join(", "))} YOK</div>`;
    if (u.eklenen && u.eklenen.length) alt += `<div class="fs-not">+ ${esc(u.eklenen.map((e) => e.ad).join(", "))}</div>`;
    return `<div class="fs-satir"><span>${esc(bas)}</span><span>${u.fiyat * u.adet} TL</span></div>${alt}`;
  }).join("");
  const paket = o.tip === "paket" && o.teslimat;
  const t = o.teslimat || {};
  const ustBlok = paket
    ? `<div class="fs-satir"><b>PAKET SERVIS</b><span>#${o.siraNo || 1}</span></div>
       <div class="fs-orta2">${saat}</div>
       <div class="fs-cizgi"></div>
       <div class="fs-not"><b>${esc(t.ad)}</b></div>
       <div class="fs-not">TEL: ${esc(t.telefon)}</div>
       <div class="fs-not">${t.mahalle ? esc(t.mahalle) + " - " : ""}${esc(t.adres)}</div>
       <div class="fs-not fs-toplam">ODEME: ${esc(t.odemeAd || "")}</div>`
    : `<div class="fs-satir"><b>MASA ${esc(o.masa)}</b><span>${o.siraNo || 1}. Sipariş</span></div>
       <div class="fs-orta2">${saat}</div>`;
  $("fis").innerHTML = `
    <div class="fs-baslik">SUAT USTA TANTUNI</div>
    <div class="fs-orta">${paket ? "PAKET FISI" : "SIPARIS FISI"}</div>
    <div class="fs-cizgi"></div>
    ${ustBlok}
    <div class="fs-cizgi"></div>`;
  $("fis").innerHTML += `
    ${satirlar}
    <div class="fs-cizgi"></div>
    <div class="fs-satir fs-toplam"><span>TOPLAM</span><span>${o.toplam} TL</span></div>
    ${o.not ? `<div class="fs-cizgi"></div><div class="fs-not2">NOT: ${esc(o.not)}</div>` : ""}
    <div class="fs-alt-yazi">* Afiyet olsun *</div>`;
  window.print();
}

// --- Bağlantı ---
socket.on("connect", () => { $("baglanti").textContent = "● Bağlı"; $("baglanti").className = "rozet yesil"; });
socket.on("disconnect", () => { $("baglanti").textContent = "○ Koptu"; $("baglanti").className = "rozet kirmizi"; });

// --- Siparişler ---
socket.on("initOrders", (list) => {
  siparislerEl.querySelectorAll(".kart").forEach((k) => k.remove());
  list.forEach((o) => kartEkle(o, false));
  guncelleSayac();
});
socket.on("newOrder", (o) => { kartEkle(o, true); bipCal(); guncelleSayac(); if (otoYazdir) fisYazdir(o); });
// Müşteri siparişini düzenledi → kartı güncelle (hafif vurgu, ses yok)
socket.on("orderChanged", (o) => {
  const k = document.querySelector(`.kart[data-id="${o.id}"]`);
  if (k) k.remove();
  kartEkle(o, true);
  if (o.iptalTalebi) bipCal(); // iptal talebi geldi → sesli uyar
  guncelleSayac();
});
// Sipariş iptal edildi veya hazır işaretlendi → panelden kalk
socket.on("orderRemoved", ({ id }) => {
  const k = document.querySelector(`.kart[data-id="${id}"]`);
  if (k) k.remove();
  guncelleSayac();
});

function kartEkle(o, yeniMi) {
  $("bos").hidden = true;
  const kart = document.createElement("div");
  const paket = o.tip === "paket" && o.teslimat;
  kart.className = "kart" + (yeniMi ? " yeni" : "") + (o.iptalTalebi ? " iptal-bekliyor" : "") + (paket ? " paket" : "");
  kart.dataset.id = o.id;
  const saat = new Date(o.tarih).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const urunler = o.urunler.map((u) => {
    const porsiyon = u.porsiyon ? ` <span class="k-porsiyon">${esc(u.porsiyon)}</span>` : "";
    const sadece = u.sadece ? `<div class="k-sadece">⚡ ${esc(u.sadece.toUpperCase())}</div>` : "";
    const cikar = (u.cikarilan && u.cikarilan.length) ? `<div class="k-cikar">🚫 ${esc(u.cikarilan.join(", "))}</div>` : "";
    const ekle = (u.eklenen && u.eklenen.length) ? `<div class="k-ekle">➕ ${esc(u.eklenen.map((e) => e.ad).join(", "))}</div>` : "";
    return `<li><span class="adet">${u.adet}×</span> ${esc(u.ad)}${porsiyon}${sadece}${cikar}${ekle}</li>`;
  }).join("");
  const notHtml = o.not ? `<div class="not">📝 ${esc(o.not)}</div>` : "";
  const iptalHtml = o.iptalTalebi ? `
    <div class="iptal-uyari">⚠️ Müşteri iptal talebi gönderdi</div>
    <div class="iptal-butonlar">
      <button class="iptal-onayla">✓ İptali Onayla</button>
      <button class="iptal-reddet">✗ Reddet</button>
    </div>` : "";
  const t = o.teslimat || {};
  const baslik = paket
    ? `📦 Paket <span class="sira-rozet">#${o.siraNo || 1}</span>`
    : `Masa ${esc(o.masa)} <span class="sira-rozet">${o.siraNo || 1}. Sipariş</span>`;
  const teslimatHtml = paket ? `
    <div class="teslimat">
      <div class="t-satir"><b>👤 ${esc(t.ad)}</b><a class="t-tel" href="tel:${esc(t.telefon)}">📞 ${esc(t.telefon)}</a></div>
      <div class="t-adres">📍 ${t.mahalle ? esc(t.mahalle) + " — " : ""}${esc(t.adres)}</div>
      <div class="t-odeme">💰 ${esc(t.odemeAd || "")}</div>
    </div>` : "";
  kart.innerHTML = `
    <div class="kart-ust">
      <span class="masa">${baslik}</span>
      <span class="saat">${saat}</span>
    </div>
    ${teslimatHtml}
    <ul class="urunler">${urunler}</ul>
    ${notHtml}
    ${iptalHtml}
    <div class="kart-alt">
      <span class="toplam">${o.toplam} ₺</span>
      <button class="yazdir-btn" title="Fiş yazdır">🖨️</button>
      <button class="hazir-btn">✓ Hazır / Teslim</button>
    </div>`;
  kart.querySelector(".hazir-btn").onclick = () => socket.emit("markDone", o.id);
  kart.querySelector(".yazdir-btn").onclick = () => fisYazdir(o);
  if (o.iptalTalebi) {
    kart.querySelector(".iptal-onayla").onclick = async () => {
      if (confirm(`Masa ${o.masa} siparişi iptal edilsin mi?`)) await fetch("/api/admin/order/" + o.id + "/iptal-onayla", { method: "POST" });
    };
    kart.querySelector(".iptal-reddet").onclick = async () => {
      await fetch("/api/admin/order/" + o.id + "/iptal-reddet", { method: "POST" });
    };
  }
  siparislerEl.insertBefore(kart, siparislerEl.firstChild.nextSibling);
  if (yeniMi) setTimeout(() => kart.classList.remove("yeni"), 3000);
}

function guncelleSayac() {
  const n = document.querySelectorAll(".kart").length;
  $("sayac").textContent = n;
  $("bos").hidden = n > 0;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
