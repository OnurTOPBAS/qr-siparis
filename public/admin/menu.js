const $ = (id) => document.getElementById(id);
let urunler = [];

$("cikis").onclick = async () => { await fetch("/admin/logout", { method: "POST" }); location.href = "/admin/login"; };

async function yukle() {
  const r = await fetch("/api/admin/menu");
  const d = await r.json();
  urunler = d.urunler || [];
  ciz();
}

function ciz() {
  const liste = $("liste");
  liste.innerHTML = "";
  $("bos").hidden = urunler.length > 0;

  // Kategoriye göre grupla (sıra korunur)
  const sira = [];
  const grup = new Map();
  urunler.forEach((u) => {
    const k = u.kategori || "Diğer";
    if (!grup.has(k)) { grup.set(k, []); sira.push(k); }
    grup.get(k).push(u);
  });

  // Kategori önerileri (datalist)
  $("kategoriListe").innerHTML = sira.map((k) => `<option value="${esc(k)}">`).join("");

  sira.forEach((kat) => {
    const h = document.createElement("h3");
    h.className = "kategori-basligi";
    h.textContent = kat;
    liste.appendChild(h);

    grup.get(kat).forEach((u) => {
      const row = document.createElement("div");
      row.className = "urun-satir";
      row.innerHTML = `
        <img src="/${esc(u.resim || "")}" onerror="this.style.visibility='hidden'" alt="">
        <div class="us-bilgi">
          <div class="us-ad">${esc(u.ad)}</div>
          <div class="us-kat">${esc(u.aciklama || "")}</div>
        </div>
        <span class="us-fiyat">${u.fiyat} ₺</span>
        <button class="buton-ikincil duzenle">Düzenle</button>
        <button class="buton-tehlike sil">Sil</button>`;
      row.querySelector(".duzenle").onclick = () => modalAc(u);
      row.querySelector(".sil").onclick = () => silUrun(u);
      liste.appendChild(row);
    });
  });
}

// --- Modal ---
function modalAc(u) {
  $("hata").textContent = "";
  $("modalBaslik").textContent = u ? "Ürünü Düzenle" : "Yeni Ürün";
  $("urunId").value = u?.id || "";
  $("ad").value = u?.ad || "";
  $("kategori").value = u?.kategori || "";
  $("fiyat").value = u?.fiyat ?? "";
  $("aciklama").value = u?.aciklama || "";
  $("resim").value = u?.resim || "";
  $("gorsel").value = "";
  const onz = $("onizleme");
  if (u?.resim) { onz.src = "/" + u.resim; onz.hidden = false; } else { onz.hidden = true; }
  $("modal").hidden = false;
}
$("yeniUrun").onclick = () => modalAc(null);
$("iptal").onclick = () => ($("modal").hidden = true);

// Görsel seçilince önizle + yükle
$("gorsel").onchange = async () => {
  const f = $("gorsel").files[0];
  if (!f) return;
  const onz = $("onizleme");
  onz.src = URL.createObjectURL(f);
  onz.hidden = false;
  const fd = new FormData();
  fd.append("gorsel", f);
  const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
  if (r.ok) {
    const d = await r.json();
    $("resim").value = d.resim;
  } else {
    $("hata").textContent = "Görsel yüklenemedi.";
  }
};

// Kaydet
$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("hata").textContent = "";
  const govde = {
    id: $("urunId").value ? Number($("urunId").value) : null,
    ad: $("ad").value.trim(),
    kategori: $("kategori").value.trim(),
    fiyat: Number($("fiyat").value),
    aciklama: $("aciklama").value.trim(),
    resim: $("resim").value,
  };
  const r = await fetch("/api/admin/menu/urun", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(govde),
  });
  if (r.ok) {
    $("modal").hidden = true;
    yukle();
  } else {
    const d = await r.json().catch(() => ({}));
    $("hata").textContent = d.error || "Kaydedilemedi.";
  }
};

async function silUrun(u) {
  if (!confirm(`"${u.ad}" silinsin mi?`)) return;
  await fetch("/api/admin/menu/urun/" + u.id, { method: "DELETE" });
  yukle();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

yukle();
