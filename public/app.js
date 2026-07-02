// Masa numarasını QR linkinden al: /?masa=5
const params = new URLSearchParams(location.search);
const masa = params.get("masa") || "1";
document.getElementById("masaNo").textContent = masa;

let menu = [];
const sepet = new Map(); // id -> { urun, adet }

const $ = (id) => document.getElementById(id);

// --- Menüyü yükle ve ekrana bas ---
fetch("/api/menu")
  .then((r) => r.json())
  .then((data) => {
    menu = data.urunler || [];
    const c = $("menu");
    c.innerHTML = "";

    // Ürünleri kategoriye göre grupla (ilk görülme sırasını koru)
    const kategoriler = [];
    const grup = new Map();
    menu.forEach((u) => {
      const k = u.kategori || "Diğer";
      if (!grup.has(k)) { grup.set(k, []); kategoriler.push(k); }
      grup.get(k).push(u);
    });

    kategoriler.forEach((katAd) => {
      const h = document.createElement("h2");
      h.className = "kategori";
      h.textContent = katAd;
      c.appendChild(h);

      grup.get(katAd).forEach((u) => {
        const div = document.createElement("div");
        div.className = "urun";
        div.innerHTML = `
          <img src="${u.resim}" alt="${u.ad}" onerror="this.style.visibility='hidden'">
          <div class="urun-bilgi">
            <h3>${u.ad}</h3>
            <p>${u.aciklama || ""}</p>
            <div class="urun-alt">
              <span class="fiyat">${u.fiyat} ₺</span>
              <div class="adet-kontrol" data-id="${u.id}">
                <button class="eksi">−</button>
                <span class="adet">0</span>
                <button class="arti">+</button>
              </div>
            </div>
          </div>`;
        div.querySelector(".arti").onclick = () => degistir(u, 1);
        div.querySelector(".eksi").onclick = () => degistir(u, -1);
        c.appendChild(div);
      });
    });
  });

function degistir(urun, delta) {
  const mevcut = sepet.get(urun.id)?.adet || 0;
  const yeni = Math.max(0, mevcut + delta);
  if (yeni === 0) sepet.delete(urun.id);
  else sepet.set(urun.id, { urun, adet: yeni });

  // ürün kartındaki adeti güncelle
  const el = document.querySelector(`.adet-kontrol[data-id="${urun.id}"] .adet`);
  if (el) el.textContent = yeni;
  guncelleSepetCubugu();
}

function toplamlar() {
  let adet = 0,
    tutar = 0;
  for (const { urun, adet: a } of sepet.values()) {
    adet += a;
    tutar += urun.fiyat * a;
  }
  return { adet, tutar };
}

function guncelleSepetCubugu() {
  const { adet, tutar } = toplamlar();
  $("sepetAdet").textContent = adet;
  $("sepetToplam").textContent = tutar;
  $("sepetBtn").hidden = adet === 0;
}

// --- Sepet paneli ---
$("sepetBtn").onclick = () => {
  cizSepet();
  $("sepetPanel").hidden = false;
};
$("kapatBtn").onclick = () => ($("sepetPanel").hidden = true);

function cizSepet() {
  const liste = $("sepetListe");
  liste.innerHTML = "";
  for (const { urun, adet } of sepet.values()) {
    const row = document.createElement("div");
    row.className = "sepet-satir";
    row.innerHTML = `
      <span class="s-ad">${urun.ad}</span>
      <div class="adet-kontrol" data-id="${urun.id}">
        <button class="eksi">−</button>
        <span class="adet">${adet}</span>
        <button class="arti">+</button>
      </div>
      <span class="s-fiyat">${urun.fiyat * adet} ₺</span>`;
    row.querySelector(".arti").onclick = () => {
      degistir(urun, 1);
      cizSepet();
    };
    row.querySelector(".eksi").onclick = () => {
      degistir(urun, -1);
      cizSepet();
    };
    liste.appendChild(row);
  }
  $("panelToplam").textContent = toplamlar().tutar;
  if (sepet.size === 0) $("sepetPanel").hidden = true;
}

// --- Siparişi gönder ---
$("siparisVerBtn").onclick = async () => {
  if (sepet.size === 0) return;
  const btn = $("siparisVerBtn");
  btn.disabled = true;
  btn.textContent = "Gönderiliyor...";
  const payload = {
    masa,
    not: $("not").value.trim(),
    urunler: [...sepet.values()].map(({ urun, adet }) => ({
      ad: urun.ad,
      adet,
      fiyat: urun.fiyat,
    })),
  };
  try {
    const r = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error();
    // Başarılı → temizle + onay göster
    sepet.clear();
    $("not").value = "";
    guncelleSepetCubugu();
    $("sepetPanel").hidden = true;
    $("onayMasa").textContent = masa;
    $("onay").hidden = false;
  } catch {
    alert("Sipariş gönderilemedi, lütfen tekrar deneyin.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Siparişi Gönder";
  }
};

$("onayKapat").onclick = () => {
  $("onay").hidden = true;
  // ürün kartlarındaki adetleri sıfırla
  document.querySelectorAll(".adet-kontrol .adet").forEach((e) => (e.textContent = "0"));
};
