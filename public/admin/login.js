const form = document.getElementById("form");
const hata = document.getElementById("hata");

form.onsubmit = async (e) => {
  e.preventDefault();
  hata.textContent = "";
  const sifre = document.getElementById("sifre").value;
  try {
    const r = await fetch("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sifre }),
    });
    if (r.ok) {
      location.href = "/admin";
    } else {
      hata.textContent = "Şifre hatalı, tekrar deneyin.";
    }
  } catch {
    hata.textContent = "Sunucuya ulaşılamadı.";
  }
};
