# Medya depolama ayarları

Uygulama, yeni eklenen dosyaların şifreli baytlarını Cloudflare R2 veya Backblaze
B2'de saklar. Tarayıcı uçtan uca şifrelemeyi yüklemeden önce yapar; bucket'ı özel
tutun. Dosyalar yerel diske yazılır, seçilen bucket'a aktarılır ve uygulamanın
`/api` medya rotası üzerinden istemciye sunulur.

`MEDIA_STORAGE_PROVIDER` değerini sunucu ortam değişkenlerine ekleyin:

- `r2` — yeni dosyaları Cloudflare R2'ye yükler.
- `b2` — yeni dosyaları Backblaze B2'ye yükler.

Yeni dosya yüklemelerinde bir sağlayıcı zorunludur; ayarlanmamışsa yüklemeler
kapalı kalır. Eski PostgreSQL medya kayıtları okunmaya devam eder.

## Dosya boyutu ve yerel önbellek

`MAX_UPLOAD_SIZE_MB`, şifrelemeden önce kabul edilen en büyük dosya boyutunu
MiB cinsinden belirler. Varsayılan değer `10`'dur. Hem arayüz hem sunucu aynı
değeri API'den alır; sunucu şifreli yük boyutunu da sınar. JSON/base64 yükleri
nedeniyle çok yüksek değerler sunucuda daha fazla bellek kullanır.

Yükleme önce sunucunun yerel `.data/veil-chat-media` klasörüne geçici olarak
yazılır, oradan seçilen bucket'a aktarılır ve yerel kopya önbellek olarak tutulur.
Dosya yerel klasörde bulunmazsa sunucu özel bucket'tan indirir, önbelleği yeniler
ve şifreli içeriği uygulama üzerinden istemciye döndürür. Yerel klasör kalıcı
depolama sayılmaz; dağıtımlarda asıl kopya bucket'tır. Klasör
`MEDIA_LOCAL_STORAGE_DIR` ile değiştirilebilir.

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

Replit'te `MAX_UPLOAD_SIZE_MB` ve `MEDIA_STORAGE_PROVIDER` değerlerini ortam
değişkeni olarak; erişim anahtarlarını Secrets olarak ekleyin. R2 için
`R2_SECRET_ACCESS_KEY`, B2 için `B2_APPLICATION_KEY` gizli tutulmalıdır.
