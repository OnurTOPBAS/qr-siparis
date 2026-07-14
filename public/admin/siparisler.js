const socket = io();
const $ = (id) => document.getElementById(id);
const siparislerEl = $("siparisler");

let sesAcik = false;
let audioCtx = null;

// Çıkış
$("cikis").onclick = async () => {
  await fetch("/admin/logout", { method: "POST" });
  location.href = "/admin/login";
};

// --- Bildirim sesi (dosyasız, Web Audio "ding") ---
$("sesAc").onclick = () => {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  sesAcik = true;
  $("sesAc").textContent = "🔊 Ses Açık";
  $("sesAc").classList.add("aktif");
  bipCal();
};

function bipCal() {
  if (!sesAcik || !audioCtx) return;
  const now = audioCtx.currentTime;
  [0, 0.18].forEach((g) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, now + g);
    gain.gain.exponentialRampToValueAtTime(0.4, now + g + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + g + 0.15);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now + g);
    osc.stop(now + g + 0.16);
  });
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
    if (u.cikarilan && u.cikarilan.length) alt += `<div class="fs-not">- ${esc(u.cikarilan.join(", "))} YOK</div>`;
    if (u.eklenen && u.eklenen.length) alt += `<div class="fs-not">+ ${esc(u.eklenen.map((e) => e.ad).join(", "))}</div>`;
    return `<div class="fs-satir"><span>${esc(bas)}</span><span>${u.fiyat * u.adet} TL</span></div>${alt}`;
  }).join("");
  $("fis").innerHTML = `
    <div class="fs-baslik">SUAT USTA TANTUNI</div>
    <div class="fs-orta">SIPARIS FISI</div>
    <div class="fs-cizgi"></div>
    <div class="fs-satir"><b>MASA ${esc(o.masa)}</b><span>#${o.id}</span></div>
    <div class="fs-orta2">${saat}</div>
    <div class="fs-cizgi"></div>
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
  kart.className = "kart" + (yeniMi ? " yeni" : "");
  kart.dataset.id = o.id;
  const saat = new Date(o.tarih).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const urunler = o.urunler.map((u) => {
    const porsiyon = u.porsiyon ? ` <span class="k-porsiyon">${esc(u.porsiyon)}</span>` : "";
    const cikar = (u.cikarilan && u.cikarilan.length) ? `<div class="k-cikar">🚫 ${esc(u.cikarilan.join(", "))}</div>` : "";
    const ekle = (u.eklenen && u.eklenen.length) ? `<div class="k-ekle">➕ ${esc(u.eklenen.map((e) => e.ad).join(", "))}</div>` : "";
    return `<li><span class="adet">${u.adet}×</span> ${esc(u.ad)}${porsiyon}${cikar}${ekle}</li>`;
  }).join("");
  const notHtml = o.not ? `<div class="not">📝 ${esc(o.not)}</div>` : "";
  kart.innerHTML = `
    <div class="kart-ust">
      <span class="masa">Masa ${esc(o.masa)}</span>
      <span class="saat">${saat}</span>
    </div>
    <ul class="urunler">${urunler}</ul>
    ${notHtml}
    <div class="kart-alt">
      <span class="toplam">${o.toplam} ₺</span>
      <button class="yazdir-btn" title="Fiş yazdır">🖨️</button>
      <button class="hazir-btn">✓ Hazır / Teslim</button>
    </div>`;
  kart.querySelector(".hazir-btn").onclick = () => socket.emit("markDone", o.id);
  kart.querySelector(".yazdir-btn").onclick = () => fisYazdir(o);
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
