const $ = (id) => document.getElementById(id);
let veri = null;
let aktifPeriyot = "gunluk";

async function raporGetir() {
  try {
    const r = await fetch("/api/report");
    veri = await r.json();
    ciz();
  } catch {
    $("bosRapor").hidden = false;
    $("bosRapor").textContent = "Rapor yüklenemedi.";
  }
}

function ciz() {
  if (!veri) return;
  const d = veri[aktifPeriyot];
  $("ciro").textContent = (d.ciro || 0).toLocaleString("tr-TR") + " ₺";
  $("siparis").textContent = d.siparis || 0;
  $("cesit").textContent = d.urunler.length;

  const govde = $("tabloGovde");
  govde.innerHTML = "";
  d.urunler.forEach((u, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(u.ad)}</td>
      <td class="sag"><b>${u.adet}</b></td>
      <td class="sag">${u.ciro.toLocaleString("tr-TR")} ₺</td>`;
    govde.appendChild(tr);
  });
  $("bosRapor").hidden = d.urunler.length > 0;
  document.querySelector(".rapor-tablo").style.display = d.urunler.length ? "" : "none";
}

// Sekme geçişleri
document.querySelectorAll(".sekme").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".sekme").forEach((b) => b.classList.remove("aktif"));
    btn.classList.add("aktif");
    aktifPeriyot = btn.dataset.p;
    ciz();
  };
});

$("yenile").onclick = raporGetir;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

raporGetir();
