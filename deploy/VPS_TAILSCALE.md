# Deploy CandleNote 24/7 on a Cloud VPS + Tailscale

สถาปัตยกรรม:
- `db`, `backend`, `frontend` อยู่ใน Docker network ภายใน (ไม่เปิดพอร์ตออกเน็ต)
- `proxy` (Caddy) รวม Frontend (`/`) + API (`/api/*`) + WebSocket (`/ws/*`) ไว้ที่ `127.0.0.1:8080`
- **Tailscale Serve** เปิด HTTPS + WSS (`https://<vps-name>.<tailnet>.ts.net`) ให้เฉพาะอุปกรณ์ในบัญชี Tailscale ของคุณเท่านั้น (ไม่ต้องซื้อโดเมน ไม่ต้องเขียนหน้า Login)

---

## 1. เตรียมเครื่อง VPS (Ubuntu 22.04 / 24.04)

```bash
# ติดตั้ง Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# ล็อกเอาต์แล้ว SSH เข้ามาใหม่เพื่อให้สิทธิ์ docker ทำงาน

# เปิด Firewall ให้ผ่านเฉพาะ SSH (ไม่ต้องเปิด 80/443/3000/8010/5433)
sudo ufw allow OpenSSH
sudo ufw enable
```

## 2. ติดตั้ง Tailscale และเปิด HTTPS

1. ติดตั้ง Tailscale บน VPS:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
2. เข้า [Tailscale Admin Console → DNS](https://login.tailscale.com/admin/dns) แล้วเปิด:
   - **MagicDNS**
   - **HTTPS Certificates**
3. ติดตั้งแอป Tailscale บนมือถือ/คอมพิวเตอร์ของคุณแล้วล็อกอินบัญชีเดียวกัน

## 3. Deploy CandleNote

```bash
git clone <YOUR_PRIVATE_REPO_URL> candlenote
cd candlenote

cp deploy/.env.prod.example .env.prod
nano .env.prod   # ตั้ง POSTGRES_PASSWORD ให้ยาว/สุ่ม และใส่ FINNHUB_API_KEY + TWELVEDATA_API_KEY

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

ตรวจสอบสถานะ (ควรเห็นทุก container เป็น `Up` / `healthy`):
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl http://127.0.0.1:8080/health
```

## 4. เปิดใช้งานผ่าน Tailscale HTTPS

```bash
sudo tailscale serve --bg 8080
sudo tailscale serve status
```

จะได้ URL รูปแบบ `https://<vps-name>.<tailnet>.ts.net` — เปิดจากมือถือหรือคอมที่ต่อ Tailscale ได้ทันทีทั้ง Watchlist (WebSocket `wss://`), MT5 Import และ Analytics

## 5. ตั้ง Backup ฐานข้อมูลอัตโนมัติทุกวัน

```bash
mkdir -p ~/candlenote-backups
(crontab -l 2>/dev/null; echo "0 3 * * * docker exec candlenote_db pg_dump -U investing investing | gzip > \$HOME/candlenote-backups/candlenote-\$(date +\%F).sql.gz && find \$HOME/candlenote-backups -name '*.sql.gz' -mtime +14 -delete") | crontab -
```

## 6. การอัปเดตโค้ดในอนาคต

```bash
cd ~/candlenote
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
