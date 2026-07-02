const $ = (id) => document.getElementById(id);
let masalar = [];

$("cikis").onclick = async () => { await fetch("/admin/logout", { method: "POST" }); location.href = "/admin/login"; };

// Müşteri menüsünün canlı adresi (bu sayfa hangi origin'deyse o)
const siteKok = location.origin;

async function yukle() {
  const r = await fetch("/api/admin/tables");
  masalar = await r.json();
  ciz();
}

async function ciz() {
  const grid = $("grid");
  grid.innerHTML = "";
  for (const m of masalar) {
    const url = `${siteKok}/?masa=${encodeURIComponent(m.ad)}`;
    const kart = document.createElement("div");
    kart.className = "masa-kart";
    kart.innerHTML = `
      <h3>Masa ${esc(m.ad)}</h3>
      <img alt="QR" data-url="${esc(url)}" />
      <div class="qr-link">${esc(url)}</div>
      <div class="masa-butonlar no-print">
        <button class="buton-tehlike sil">Sil</button>
      </div>`;
    kart.querySelector(".sil").onclick = () => sil(m);
    grid.appendChild(kart);

    // QR üret
    const img = kart.querySelector("img");
    try {
      const q = await fetch("/api/admin/qr?url=" + encodeURIComponent(url));
      const d = await q.json();
      img.src = d.dataUrl;
    } catch { img.alt = "QR üretilemedi"; }
  }
}

$("ekleForm").onsubmit = async (e) => {
  e.preventDefault();
  const ad = $("masaAd").value.trim();
  if (!ad) return;
  const r = await fetch("/api/admin/tables", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ad }),
  });
  if (r.ok) { $("masaAd").value = ""; yukle(); }
  else { const d = await r.json().catch(() => ({})); alert(d.error || "Eklenemedi"); }
};

async function sil(m) {
  if (!confirm(`Masa ${m.ad} silinsin mi?`)) return;
  await fetch("/api/admin/tables/" + m.id, { method: "DELETE" });
  yukle();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

yukle();
