# Medya depolama ayarları

Uygulama, yeni eklenen dosyaların şifreli baytlarını PostgreSQL yerine Cloudflare
R2 veya Backblaze B2'de saklayabilir. Tarayıcı uçtan uca şifrelemeyi yüklemeden
önce yapar; bucket'ı özel tutun. Dosyalar, mevcut `/api` medya rotası üzerinden
alınır ve API yanıtı değiştirilmediği için istemci kodu sağlayıcıdan bağımsızdır.

`MEDIA_STORAGE_PROVIDER` değerini sunucu ortam değişkenlerine ekleyin:

- `database` — PostgreSQL kullanır; ayar belirtilmezse varsayılandır.
- `r2` — yeni dosyaları Cloudflare R2'ye yükler.
- `b2` — yeni dosyaları Backblaze B2'ye yükler.

## Cloudflare R2

Özel bir R2 bucket ve S3 API anahtarı oluşturun, ardından sunucuda şu ortam
değişkenlerini ayarlayın:

```text
MEDIA_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=<Cloudflare hesap kimliği>
R2_BUCKET=<bucket adı>
R2_ACCESS_KEY_ID=<R2 erişim anahtarı kimliği>
R2_SECRET_ACCESS_KEY=<R2 gizli erişim anahtarı>
```

`R2_ENDPOINT` isteğe bağlıdır; normalde hesap kimliğinden otomatik oluşturulur.

## Backblaze B2

S3 uyumlu bir B2 bucket ve yalnızca gereken bucket'a erişen bir uygulama anahtarı
oluşturun. Sunucuda şu ortam değişkenlerini ayarlayın:

```text
MEDIA_STORAGE_PROVIDER=b2
B2_BUCKET=<bucket adı>
B2_REGION=<bucket bölgesi, ör. us-west-004>
B2_KEY_ID=<uygulama anahtarı kimliği>
B2_APPLICATION_KEY=<uygulama anahtarı>
```

`B2_ENDPOINT` isteğe bağlıdır; normalde `B2_REGION` değerinden otomatik
oluşturulur.

## Mevcut mesajlar ve sağlayıcı değişimi

Mevcut PostgreSQL medya kayıtları olduğu gibi okunmaya devam eder; otomatik
taşınmaz. Yeni yüklemeler, `MEDIA_STORAGE_PROVIDER` ile seçilen sağlayıcıya
gider. Her dosya kaydında hangi sağlayıcı ve nesne anahtarının kullanıldığı
saklandığından, sağlayıcı değiştirilirken önceki dosyaları okuyabilmek için eski
bucket'ı ve erişim bilgilerini sunucu ortamında tutun.

Ortam değişkenlerini uygulamanın çalıştığı yerde ayarlayın (örneğin Render'da
servis ayarları → Environment). Anahtarları kaynak koda, `.env` dosyasına veya
istemci ortam değişkenlerine koymayın. Şema değişikliği dağıtım sırasında DB
push adımını gerektirir: `pnpm --filter @workspace/db run push`.
