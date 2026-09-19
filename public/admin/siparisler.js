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
const siparisVerileri = new Map(); // id -> sipariş (düzenleme için)
let adminMenu = [];
fetch("/api/menu").then((r) => r.json()).then((d) => { adminMenu = d.urunler || []; }).catch(() => {});

// Ses tercihi: VARSAYILAN AÇIK (kullanıcı kapatana kadar). Sayfa açılınca otomatik açık gelir.
let sesAcik = localStorage.getItem("sesTercih") !== "0";
const zilSesi = new Audio("/sounds/zil.mp3");
zilSesi.volume = 1.0;
zilSesi.preload = "auto";
let mp3Var = true;
zilSesi.addEventListener("error", () => { mp3Var = false; }); // dosya yoksa/404 → yedek bip

// --- Web Audio: DOSYAYA BAĞLI OLMAYAN güvenilir bip (yalnızca mp3 çalmazsa yedek) ---
let sesCtx = null;
let keepAlive = null; // sekme arka plandayken sesin kesilmemesi için sürekli (sessiz) ses
function sesKur() {
  try {
    if (!sesCtx) sesCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (sesCtx.state === "suspended") sesCtx.resume();
    if (!keepAlive) {
      // sessiz sürekli döngü → AudioContext hep "çalışıyor" kalır, arka sekmede bip anında tetiklenir
      const buf = sesCtx.createBuffer(1, sesCtx.sampleRate, sesCtx.sampleRate);
      keepAlive = sesCtx.createBufferSource();
      keepAlive.buffer = buf; keepAlive.loop = true;
      const g = sesCtx.createGain(); g.gain.value = 0.02;
      keepAlive.connect(g).connect(sesCtx.destination);
      keepAlive.start();
    }
  } catch {}
}
// 3 kez "çın" — telefon zili gibi dikkat çekici
function sentetikBip() {
  if (!sesCtx) return;
  try {
    if (sesCtx.state === "suspended") sesCtx.resume();
    const t = sesCtx.currentTime;
    [0, 0.30, 0.60].forEach((d) => {
      const o = sesCtx.createOscillator(), g = sesCtx.createGain();
      o.type = "sine"; o.frequency.value = 1050;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.7, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.24);
      o.connect(g).connect(sesCtx.destination);
      o.start(t + d); o.stop(t + d + 0.26);
    });
  } catch {}
}

// Çıkış
$("cikis").onclick = async () => {
  await fetch("/admin/logout", { method: "POST" });
  location.href = "/admin/login";
};

// --- Bildirim sesi ---
let zilDurdurZamanlayici = null;
// Kendi sesini (mp3) çal; dosya yoksa/çalmazsa yedek bip
function sesiCal() {
  sesKur();
  clearTimeout(zilDurdurZamanlayici);
  if (mp3Var) {
    try {
      zilSesi.currentTime = 0;
      const p = zilSesi.play();
      if (p && p.catch) p.catch(() => sentetikBip()); // mp3 çalmazsa yedek
    } catch { sentetikBip(); }
    zilDurdurZamanlayici = setTimeout(() => { try { zilSesi.pause(); zilSesi.currentTime = 0; } catch {} }, 2500);
  } else {
    sentetikBip();
  }
}
function bipCal() { if (sesAcik) sesiCal(); }

function sesButonGuncelle() {
  $("sesAc").textContent = sesAcik ? "🔊 Ses Açık" : "🔇 Sesi Aç";
  $("sesAc").classList.toggle("aktif", sesAcik);
}
sesButonGuncelle();

// Otomatik kilit açma: ses açıksa, sayfadaki İLK tıklama/tuşta kilidi aç (ayrı butona basmaya gerek yok)
function sesKilidiniAc() {
  sesKur();
  try { zilSesi.play().then(() => { zilSesi.pause(); zilSesi.currentTime = 0; }).catch(() => {}); } catch {}
}
if (sesAcik) {
  document.addEventListener("pointerdown", sesKilidiniAc, { once: true });
  document.addEventListener("keydown", sesKilidiniAc, { once: true });
}

