# Veil Chat — taşınabilir kaynak paketi

Bu arşiv, Veil Chat web arayüzünü, API sunucusunu ve Docker Compose ile tek komutluk dağıtım dosyalarını içerir. Supabase kullanmaz; PostgreSQL ve Drizzle şemasıyla çalışır. Yeni odalarda tarayıcı, davet bağlantısının `#` parçasında kalan ECDH P-256 özel anahtarıyla her ileti ve dosya için tek kullanımlık bir anahtar türetir; içerik AES-GCM 256 ile şifrelenir. Sunucu özel anahtarı veya açık içeriği almaz. Eski AES anahtarlı davet bağlantıları ve kayıtlar da okunabilir. Dosya boyutu sınırı `MAX_UPLOAD_SIZE_MB` ortam değişkeninden okunur; belirtilmezse 10 MiB kullanılır. Yeni dosyalar Cloudflare R2 veya Backblaze B2'ye yüklenir ve uygulama üzerinden sunulur.

## Gereksinimler

- Node.js 22 veya üzeri
- pnpm 10
- Docker Engine ve Docker Compose eklentisi (tek komut dağıtımı için)
- Yerel PostgreSQL 16 (Docker'sız geliştirme için)

## Hızlı başlangıç

1. Bu klasörde bağımlılıkları yükleyin:

   ```sh
   pnpm install
   ```

2. Yerel ayar dosyasını oluşturun:

   ```sh
   cp .env.example .env
   ```

   Windows PowerShell'de:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Yerel geliştirme için Docker Compose ile yalnızca PostgreSQL'i başlatın:

   ```sh
   docker compose up -d postgres
   ```

   Docker kullanmıyorsanız, `.env` içindeki `DATABASE_URL` değerini kendi PostgreSQL bağlantınıza göre ayarlayın.

4. Uygulamayı ve API'yi başlatın:

   ```sh
   node scripts/dev-local.mjs
   ```

5. `http://localhost:5173` adresini açın.

Başlatma betiği şemayı yerel veritabanına uygular, API'yi `3001` ve web uygulamasını `5173` portunda açar. Portları `.env` dosyasından değiştirebilirsiniz.

## Tek komutla Docker dağıtımı

Docker Engine ve Compose eklentisi bulunan bir sunucuda arşivi açtıktan sonra:

```sh
docker compose up --build -d
```

Uygulama `APP_PORT` (varsayılan `3000`) portunda açılır. PostgreSQL verileri kalıcı `veil-chat-postgres` Docker volume'ünde tutulur; veritabanı portu varsayılan olarak yalnızca sunucunun kendisine (`127.0.0.1`) açılır. Durdurmak için `docker compose down`, veritabanını silmeden yeniden başlatmak için `docker compose up -d` kullanın.

Bu paket Docker Compose çalıştırabilen VPS veya barındırma hizmetlerinde taşınabilir. Her barındırma platformu aynı dağıtım biçimini desteklemez; Docker Compose kabul etmeyen bir platform için onun istediği ayarların yapılması gerekir. İnternete açmadan önce `.env` dosyasında `POSTGRES_PASSWORD` değerini değiştirin ve aynı bilgiyi `CONTAINER_DATABASE_URL` içine yazın. HTTPS, veritabanı yedekleri, saklama süresi ve anonim uç noktalara yönelik kötüye kullanım önlemlerini de ortamınızda yapılandırın.

## Ayrı derleme

```sh
pnpm --filter @workspace/veil-chat run build
```

Web dosyaları `artifacts/veil-chat/dist/public` altında oluşturulur. API sunucusunu ayrıca dağıtmanız ve `DATABASE_URL` ile `PORT` değişkenlerini ayarlamanız gerekir.

## Gizlilik notu

Sunucu oda kimliğini, zaman damgalarını, dosya türünü ve yaklaşık boyutunu görür; içerik şifreli saklanır. Oda davet bağlantısının tamamına erişen herkes oda özel anahtarını ve içeriği okuyabilir. Bu yapılandırmada oda ve yükleme sayısı için toplam kota veya otomatik saklama süresi yoktur; dosya başına 10 MiB sınırı vardır. `.env` dosyanızı ya da üretim veritabanı kimlik bilgilerinizi paylaşmayın.
