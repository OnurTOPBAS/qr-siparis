const $ = (id) => document.getElementById(id);
$("cikis").onclick = async () => { await fetch("/admin/logout", { method: "POST" }); location.href = "/admin/login"; };

let urunler = [];
fetch("/api/admin/maliyet")
  .then((r) => r.json())
  .then((d) => { urunler = d.urunler || []; ciz(); })
  .catch(() => { $("liste").textContent = "Yüklenemedi."; });

const para = (n) => (Math.round(n * 100) / 100).toString().replace(".", ",");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function ciz(filtre = "") {
  const liste = $("liste");
  liste.innerHTML = "";
  const f = filtre.trim().toLowerCase();
  const gosterilecek = urunler.filter((u) => !f || u.ad.toLowerCase().includes(f));
  if (!gosterilecek.length) { liste.innerHTML = '<div class="m-bos">Ürün bulunamadı.</div>'; }
  gosterilecek.forEach((u) => liste.appendChild(kart(u)));
  ozetGuncelle();
}
$("ara").oninput = (e) => ciz(e.target.value);

function kart(u) {
  const div = document.createElement("div");
  div.className = "m-kart";
  const kalemler = (u.maliyet || []).map((k) => ({ ad: k.ad, tutar: k.tutar }));
  cizKart(div, u, kalemler);
  return div;
}

function cizKart(div, u, kalemler) {
  const rows = kalemler.map((k, i) => `
    <div class="m-kalem" data-i="${i}">
      <input class="m-ad" placeholder="Kalem (ör. Et, Lavaş, Ambalaj)" value="${esc(k.ad || "")}" />
      <input class="m-tutar" type="number" min="0" step="0.01" placeholder="₺" value="${k.tutar ?? ""}" />
      <button class="m-sil" title="Sil">✕</button>
    </div>`).join("");
  div.innerHTML = `
    <div class="m-baslik">
      <span class="m-ad-baslik">${esc(u.ad)}</span>
      ${u.kategori ? `<span class="m-kat">${esc(u.kategori)}</span>` : ""}
    </div>
    <div class="m-satis-satir">
      <label>Satış Fiyatı ${u.porsiyonlu ? "<small>(1 porsiyon)</small>" : ""}</label>
      <div class="m-satis-in"><input class="m-satis" type="number" min="0" step="0.01" value="${u.satis || 0}" /><span>₺</span></div>
    </div>
    <div class="m-kalemler">${rows}</div>
    <button class="m-kalem-ekle">+ Maliyet Kalemi Ekle</button>
    <div class="m-sonuc">
      <div class="m-satir"><span>Toplam Maliyet</span><b class="m-toplam">0 ₺</b></div>
      <div class="m-satir"><span>Kâr (Satış − Maliyet)</span><b class="m-kar">0 ₺</b></div>
      <div class="m-satir m-oran-satir"><span>Kâr Oranı</span><b class="m-oran">%0</b></div>
    </div>
    <div class="m-alt"><button class="m-kaydet">✓ Kaydet</button><span class="m-durum"></span></div>`;

  const senkron = () => {
    div.querySelectorAll(".m-kalem").forEach((row, i) => {
      kalemler[i] = { ad: row.querySelector(".m-ad").value, tutar: Number(row.querySelector(".m-tutar").value) || 0 };
    });
  };
  div.querySelectorAll(".m-sil").forEach((b) => (b.onclick = () => { senkron(); kalemler.splice(+b.closest(".m-kalem").dataset.i, 1); cizKart(div, u, kalemler); }));
  div.querySelector(".m-kalem-ekle").onclick = () => { senkron(); kalemler.push({ ad: "", tutar: "" }); cizKart(div, u, kalemler); };

  const hesapla = () => {
    senkron();
    const satis = Number(div.querySelector(".m-satis").value) || 0;
    const toplam = kalemler.reduce((s, k) => s + (Number(k.tutar) || 0), 0);
    const kar = satis - toplam;
    const oran = satis > 0 ? Math.round((kar / satis) * 100) : 0;
    div.querySelector(".m-toplam").textContent = para(toplam) + " ₺";
    const karEl = div.querySelector(".m-kar"); karEl.textContent = para(kar) + " ₺"; karEl.className = "m-kar " + (kar >= 0 ? "art" : "eks");
    const oranEl = div.querySelector(".m-oran"); oranEl.textContent = "%" + oran; oranEl.className = "m-oran " + (kar >= 0 ? "art" : "eks");
  };
  div.querySelectorAll("input").forEach((inp) => (inp.oninput = hesapla));
  hesapla();

  div.querySelector(".m-kaydet").onclick = async () => {
    hesapla();
    const satis = Number(div.querySelector(".m-satis").value) || 0;
    const temiz = kalemler.filter((k) => (k.ad && k.ad.trim()) || k.tutar);
    const btn = div.querySelector(".m-kaydet"); btn.disabled = true;
    const durum = div.querySelector(".m-durum");
    try {
      const r = await fetch("/api/admin/maliyet/" + u.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ satis, maliyet: temiz }) });
      if (!r.ok) throw new Error();
      durum.textContent = "Kaydedildi ✓"; durum.className = "m-durum ok";
      u.satis = satis; u.maliyet = temiz;
      ozetGuncelle();
      setTimeout(() => { durum.textContent = ""; }, 2000);
    } catch { durum.textContent = "Hata, tekrar dene"; durum.className = "m-durum hata"; }
    finally { btn.disabled = false; }
  };
}

function ozetGuncelle() {
  const n = urunler.length;
  const oranlar = urunler.filter((u) => u.satis > 0 && u.maliyet && u.maliyet.length).map((u) => {
    const t = u.maliyet.reduce((s, k) => s + (Number(k.tutar) || 0), 0);
    return ((u.satis - t) / u.satis) * 100;
  });
  const ort = oranlar.length ? Math.round(oranlar.reduce((a, b) => a + b, 0) / oranlar.length) : 0;
  const eksik = urunler.filter((u) => !(u.maliyet && u.maliyet.length)).length;
  $("ozet").innerHTML =
    `<div class="o-kutu"><b>${n}</b><span>Ürün</span></div>` +
    `<div class="o-kutu"><b>%${ort}</b><span>Ort. Kâr Oranı</span></div>` +
    `<div class="o-kutu"><b>${eksik}</b><span>Maliyeti Girilmemiş</span></div>`;
}