// Buton: sesi aç/kapat (tercih hatırlanır)
$("sesAc").onclick = () => {
  sesAcik = !sesAcik;
  localStorage.setItem("sesTercih", sesAcik ? "1" : "0");
  sesButonGuncelle();
  if (sesAcik) sesiCal(); // açınca kendi sesinle test
};

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
  const para = (n) => Number(n).toFixed(2).replace(".", ",");
  const saat = new Date(o.tarih).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const paket = o.tip === "paket" && o.teslimat;
  const t = o.teslimat || {};

  // Ürün satırları — her ürün arası ince kesik çizgi
  const satirlar = o.urunler.map((u) => {
    let alt = "";
    if (u.porsiyon) alt += `<div class="fs-urun-ops">${esc(u.porsiyon)}</div>`;
    if (u.sadece) alt += `<div class="fs-urun-ops"><b>** ${esc(u.sadece.toUpperCase())} **</b></div>`;
    if (u.cikarilan && u.cikarilan.length) alt += `<div class="fs-urun-ops">- ${esc(u.cikarilan.join(", "))} YOK</div>`;
    if (u.eklenen && u.eklenen.length) alt += `<div class="fs-urun-ops">+ ${esc(u.eklenen.map((e) => e.ad).join(", "))}</div>`;
    return `<div class="fs-cizgi"></div>
      <div class="fs-urun"><span class="fs-urun-ad">${esc(u.ad)}</span><span class="fs-urun-adet">x${u.adet}</span><span class="fs-urun-fiyat">${para(u.fiyat * u.adet)}</span></div>${alt}`;
  }).join("");

  // Üst bilgi bloğu — etiketli satırlar
  const bilgiBlok = paket
    ? `<div class="fs-bilgi"><b>Müşteri :</b> ${esc(t.ad)}</div>
       <div class="fs-bilgi"><b>Telefon :</b> ${esc(t.telefon)}</div>
       <div class="fs-bilgi"><b>Adres :</b> ${t.mahalle ? esc(t.mahalle) + " — " : ""}${esc(t.adres)}</div>
       ${o.not ? `<div class="fs-bilgi"><b>Müşteri Notu :</b> ${esc(o.not)}</div>` : ""}
       <div class="fs-odeme">Ödeme : ${esc(t.odemeAd || "")}</div>
       <div class="fs-bilgi">Sipariş No : #${o.siraNo || 1}</div>`
    : `<div class="fs-odeme">MASA : ${esc(o.masa)}</div>
       <div class="fs-bilgi">Sipariş No : ${o.siraNo || 1}. Sipariş</div>
       ${o.not ? `<div class="fs-bilgi"><b>Not :</b> ${esc(o.not)}</div>` : ""}`;

  $("fis").innerHTML = `
    <div class="fs-baslik">SUAT USTA MERSİN TANTUNİ</div>
    <div class="fs-alt-baslik">${paket ? esc(t.odemeAd || "Paket Servis") : "Sipariş Fişi"}</div>
    <div class="fs-cizgi"></div>
    ${bilgiBlok}
    <div class="fs-tarih">${saat}</div>`;
  $("fis").innerHTML += `
    ${satirlar}
    <div class="fs-cizgi"></div>
    <div class="fs-toplam-satir"><span>Toplam :</span><span>${para(o.toplam)}</span></div>
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
  siparisVerileri.set(o.id, o);
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
      <button class="duzenle-btn" title="Siparişi düzenle">✏️ Düzenle</button>
      <button class="yazdir-btn" title="Fiş yazdır">🖨️</button>
      <button class="hazir-btn">✓ Hazır / Teslim</button>
    </div>`;
  kart.querySelector(".hazir-btn").onclick = () => socket.emit("markDone", o.id);
  kart.querySelector(".yazdir-btn").onclick = () => fisYazdir(o);
  kart.querySelector(".duzenle-btn").onclick = () => duzenleAc(o.id);
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

