const socket = io();
const $ = (id) => document.getElementById(id);
const siparislerEl = $("siparisler");

let sesAcik = false;
let audioCtx = null;

// --- Bildirim sesi (dosyasız, Web Audio ile "ding") ---
// Tarayıcılar, kullanıcı bir kez tıklamadan ses çalınmasına izin vermez.
// O yüzden "Sesi Aç" butonu ile audio context'i başlatıyoruz.
$("sesAc").onclick = () => {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  sesAcik = true;
  $("sesAc").textContent = "🔊 Ses Açık";
  $("sesAc").classList.add("aktif");
  bipCal(); // test
};

function bipCal() {
  if (!sesAcik || !audioCtx) return;
  const now = audioCtx.currentTime;
  [0, 0.18].forEach((gecikme) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, now + gecikme);
    gain.gain.exponentialRampToValueAtTime(0.4, now + gecikme + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + gecikme + 0.15);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now + gecikme);
    osc.stop(now + gecikme + 0.16);
  });
}

// --- Bağlantı durumu ---
socket.on("connect", () => {
  $("baglanti").textContent = "● Bağlı";
  $("baglanti").className = "rozet yesil";
});
socket.on("disconnect", () => {
  $("baglanti").textContent = "○ Bağlantı koptu";
  $("baglanti").className = "rozet kirmizi";
});

// --- Siparişler ---
// Panel açıldığında bekleyen siparişler
socket.on("initOrders", (list) => {
  siparislerEl.querySelectorAll(".kart").forEach((k) => k.remove());
  list.forEach((o) => kartEkle(o, false));
  guncelleSayac();
});

// Yeni sipariş → kart + ses + masaüstü bildirimi
socket.on("newOrder", (o) => {
  kartEkle(o, true);
  bipCal();
  guncelleSayac();
});

// Sipariş hazır işaretlendi (başka panelden de olabilir)
socket.on("orderUpdated", ({ id }) => {
  const kart = document.querySelector(`.kart[data-id="${id}"]`);
  if (kart) kart.remove();
  guncelleSayac();
});

function kartEkle(o, yeniMi) {
  $("bos").hidden = true;
  const kart = document.createElement("div");
  kart.className = "kart" + (yeniMi ? " yeni" : "");
  kart.dataset.id = o.id;

  const saat = new Date(o.tarih).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const urunler = o.urunler
    .map((u) => `<li><span class="adet">${u.adet}×</span> ${u.ad}</li>`)
    .join("");
  const notHtml = o.not
    ? `<div class="not">📝 ${escapeHtml(o.not)}</div>`
    : "";

  kart.innerHTML = `
    <div class="kart-ust">
      <span class="masa">Masa ${escapeHtml(o.masa)}</span>
      <span class="saat">${saat}</span>
    </div>
    <ul class="urunler">${urunler}</ul>
    ${notHtml}
    <div class="kart-alt">
      <span class="toplam">${o.toplam} ₺</span>
      <button class="hazir-btn">✓ Hazır / Teslim</button>
    </div>`;
  kart.querySelector(".hazir-btn").onclick = () => socket.emit("markDone", o.id);

  // Yeni siparişi en üste ekle
  siparislerEl.insertBefore(kart, siparislerEl.firstChild.nextSibling);
  if (yeniMi) setTimeout(() => kart.classList.remove("yeni"), 3000);
}

function guncelleSayac() {
  const n = document.querySelectorAll(".kart").length;
  $("sayac").textContent = n;
  $("bos").hidden = n > 0;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
