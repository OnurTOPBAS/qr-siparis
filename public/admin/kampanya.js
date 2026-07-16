const $ = (id) => document.getElementById(id);
const KAMPANYA_KATEGORI = "Kampanyalı Menülerimiz";
let kampanyalar = [];

$("cikis").onclick = async () => { await fetch("/admin/logout", { method: "POST" }); location.href = "/admin/login"; };

async function yukle() {
  const d = await (await fetch("/api/admin/menu")).json();
  kampanyalar = (d.urunler || []).filter((u) => u.kampanya);
  ciz();
}

function ciz() {
  const liste = $("liste");
  liste.innerHTML = "";
  $("bos").hidden = kampanyalar.length > 0;

  kampanyalar.forEach((u) => {
    const row = document.createElement("div");
    row.className = "urun-satir";
    const fiyatHtml = u.eskiFiyat
      ? `<s style="color:#777;font-size:.8rem">${u.eskiFiyat} ₺</s> <b>${u.fiyat} ₺</b>`
      : `<b>${u.fiyat} ₺</b>`;
    row.innerHTML = `
      <img src="/${esc(u.resim || "")}" onerror="this.style.visibility='hidden'" alt="">
      <div class="us-bilgi">
        <div class="us-ad">🔥 ${esc(u.ad)}</div>
        <div class="us-kat">${esc(u.aciklama || "")}</div>
      </div>
      <span class="us-fiyat">${fiyatHtml}</span>
      <button class="buton-ikincil duzenle">Düzenle</button>
      <button class="buton-tehlike sil">Sil</button>`;
    row.querySelector(".duzenle").onclick = () => modalAc(u);
    row.querySelector(".sil").onclick = () => sil(u);
    liste.appendChild(row);
  });
}

function modalAc(u) {
  $("hata").textContent = "";
  $("modalBaslik").textContent = u ? "Kampanyayı Düzenle" : "Yeni Kampanya";
  $("urunId").value = u?.id || "";
  $("ad").value = u?.ad || "";
  $("aciklama").value = u?.aciklama || "";
  $("fiyat").value = u?.fiyat ?? 0;
  $("eskiFiyat").value = u?.eskiFiyat || "";
  $("kalori").value = u?.kalori || "";
  $("resim").value = u?.resim || "";
  $("gorsel").value = "";
  const onz = $("onizleme");
  if (u?.resim) { onz.src = "/" + u.resim; onz.hidden = false; } else { onz.hidden = true; }
  $("modal").hidden = false;
}
$("yeniKampanya").onclick = () => modalAc(null);
$("iptal").onclick = () => ($("modal").hidden = true);

$("gorsel").onchange = async () => {
  const f = $("gorsel").files[0];
  if (!f) return;
  const onz = $("onizleme");
  onz.src = URL.createObjectURL(f);
  onz.hidden = false;
  const fd = new FormData();
  fd.append("gorsel", f);
  const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
  if (r.ok) $("resim").value = (await r.json()).resim;
  else $("hata").textContent = "Görsel yüklenemedi.";
};

$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("hata").textContent = "";
  const govde = {
    id: $("urunId").value ? Number($("urunId").value) : null,
    ad: $("ad").value.trim(),
    kategori: KAMPANYA_KATEGORI,
    kampanya: true,
    fiyat: Number($("fiyat").value) || 0,
    eskiFiyat: Number($("eskiFiyat").value) || 0,
    kalori: $("kalori").value.trim(),
    aciklama: $("aciklama").value.trim(),
    resim: $("resim").value,
  };
  const r = await fetch("/api/admin/menu/urun", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde),
  });
  if (r.ok) { $("modal").hidden = true; yukle(); }
  else { const d = await r.json().catch(() => ({})); $("hata").textContent = d.error || "Kaydedilemedi."; }
};

async function sil(u) {
  if (!confirm(`"${u.ad}" kampanyası silinsin mi?`)) return;
  await fetch("/api/admin/menu/urun/" + u.id, { method: "DELETE" });
  yukle();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

yukle();
