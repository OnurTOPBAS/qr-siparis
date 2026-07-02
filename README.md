# QR Sipariş Sistemi

QR menü + canlı sipariş bildirim sistemi. Müşteri QR okutur → menüden sipariş verir (not ekleyebilir) → kasadaki panele anında ses + kart olarak düşer.

## Teknoloji
- Node.js + Express (sunucu)
- Socket.io (canlı bildirim / WebSocket)
- Saf HTML/CSS/JS (arayüz)

## Yerelde çalıştırma
```bash
npm install
npm start
```
- Müşteri menüsü: http://localhost:3000/?masa=5
- Kasa paneli:    http://localhost:3000/admin

## Sayfalar
| Adres | Açıklama |
|-------|----------|
| `/?masa=N` | Müşteri menüsü. Masa numarası QR linkinden gelir. Sepet + sipariş notu. |
| `/admin` | Kasa paneli. Yeni sipariş = ses + kart (masa, ürünler, not, toplam). "Hazır" ile kapatılır. |

## Yayına alma (Render — ücretsiz)
1. Projeyi GitHub'a yükle.
2. render.com → New → **Blueprint** → repoyu seç (repodaki `render.yaml` ayarları otomatik okur).
3. Deploy bitince `https://<uygulama>.onrender.com` adresi verilir.
4. QR kodları bu adrese `?masa=1`, `?masa=2` ... şeklinde üretilir.
