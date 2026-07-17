const $ = (id) => document.getElementById(id);

$("cikis").onclick = async () => { await fetch("/admin/logout", { method: "POST" }); location.href = "/admin/login"; };
$("yenile").onclick = yukle;

async function yukle() {
  let d;
  try { d = await (await fetch("/api/admin/gecmis")).json(); }
  catch { $("bos").hidden = false; $("bos").textContent = "Yüklenemedi."; return; }

  $("adet").textContent = d.adet;
  $("ciro").textContent = (d.ciro || 0).toLocaleString("tr-TR") + " ₺";

  const liste = $("liste");
  liste.innerHTML = "";
  $("bos").hidden = d.siparisler.length > 0;

  d.siparisler.forEach((o) => {
    const saat = new Date(o.tarih).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    const durum = o.durum === "hazir"
      ? '<span class="rozet yesil">✓ Teslim</span>'
      : '<span class="rozet gri">Bekliyor</span>';
    const urunler = o.urunler.map((u) => {
      const porsiyon = u.porsiyon ? ` <span class="k-porsiyon">${esc(u.porsiyon)}</span>` : "";
      const sadece = u.sadece ? ` <span class="k-sadece">⚡ ${esc(u.sadece)}</span>` : "";
      const cikar = (u.cikarilan && u.cikarilan.length) ? ` <span class="k-cikar">🚫 ${esc(u.cikarilan.join(", "))}</span>` : "";
      const ekle = (u.eklenen && u.eklenen.length) ? ` <span class="k-ekle">➕ ${esc(u.eklenen.map((e) => e.ad).join(", "))}</span>` : "";
      return `<li><b>${u.adet}×</b> ${esc(u.ad)}${porsiyon}${sadece}${cikar}${ekle}</li>`;
    }).join("");

    const kart = document.createElement("div");
    kart.className = "gecmis-kart";
    kart.innerHTML = `
      <div class="gk-ust">
        <span class="gk-masa">Masa ${esc(o.masa)}</span>
        <span class="gk-sira">${o.siraNo || 1}. Sipariş</span>
        <span class="gk-saat">${saat}</span>
        ${durum}
      </div>
      <ul class="gk-urunler">${urunler}</ul>
      ${o.not ? `<div class="not">📝 ${esc(o.not)}</div>` : ""}
      <div class="gk-alt"><span class="gk-toplam">${o.toplam.toLocaleString("tr-TR")} ₺</span></div>`;
    liste.appendChild(kart);
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

yukle();
