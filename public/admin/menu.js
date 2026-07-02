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

  const sira = [];
  const grup = new Map();
  urunler.forEach((u) => {
    const k = u.kategori || "Diğer";
    if (!grup.has(k)) { grup.set(k, []); sira.push(k); }
    grup.get(k).push(u);
  });

  $("kategoriListe").innerHTML = sira.map((k) => `<option value="${esc(k)}">`).join("");

  sira.forEach((kat) => {
    const h = document.createElement("h3");
    h.className = "kategori-basligi";
    h.textContent = kat;
    liste.appendChild(h);

    grup.get(kat).forEach((u) => {
      const porsiyonlu = Array.isArray(u.porsiyonlar) && u.porsiyonlar.length;
      const altBilgi = porsiyonlu
        ? `${u.porsiyonlar.length} porsiyon`
        : (u.kalori ? u.kalori + " kcal" : (u.aciklama || ""));
      const row = document.createElement("div");
      row.className = "urun-satir";
      row.innerHTML = `
        <img src="/${esc(u.resim || "")}" onerror="this.style.visibility='hidden'" alt="">
        <div class="us-bilgi">
          <div class="us-ad">${esc(u.ad)}</div>
          <div class="us-kat">${esc(altBilgi)}</div>
        </div>
        <span class="us-fiyat">${porsiyonlu ? "Porsiyonlu" : u.fiyat + " ₺"}</span>
        <button class="buton-ikincil duzenle">Düzenle</button>
        <button class="buton-tehlike sil">Sil</button>`;
      row.querySelector(".duzenle").onclick = () => modalAc(u);
      row.querySelector(".sil").onclick = () => silUrun(u);
      liste.appendChild(row);
    });
  });
}

// --- Porsiyon satırı editörü ---
function porsiyonSatiri(p = {}) {
  const div = document.createElement("div");
  div.className = "porsiyon-satir";
  div.innerHTML = `
    <input class="p-ad" placeholder="Ad (Dürüm)" value="${esc(p.ad || "")}" />
    <input class="p-fiyat" type="number" min="0" placeholder="₺" value="${p.fiyat ?? ""}" />
    <input class="p-kalori" placeholder="Kalori" value="${esc(p.kalori || "")}" />
    <button type="button" class="p-sil">✕</button>`;
  div.querySelector(".p-sil").onclick = () => div.remove();
  return div;
}
$("porsiyonEkle").onclick = () => $("porsiyonListe").appendChild(porsiyonSatiri());

// --- Ekstra (eklenebilir) malzeme satırı ---
function ekstraSatiri(e = {}) {
  const div = document.createElement("div");
  div.className = "porsiyon-satir ekstra-satir";
  div.innerHTML = `
    <input class="e-ad" placeholder="Ekstra (Kaşar)" value="${esc(e.ad || "")}" />
    <input class="e-fiyat" type="number" min="0" placeholder="₺" value="${e.fiyat ?? ""}" />
    <button type="button" class="p-sil">✕</button>`;
  div.querySelector(".p-sil").onclick = () => div.remove();
  return div;
}
$("ekstraEkle").onclick = () => $("ekstraListe").appendChild(ekstraSatiri());

// --- Modal ---
function modalAc(u) {
  $("hata").textContent = "";
  $("modalBaslik").textContent = u ? "Ürünü Düzenle" : "Yeni Ürün";
  $("urunId").value = u?.id || "";
  $("ad").value = u?.ad || "";
  $("kategori").value = u?.kategori || "";
  $("fiyat").value = u?.fiyat ?? 0;
  $("kalori").value = u?.kalori || "";
  $("aciklama").value = u?.aciklama || "";
  $("resim").value = u?.resim || "";
  $("gorsel").value = "";
  const onz = $("onizleme");
  if (u?.resim) { onz.src = "/" + u.resim; onz.hidden = false; } else { onz.hidden = true; }

  // Porsiyonlar
  const pl = $("porsiyonListe");
  pl.innerHTML = "";
  (u?.porsiyonlar || []).forEach((p) => pl.appendChild(porsiyonSatiri(p)));

  // Çıkarılabilir malzemeler
  const secili = new Set(u?.cikarilabilir || []);
  document.querySelectorAll(".mal").forEach((cb) => (cb.checked = secili.has(cb.value)));

  // Eklenebilir ekstralar
  const el = $("ekstraListe");
  el.innerHTML = "";
  (u?.eklenebilir || []).forEach((e) => el.appendChild(ekstraSatiri(e)));

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
  if (r.ok) { $("resim").value = (await r.json()).resim; }
  else { $("hata").textContent = "Görsel yüklenemedi."; }
};

// Kaydet
$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("hata").textContent = "";

  const porsiyonlar = [...document.querySelectorAll(".porsiyon-satir")]
    .map((row) => ({
      ad: row.querySelector(".p-ad").value.trim(),
      fiyat: Number(row.querySelector(".p-fiyat").value) || 0,
      kalori: row.querySelector(".p-kalori").value.trim(),
    }))
    .filter((p) => p.ad);

  const cikarilabilir = [...document.querySelectorAll(".mal:checked")].map((cb) => cb.value);

  const eklenebilir = [...document.querySelectorAll(".ekstra-satir")]
    .map((row) => ({ ad: row.querySelector(".e-ad").value.trim(), fiyat: Number(row.querySelector(".e-fiyat").value) || 0 }))
    .filter((e) => e.ad);

  const govde = {
    id: $("urunId").value ? Number($("urunId").value) : null,
    ad: $("ad").value.trim(),
    kategori: $("kategori").value.trim(),
    fiyat: Number($("fiyat").value) || 0,
    kalori: $("kalori").value.trim(),
    aciklama: $("aciklama").value.trim(),
    resim: $("resim").value,
    porsiyonlar,
    cikarilabilir,
    eklenebilir,
  };

  const r = await fetch("/api/admin/menu/urun", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(govde),
  });
  if (r.ok) { $("modal").hidden = true; yukle(); }
  else { const d = await r.json().catch(() => ({})); $("hata").textContent = d.error || "Kaydedilemedi."; }
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