// --- Admin sipariş düzenleme (kasadan ekleme/çıkarma) ---
function duzenleAc(id) {
  const o = siparisVerileri.get(id);
  const kart = document.querySelector(`.kart[data-id="${id}"]`);
  if (!o || !kart || kart.querySelector(".duzenle-alan")) return;
  const kalemler = o.urunler.map((u) => ({
    id: u.id, ad: u.ad, adet: u.adet, porsiyon: u.porsiyon || null,
    cikarilan: [...(u.cikarilan || [])], eklenen: (u.eklenen || []).map((e) => ({ ad: e.ad })), sadece: u.sadece || null,
  }));
  const div = document.createElement("div");
  div.className = "duzenle-alan";
  kart.appendChild(div);
  cizDuzenle(div, id, kalemler);
}

function cizDuzenle(div, id, kalemler) {
  const satirlar = kalemler.map((u, i) => {
    const ops = [u.porsiyon, u.sadece, (u.cikarilan.length ? "-" + u.cikarilan.join(",") : ""), (u.eklenen.length ? "+" + u.eklenen.map((e) => e.ad).join(",") : "")].filter(Boolean).join(" · ");
    return `<div class="d-satir">
      <span class="d-ad">${esc(u.ad)}${ops ? ` <small>${esc(ops)}</small>` : ""}</span>
      <span class="d-qty"><button class="d-eksi" data-i="${i}">−</button><b>${u.adet}</b><button class="d-arti" data-i="${i}">+</button></span>
      <button class="d-sil" data-i="${i}" title="Kaldır">✕</button>
    </div>`;
  }).join("");
  const menuOpts = adminMenu.map((m) => {
    const f = (m.porsiyonlar && m.porsiyonlar.length) ? m.porsiyonlar[0].fiyat : m.fiyat;
    return `<option value="${m.id}">${esc(m.ad)} (${f}₺)</option>`;
  }).join("");
  div.innerHTML = `
    <div class="d-liste">${satirlar || '<div class="d-bos">Ürün yok — en az bir ürün ekleyin</div>'}</div>
    <div class="d-ekle">
      <select class="d-menu"><option value="">+ Ürün ekle…</option>${menuOpts}</select>
      <button class="d-ekle-btn">Ekle</button>
    </div>
    <div class="d-butonlar">
      <button class="d-vazgec">Vazgeç</button>
      <button class="d-kaydet">✓ Kaydet</button>
    </div>`;
  div.querySelectorAll(".d-arti").forEach((b) => (b.onclick = () => { const i = +b.dataset.i; kalemler[i].adet = Math.min(50, kalemler[i].adet + 1); cizDuzenle(div, id, kalemler); }));
  div.querySelectorAll(".d-eksi").forEach((b) => (b.onclick = () => { const i = +b.dataset.i; kalemler[i].adet = Math.max(1, kalemler[i].adet - 1); cizDuzenle(div, id, kalemler); }));
  div.querySelectorAll(".d-sil").forEach((b) => (b.onclick = () => { kalemler.splice(+b.dataset.i, 1); cizDuzenle(div, id, kalemler); }));
  div.querySelector(".d-ekle-btn").onclick = () => {
    const mid = Number(div.querySelector(".d-menu").value);
    const m = adminMenu.find((x) => x.id === mid);
    if (!m) return;
    const porsiyon = (m.porsiyonlar && m.porsiyonlar.length) ? m.porsiyonlar[0].ad : null;
    kalemler.push({ id: m.id, ad: m.ad, adet: 1, porsiyon, cikarilan: [], eklenen: [], sadece: null });
    cizDuzenle(div, id, kalemler);
  };
  div.querySelector(".d-vazgec").onclick = () => div.remove();
  div.querySelector(".d-kaydet").onclick = async () => {
    if (!kalemler.length) { alert("En az bir ürün olmalı."); return; }
    const btn = div.querySelector(".d-kaydet"); btn.disabled = true; btn.textContent = "Kaydediliyor…";
    try {
      const r = await fetch("/api/admin/order/" + id, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urunler: kalemler.map((u) => ({ id: u.id, adet: u.adet, porsiyon: u.porsiyon, cikarilan: u.cikarilan, eklenen: u.eklenen, sadece: u.sadece })) }),
      });
      if (!r.ok) throw new Error();
      div.remove(); // orderChanged kartı yeniden çizecek (güncel tutarla)
    } catch { btn.disabled = false; btn.textContent = "✓ Kaydet"; alert("Kaydedilemedi, tekrar deneyin."); }
  };
}
