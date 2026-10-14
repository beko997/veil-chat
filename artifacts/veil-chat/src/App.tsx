import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ArrowDown, ArrowLeft, ArrowRight, Check, Copy, Download, File, ImagePlus, KeyRound,
  LockKeyhole, MessageSquareText, Paperclip, Pencil, RefreshCw, Send, ShieldCheck,
  Trash2, TriangleAlert, UserRound, X,
} from "lucide-react";
import {
  getGetRoomMediaQueryKey, getGetUploadConfigQueryKey, getListRoomMessagesQueryKey, useCreateRoom,
  useGetRoomMedia, useGetUploadConfig, useListRoomMessages, useSendRoomMessage,
} from "@workspace/api-client-react";
import type { ChatMessage } from "@workspace/api-client-react";
import { Router as WouterRouter } from "wouter";
import { base64ToBuffer, bufferToBase64, decryptMedia, decryptText, encryptMedia, encryptText, formatSize, generateRoomKey, getAnonymousId, importRoomKey, kindForMime, type RoomCryptoKey } from "./lib/crypto";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
const SENDER_ID = getAnonymousId();
const PROFILE_PREFIX = "__VEIL_PROFILE_V1__:";
const PROFILE_STORAGE_KEY = "veil-local-profile-v1";
const MAX_GIF_BYTES = 200 * 1024;

type RoomRoute = { roomId: string; roomKey: string } | { invalid: true; reason: string } | null;
type DecodedMessage = ChatMessage & { plainText: string | null };
type MediaMetadata = { filename: string; mime: string; size: number };
type LocalProfile = { displayName: string; avatarDataUrl: string; updatedAt: string };

function makeDefaultProfile(): LocalProfile {
  return { displayName: "Anonim", avatarDataUrl: "", updatedAt: new Date().toISOString() };
}

function readLocalProfile(): LocalProfile {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<LocalProfile>;
      if (typeof value.displayName === "string" && typeof value.avatarDataUrl === "string" && typeof value.updatedAt === "string") {
        return { displayName: value.displayName.slice(0, 32) || "Anonim", avatarDataUrl: value.avatarDataUrl, updatedAt: value.updatedAt };
      }
    }
  } catch { /* A damaged profile is treated as a fresh local profile. */ }
  return makeDefaultProfile();
}

function parseProfileMessage(body: string | null): LocalProfile | null {
  if (!body?.startsWith(PROFILE_PREFIX)) return null;
  try {
    const value = JSON.parse(body.slice(PROFILE_PREFIX.length)) as Partial<LocalProfile>;
    if (typeof value.displayName !== "string" || typeof value.avatarDataUrl !== "string" || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return null;
    if (value.avatarDataUrl && (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value.avatarDataUrl) || value.avatarDataUrl.length > 280 * 1024)) return null;
    return { displayName: value.displayName.slice(0, 32) || "Anonim", avatarDataUrl: value.avatarDataUrl, updatedAt: value.updatedAt };
  } catch { return null; }
}

function readRoomRoute(): RoomRoute {
  const hash = window.location.hash;
  if (!hash) return null;
  if (!hash.startsWith("#/room/")) return { invalid: true, reason: "Bağlantı biçimi tanınmadı." };
  const pair = hash.slice("#/room/".length).split("&k=");
  const roomId = pair[0]?.trim();
  let roomKey = "";
  try { roomKey = decodeURIComponent(pair.slice(1).join("&k=")); } catch { roomKey = ""; }
  if (!roomId) return { invalid: true, reason: "Oda numarası bağlantıda bulunamadı." };
  if (!roomKey) return { invalid: true, reason: "Bu davet bağlantısında oda anahtarı yok. Anahtar olmadan mesajları çözmek mümkün değil." };
  return { roomId, roomKey };
}

function goHome() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function App() {
  const [route, setRoute] = useState<RoomRoute>(() => readRoomRoute());
  const [localProfile, setLocalProfile] = useState<LocalProfile>(() => readLocalProfile());
  useEffect(() => {
    const syncRoute = () => setRoute(readRoomRoute());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  function saveLocalProfile(profile: LocalProfile) {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
      setLocalProfile(profile);
    } catch {
      throw new Error("Profil yerel depolamaya kaydedilemedi. Tarayıcı alanını kontrol edip yeniden deneyin.");
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter>
        <main className="grain min-h-[100dvh] bg-background text-foreground">
          {route === null ? <HomeView profile={localProfile} onSaveProfile={saveLocalProfile} /> : "invalid" in route
            ? <InvalidInvite reason={route.reason} />
            : <RoomView key={`${route.roomId}:${route.roomKey}`} roomId={route.roomId} roomKey={route.roomKey} profile={localProfile} onSaveProfile={saveLocalProfile} />}
        </main>
      </WouterRouter>
    </QueryClientProvider>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="inline-flex items-center gap-3" aria-label="Veil Chat">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-900/70 bg-emerald-950/70 text-emerald-400">
        <ShieldCheck size={18} strokeWidth={1.7} />
      </span>
      {!compact && <span className="text-[15px] font-extrabold tracking-[-.045em]">veil<span className="text-emerald-400">chat</span></span>}
    </div>
  );
}

function HomeView({ profile, onSaveProfile }: { profile: LocalProfile; onSaveProfile: (profile: LocalProfile) => void }) {
  const [label, setLabel] = useState("");
  const [invite, setInvite] = useState("");
  const [joinError, setJoinError] = useState("");
  const [createError, setCreateError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const createRoom = useCreateRoom();

  async function create() {
    setCreateError("");
    try {
      const room = await createRoom.mutateAsync({ data: { label: label.trim() || null } });
      const key = await generateRoomKey();
      window.location.hash = `/room/${room.id}&k=${encodeURIComponent(key)}`;
    } catch {
      setCreateError("Oda oluşturulamadı. Bağlantınızı kontrol edip yeniden deneyin.");
    }
  }

  function join() {
    setJoinError("");
    const value = invite.trim();
    if (!value) {
      setJoinError("Katılmak için davet bağlantısını yapıştırın.");
      return;
    }
    try {
      const fragment = value.startsWith("#") ? value : new URL(value).hash;
      if (!fragment.startsWith("#/room/")) throw new Error();
      const parsed = readFragment(fragment);
      if (!parsed.roomId || !parsed.roomKey) throw new Error();
      window.location.hash = fragment.slice(1);
    } catch {
      setJoinError("Geçerli bir Veil Chat oda bağlantısı yapıştırın.");
    }
  }

  return (
    <div className="relative isolate min-h-[100dvh] overflow-hidden">
      <div className="veil-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="pointer-events-none absolute -top-52 left-1/2 -z-10 h-[560px] w-[720px] -translate-x-1/2 rounded-full bg-emerald-700/[.075] blur-[110px]" />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <Brand />
        <div className="mono hidden items-center gap-2 text-[10px] uppercase tracking-[.16em] text-emerald-400/80 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          hesapsız · uçtan uca
        </div>
        <button data-testid="button-edit-profile-home" type="button" onClick={() => setProfileOpen(true)} className="btn-quiet !px-3 !py-2">
          <ProfileAvatar profile={profile} size="small" testId="img-local-profile-avatar" />
          <span className="max-w-28 truncate">{profile.displayName}</span><Pencil size={12} />
        </button>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-16 pt-9 sm:px-8 sm:pt-16">
        <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_.95fr] lg:gap-16">
          <div className="enter pt-1 lg:pt-10">
            <p className="mono mb-6 flex items-center gap-3 text-[10px] uppercase tracking-[.2em] text-emerald-400/80">
              <span className="h-px w-8 bg-emerald-700" /> özel konuşmalar, içerik şifreli
            </p>
            <h1 className="max-w-[650px] text-[clamp(3.25rem,6.4vw,6rem)] font-extrabold leading-[.94] tracking-[-.075em] text-[#e3efe8]">
              Söyleyeceklerin<br /><span className="text-emerald-400">sana ait.</span>
            </h1>
            <p className="mt-7 max-w-lg text-[15px] leading-7 text-[#91a79a]">
              Hesap yok, kayıt yok. Mesajların ve dosyaların tarayıcında şifrelenir; oda anahtarı yalnızca davet bağlantısında kalır. Oda, zaman, dosya türü ve boyutu gibi teknik bilgiler gizlenmez.
            </p>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-[11px] text-[#6f897a]">
              <span className="inline-flex items-center gap-2"><LockKeyhole size={14} className="text-emerald-500" /> ECDH P-256 + AES-GCM</span>
              <span className="inline-flex items-center gap-2"><KeyRound size={14} className="text-emerald-500" /> Anahtar sunucuya gitmez</span>
            </div>
            <div className="mt-7">
              <a
                data-testid="link-download-source-code"
                href="/downloads/veil-chat-source.zip"
                download="veil-chat-source.zip"
                className="btn-quiet w-fit"
              >
                <Download size={14} />
                Kaynak kodunu indir
              </a>
              <p className="mono mt-2 pl-1 text-[9px] text-[#6f897a]">
                Taşınabilir ZIP · Docker Compose ile tek komut dağıtım
              </p>
            </div>
            <div className="mt-14 hidden max-w-md border-l border-emerald-900/70 pl-5 lg:block">
              <p className="mono text-[10px] leading-6 text-[#71877a]">
                <span className="text-emerald-500">01</span> Anahtar tarayıcıda üretilir<br />
                <span className="text-emerald-500">02</span> Her mesaj gönderilmeden önce şifrelenir<br />
                <span className="text-emerald-500">03</span> İçerik şifreli; teknik üst veriler görülebilir
              </p>
            </div>
          </div>

          <div className="enter enter-delay-1 space-y-4">
            <section className="rounded-2xl border border-emerald-950 bg-[#0b1711]/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,.24)] sm:p-7">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="mono text-[10px] uppercase tracking-[.16em] text-emerald-500">Yeni başlangıç</p>
                  <h2 className="mt-2 text-xl font-bold tracking-[-.04em]">Güvenli bir oda aç</h2>
                </div>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/60 bg-emerald-950/50 text-emerald-400"><MessageSquareText size={18} /></span>
              </div>
              <label htmlFor="room-label" className="mb-2 block text-xs font-semibold text-[#a9b9ae]">Oda adı <span className="font-normal text-[#63796b]">— isteğe bağlı</span></label>
              <input id="room-label" data-testid="input-room-label" className="veil-input" maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} placeholder="Örn. hafta sonu planı" />
              {createError && <p role="alert" className="mt-3 text-xs text-rose-300">{createError}</p>}
              <button data-testid="button-create-room" className="btn-primary mt-4" onClick={() => void create()} disabled={createRoom.isPending}>
                {createRoom.isPending ? <><span className="h-4 w-4 animate-pulse rounded-full bg-current/30" /> Oda hazırlanıyor</> : <>Şifreli oda oluştur <ArrowRight size={15} /></>}
              </button>
              <p className="mono mt-4 text-[10px] leading-5 text-[#698072]">
                Bağlantıdaki <span className="text-emerald-400">#k=</span> anahtarı sadece bu tarayıcıda ve davet ettiğiniz kişilerde bulunur.
              </p>
            </section>

            <section className="rounded-2xl border border-[#1a3024] bg-[#0a1510]/80 p-5 sm:p-7">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#233d2e] text-[#9cb4a3]"><ArrowRight size={16} /></span>
                <div><p className="mono text-[10px] uppercase tracking-[.15em] text-[#799080]">Davetin var mı?</p><h2 className="mt-1 text-base font-bold tracking-[-.03em]">Mevcut odaya katıl</h2></div>
              </div>
              <label htmlFor="invite-link" className="mb-2 block text-xs font-semibold text-[#a9b9ae]">Oda bağlantısı</label>
              <input id="invite-link" data-testid="input-invite-link" className="veil-input" value={invite} onChange={(event) => { setInvite(event.target.value); setJoinError(""); }} onKeyDown={(event) => { if (event.key === "Enter") join(); }} placeholder="https://…/#/room/…&k=…" />
              {joinError && <p role="alert" className="mt-2 text-xs text-rose-300">{joinError}</p>}
              <button data-testid="button-join-room" className="btn-quiet mt-3 w-full" onClick={join}>Bağlantıyla katıl <ArrowRight size={14} /></button>
            </section>
          </div>
        </div>

        <div className="enter enter-delay-2 mt-16 grid gap-0 border-y border-[#1b3024] sm:grid-cols-3">
          <Feature index="A" title="Anahtar sende" description="Oda anahtarı URL parçasında kalır. İsteklere, sunucuya veya mesaj verisine eklenmez." icon={<KeyRound size={17} />} />
          <Feature index="B" title="İçerik kapalı" description="ECDH anahtar değişimi ve AES-GCM ile içerikler tarayıcıda şifrelenir; teknik üst veriler açık kalır." icon={<LockKeyhole size={17} />} />
          <Feature index="C" title="Kimlik gerektirmez" description="Hesap açmadan katıl. Takma ad ya da profil bilgisi vermek zorunda değilsin." icon={<ShieldCheck size={17} />} />
        </div>
        <footer className="flex flex-col gap-2 py-6 text-[10px] text-[#5e7567] sm:flex-row sm:items-center sm:justify-between">
          <span className="mono uppercase tracking-[.12em]">VEIL CHAT / ÖZEL İLETİŞİM</span>
          <span>Paylaştığınız bağlantıya oda anahtarı dahildir. Güvendiğiniz kişilerle paylaşın.</span>
        </footer>
      </section>
      {profileOpen && <ProfileEditor profile={profile} onClose={() => setProfileOpen(false)} onSave={onSaveProfile} />}
    </div>
  );
}

function ProfileAvatar({ profile, size = "normal", testId = "img-profile-avatar" }: { profile: LocalProfile; size?: "small" | "normal" | "large"; testId?: string }) {
  const dimensions = size === "small" ? "h-8 w-8" : size === "large" ? "h-24 w-24" : "h-9 w-9";
  return (
    <span data-testid={testId} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-emerald-700/50 bg-[#183326] text-sm font-bold text-emerald-300 ${dimensions}`}>
      {profile.avatarDataUrl
        ? <img src={profile.avatarDataUrl} alt={`${profile.displayName} profili`} className="h-full w-full object-cover" />
        : <span aria-hidden="true">{profile.displayName.trim().slice(0, 1).toLocaleUpperCase("tr-TR") || <UserRound size={15} />}</span>}
    </span>
  );
}

async function prepareAvatar(file: File): Promise<string> {
  const isGif = file.type === "image/gif" || /\.gif$/i.test(file.name);
  if (isGif) {
    if (file.size > MAX_GIF_BYTES) throw new Error("GIF dosyası 200 KiB sınırını aşıyor.");
    return `data:image/gif;base64,${bufferToBase64(await file.arrayBuffer())}`;
  }
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("Desteklenmeyen görsel türü. JPEG, PNG, WebP veya GIF seçin.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Görsel çok büyük. 12 MiB altında bir dosya seçin.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Görsel işlenemedi. Başka bir dosya deneyin.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.78, 0.64, 0.5, 0.38]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= 88 * 1024) return dataUrl;
    }
    throw new Error("Görsel yeterince küçültülemedi. Daha küçük bir dosya seçin.");
  } finally {
    bitmap.close();
  }
}

function ProfileEditor({ profile, onClose, onSave }: {
  profile: LocalProfile;
  onClose: () => void;
  onSave: (profile: LocalProfile) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<LocalProfile>(profile);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  async function chooseAvatar(file?: File) {
    if (!file) return;
    setError("");
    try {
      const avatarDataUrl = await prepareAvatar(file);
      setDraft((current) => ({ ...current, avatarDataUrl }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Profil görseli işlenemedi.");
    }
  }

  async function save() {
    const next = { ...draft, displayName: draft.displayName.trim().slice(0, 32) || "Anonim", updatedAt: new Date().toISOString() };
    setError("");
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Profil kaydedilemedi. Yeniden deneyin.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#020805]/80 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section data-testid="dialog-profile-editor" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title" aria-describedby="profile-editor-description" className="enter w-full max-w-md rounded-t-2xl border border-[#294331] bg-[#0b1711] p-5 shadow-[0_24px_90px_rgba(0,0,0,.5)] sm:rounded-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div><p className="mono text-[10px] uppercase tracking-[.16em] text-emerald-500">Profil lokal</p><h2 id="profile-editor-title" className="mt-1 text-xl font-bold tracking-[-.04em]">Sana özel isim</h2></div>
          <button data-testid="button-close-profile-editor" type="button" aria-label="Profil düzenleyicisini kapat" className="btn-quiet !h-9 !w-9 !p-0" onClick={onClose}><X size={15} /></button>
        </div>
        <p id="profile-editor-description" className="mt-2 text-xs leading-5 text-[#819788]">Bu profil yalnızca davet bağlantısını bilen kişilerce, oda anahtarıyla çözülebilir.</p>
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-[#20372a] bg-[#0d1a12] p-4">
          <ProfileAvatar profile={draft} size="large" testId="img-profile-preview" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{draft.displayName || "Anonim"}</p>
            <p className="mt-1 text-[10px] text-[#7c9384]">JPEG · PNG · WebP · animasyonlu GIF</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button data-testid="button-select-profile-avatar" type="button" className="btn-quiet !px-3 !py-2" onClick={() => fileRef.current?.click()}><ImagePlus size={13} /> Görsel seç</button>
              {draft.avatarDataUrl && <button data-testid="button-remove-profile-avatar" type="button" className="btn-quiet !px-3 !py-2 text-rose-200" onClick={() => { setDraft((current) => ({ ...current, avatarDataUrl: "" })); setError(""); }}><Trash2 size={13} /> Kaldır</button>}
            </div>
          </div>
        </div>
        <input data-testid="input-profile-avatar" ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,.gif" className="sr-only" onChange={(event) => { void chooseAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        <label htmlFor="profile-display-name" className="mb-2 mt-5 block text-xs font-semibold text-[#a9b9ae]">Takma ad</label>
        <input id="profile-display-name" data-testid="input-profile-display-name" className="veil-input" value={draft.displayName} maxLength={32} autoComplete="nickname" autoFocus onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} placeholder="Örn. Kuzey" />
        <div className="mono mt-2 text-right text-[9px] text-[#6f897a]">{draft.displayName.length}/32</div>
        {error && <p data-testid="text-profile-error" role="alert" className="mt-3 rounded-lg border border-rose-900/50 bg-rose-950/20 px-3 py-2 text-xs leading-5 text-rose-200">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button data-testid="button-cancel-profile" type="button" className="btn-quiet flex-1" disabled={saving} onClick={onClose}>İptal</button>
          <button data-testid="button-save-profile" type="button" className="btn-primary flex-1" disabled={saving} onClick={() => void save()}>{saving ? "Kaydediliyor…" : <>Profili kaydet <Check size={14} /></>}</button>
        </div>
      </section>
    </div>
  );
}

function Feature({ index, title, description, icon }: { index: string; title: string; description: string; icon: ReactNode }) {
  return (
    <article className="flex gap-4 border-b border-[#1b3024] py-5 sm:border-b-0 sm:border-r sm:px-5 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-950/50 text-emerald-400">{icon}</span>
      <div><p className="mono text-[9px] tracking-[.15em] text-emerald-600">{index} / GİZLİLİK</p><h3 className="mt-1 text-sm font-bold">{title}</h3><p className="mt-1.5 max-w-xs text-[11px] leading-5 text-[#7f9687]">{description}</p></div>
    </article>
  );
}

function readFragment(fragment: string): { roomId: string; roomKey: string } {
  const parts = fragment.slice("#/room/".length).split("&k=");
  let roomKey = "";
  try { roomKey = decodeURIComponent(parts.slice(1).join("&k=")); } catch { roomKey = ""; }
  return { roomId: parts[0] || "", roomKey };
}

function InvalidInvite({ reason }: { reason: string }) {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5">
      <div className="veil-grid pointer-events-none absolute inset-0" />
      <section className="enter relative max-w-md rounded-2xl border border-[#254130] bg-[#0b1711] p-7 text-center sm:p-9">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-900/50 bg-amber-950/30 text-amber-300"><TriangleAlert size={21} /></span>
        <Brand />
        <h1 className="mt-6 text-2xl font-extrabold tracking-[-.05em]">Bu davet kullanılamıyor</h1>
        <p className="mt-3 text-sm leading-6 text-[#91a79a]">{reason}</p>
        <p className="mono mt-5 rounded-lg border border-[#20362a] bg-[#07100c] p-3 text-[10px] leading-5 text-[#779080]">Oda anahtarı, davet bağlantısının # bölümünde taşınır ve sunucuya gönderilmez.</p>
        <button data-testid="button-invalid-home" className="btn-primary mt-6" onClick={goHome}><ArrowLeft size={15} /> Ana sayfaya dön</button>
      </section>
    </div>
  );
}

function RoomView({ roomId, roomKey, profile, onSaveProfile }: {
  roomId: string;
  roomKey: string;
  profile: LocalProfile;
  onSaveProfile: (profile: LocalProfile) => void;
}) {
  const [key, setKey] = useState<RoomCryptoKey | null>(null);
  const [invalidKey, setInvalidKey] = useState(false);
  const [decodedMessages, setDecodedMessages] = useState<DecodedMessage[]>([]);
  const [historyDecoded, setHistoryDecoded] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [copyState, setCopyState] = useState(false);
  const [sendError, setSendError] = useState("");
  const [fileError, setFileError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ kind: "image" | "video"; src: string } | null>(null);
  const uploadConfigQuery = useGetUploadConfig({
    query: { queryKey: getGetUploadConfigQueryKey(), retry: 1 },
  });
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastProfileAttempt = useRef("");
  const sendMessage = useSendRoomMessage();
  const mutateMessageRef = useRef(sendMessage.mutateAsync);
  mutateMessageRef.current = sendMessage.mutateAsync;
  const params = useMemo(() => ({ roomId, limit: 100 }), [roomId]);
  const messagesQuery = useListRoomMessages(params, {
    query: { enabled: !!key, queryKey: getListRoomMessagesQueryKey(params), refetchInterval: 2500 },
  });
  const refetchMessagesRef = useRef(messagesQuery.refetch);
  refetchMessagesRef.current = messagesQuery.refetch;

  useEffect(() => {
    let cancelled = false;
    setKey(null);
    setInvalidKey(false);
    importRoomKey(roomKey).then((imported) => { if (!cancelled) setKey(imported); }).catch(() => { if (!cancelled) setInvalidKey(true); });
    return () => { cancelled = true; };
  }, [roomKey]);

  useEffect(() => {
    let cancelled = false;
    if (!key || !messagesQuery.data) {
      setDecodedMessages([]);
      setHistoryDecoded(false);
      return () => { cancelled = true; };
    }
    setHistoryDecoded(false);
    Promise.all(messagesQuery.data.map(async (message) => ({
      ...message,
      plainText: await decryptText(key, message.ciphertext, message.iv),
    }))).then((decoded) => {
      if (!cancelled) {
        setDecodedMessages(decoded.sort((a, b) => a.id - b.id));
        setHistoryDecoded(true);
      }
    });
    return () => { cancelled = true; };
  }, [key, messagesQuery.data]);

  async function publishProfile(next: LocalProfile) {
    const attemptId = `${roomId}:${next.updatedAt}`;
    lastProfileAttempt.current = attemptId;
    setProfileError("");
    try {
      const encrypted = await encryptText(key!, `${PROFILE_PREFIX}${JSON.stringify(next)}`);
      await mutateMessageRef.current({ roomId, data: { ...encrypted, sender: SENDER_ID, kind: "text" } });
      await refetchMessagesRef.current();
    } catch {
      setProfileError("Profil saklandı ancak odaya gönderilemedi. Yeniden kaydedip tekrar deneyin.");
      throw new Error("Profil saklandı ancak şifreli oda güncellemesi gönderilemedi. Yeniden deneyin.");
    }
  }

  async function saveRoomProfile(next: LocalProfile) {
    onSaveProfile(next);
    await publishProfile(next);
  }

  useEffect(() => {
    if (!key || !historyDecoded || !messagesQuery.data) return;
    const attemptId = `${roomId}:${profile.updatedAt}`;
    if (lastProfileAttempt.current === attemptId) return;
    const alreadyPublished = decodedMessages.some((message) =>
      message.sender === SENDER_ID && parseProfileMessage(message.plainText)?.updatedAt === profile.updatedAt,
    );
    if (alreadyPublished) {
      lastProfileAttempt.current = attemptId;
      return;
    }
    lastProfileAttempt.current = attemptId;
    void publishProfile(profile).catch(() => undefined);
  }, [decodedMessages, historyDecoded, key, messagesQuery.data, profile, roomId]);

  const profilesBySender = useMemo(() => {
    const profiles = new Map<string, LocalProfile>();
    for (const message of decodedMessages) {
      const incoming = parseProfileMessage(message.plainText);
      if (incoming && message.sender) profiles.set(message.sender, incoming);
    }
    profiles.set(SENDER_ID, profile);
    return profiles;
  }, [decodedMessages, profile]);
  const visibleMessages = useMemo(
    () => decodedMessages.filter((message) => !(message.kind === "text" && message.plainText?.startsWith(PROFILE_PREFIX))),
    [decodedMessages],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) { textarea.style.height = "auto"; textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`; }
  }, [messageText]);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [decodedMessages]);

  async function submitText() {
    const text = messageText.trim();
    if (!text || !key || sendMessage.isPending) return;
    setMessageText("");
    setSendError("");
    try {
      const encrypted = await encryptText(key, text);
      await sendMessage.mutateAsync({ roomId, data: { ...encrypted, sender: SENDER_ID, kind: "text" } });
      await messagesQuery.refetch();
    } catch {
      setMessageText(text);
      setSendError("Mesaj gönderilemedi. Metin bu pencerede korunuyor; yeniden deneyin.");
    }
  }

  async function submitFile(file: File) {
    setFileError("");
    const maxUploadSizeMb = uploadConfigQuery.data?.maxUploadSizeMb;
    if (maxUploadSizeMb === undefined) {
      setFileError(uploadConfigQuery.isError
        ? "Dosya yükleme sınırı alınamadı. Yeniden deneyin."
        : "Dosya yükleme sınırı yükleniyor. Birazdan yeniden deneyin.");
      return;
    }
    if (file.size > maxUploadSizeMb * 1024 * 1024) {
      setFileError(`Dosya ${maxUploadSizeMb} MiB sınırını aşıyor. Daha küçük bir dosya seçin.`);
      return;
    }
    if (!key) return;
    try {
      const encryptedBytes = await encryptMedia(key, await file.arrayBuffer());
      const metadata: MediaMetadata = { filename: file.name, mime: file.type || "application/octet-stream", size: file.size };
      const encryptedMeta = await encryptText(key, JSON.stringify(metadata));
      const mediaData = bufferToBase64(encryptedBytes);
      await sendMessage.mutateAsync({
        roomId,
        data: { ...encryptedMeta, sender: SENDER_ID, kind: kindForMime(file.type), mediaData },
      });
      await messagesQuery.refetch();
    } catch {
      setFileError("Dosya şifrelenemedi veya gönderilemedi. Yeniden deneyin.");
    }
  }

  async function copyInvite() {
    const link = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopyState(true);
      window.setTimeout(() => setCopyState(false), 1800);
    } catch {
      setCopyState(false);
      setSendError("Bağlantı kopyalanamadı. Adres çubuğundan elle kopyalayabilirsiniz.");
    }
  }

  if (invalidKey) return <InvalidInvite reason="Oda anahtarı geçersiz. Davet bağlantısının tamamını, #/room/...&k=... bölümüyle birlikte isteyin." />;
  if (!key) {
    return <div className="flex min-h-[100dvh] items-center justify-center"><div className="w-full max-w-sm px-6"><div className="h-2 w-20 animate-pulse rounded bg-emerald-900/70" /><div className="mt-5 h-7 w-48 animate-pulse rounded bg-[#183023]" /><div className="mt-3 h-4 w-full animate-pulse rounded bg-[#13251a]" /><p className="mono mt-5 text-[10px] text-[#718779]">ODA ANAHTARI YERELDE AÇILIYOR</p></div></div>;
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="border-b border-[#20372a] bg-[#09130e]/90">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3.5 sm:px-7">
          <button data-testid="button-room-home" onClick={goHome} aria-label="Ana sayfaya dön" className="btn-quiet !h-10 !w-10 !p-0"><ArrowLeft size={16} /></button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /><h1 className="truncate text-sm font-bold">Şifreli oda</h1></div>
            <p data-testid="text-room-id" className="mono mt-1 truncate text-[10px] text-[#718779]">{roomId}</p>
          </div>
          <span className="hidden items-center gap-1.5 text-[10px] text-[#789080] sm:inline-flex"><LockKeyhole size={13} className="text-emerald-500" /> Uçtan uca şifreli</span>
          <button data-testid="button-edit-profile-room" type="button" onClick={() => setProfileOpen(true)} className="btn-quiet !px-2.5 !py-2" aria-label={`Profili düzenle: ${profile.displayName}`}>
            <ProfileAvatar profile={profile} size="small" testId="img-room-profile-avatar" /><span className="hidden max-w-24 truncate sm:inline">{profile.displayName}</span><Pencil size={12} />
          </button>
          <button data-testid="button-copy-invite" onClick={() => void copyInvite()} className="btn-quiet !px-3 !py-2.5">
            {copyState ? <Check size={14} /> : <Copy size={14} />}<span className="hidden sm:inline">{copyState ? "Kopyalandı" : "Davet bağlantısı"}</span><span className="sm:hidden">{copyState ? "Kopyalandı" : "Davet"}</span>
          </button>
        </div>
      </header>

      <div className="border-b border-[#1b3024] bg-[#0c1811] px-4 py-2 text-center text-[10px] text-[#779080]">
        Anahtar yalnızca bağlantında kalır <span className="mx-2 text-[#3c5847]">/</span>
        {uploadConfigQuery.data
          ? ` Medya başına en fazla ${uploadConfigQuery.data.maxUploadSizeMb} MiB`
          : uploadConfigQuery.isError
            ? " Yükleme sınırı alınamadı"
            : " Yükleme sınırı yükleniyor…"}
        {uploadConfigQuery.isError && <button type="button" className="ml-2 text-emerald-400 underline underline-offset-2" onClick={() => void uploadConfigQuery.refetch()}>Yeniden dene</button>}
      </div>

      <section ref={listRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-7 sm:py-8" aria-live="polite">
          {messagesQuery.isLoading ? (
            <div className="space-y-3 pt-2" aria-label="Mesajlar yükleniyor">
              {[72, 46, 62].map((width, index) => <div key={index} className={`h-[58px] animate-pulse rounded-2xl bg-[#12231a] ${index === 1 ? "ml-auto" : ""}`} style={{ width: `${width}%` }} />)}
            </div>
          ) : messagesQuery.isError ? (
            <div className="m-auto max-w-sm rounded-2xl border border-[#274132] bg-[#0d1a12] p-6 text-center">
              <TriangleAlert size={20} className="mx-auto text-amber-300" /><h2 className="mt-3 text-sm font-bold">Mesajlar yüklenemedi</h2>
              <p className="mt-2 text-xs leading-5 text-[#819788]">Sunucuya ulaşılamıyor. Bağlantıyı kontrol edip yeniden deneyin.</p>
              <button data-testid="button-retry-messages" className="btn-quiet mt-4" onClick={() => void messagesQuery.refetch()}><RefreshCw size={13} /> Yeniden dene</button>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="m-auto max-w-sm py-16 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#254130] bg-[#0c1a11] text-emerald-400"><MessageSquareText size={22} /></span>
              <p className="mono mt-5 text-[10px] uppercase tracking-[.16em] text-emerald-500/80">Bağlantı güvenli</p>
              <h2 className="mt-2 text-lg font-bold tracking-[-.04em]">İlk mesajı sen gönder</h2>
              <p className="mt-2 text-xs leading-5 text-[#789080]">İçerikler tarayıcında çözülür. Oda kimliği, zaman ve dosya boyutu gibi teknik üst veriler şifrelenmez.</p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#20362a] px-3 py-1.5 text-[10px] text-[#779080]"><ArrowDown size={12} /> Aşağıya yazmaya başla</div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleMessages.map((message) => <MessageBubble key={message.id} message={message} roomId={roomId} keyMaterial={key} profiles={profilesBySender} onOpenMedia={setLightbox} />)}
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-[#20372a] bg-[#09130e]">
        <div className="mx-auto max-w-3xl px-4 py-3 sm:px-7 sm:py-4">
          {sendError && <p role="alert" className="mb-2 text-xs text-rose-300">{sendError}</p>}
          {fileError && <p role="alert" className="mb-2 text-xs text-rose-300">{fileError}</p>}
          {profileError && <p data-testid="text-profile-send-error" role="alert" className="mb-2 text-xs text-rose-300">{profileError}</p>}
          <div className="flex items-end gap-2 rounded-2xl border border-[#294331] bg-[#0d1912] p-2 transition-colors focus-within:border-emerald-700/80">
          <button data-testid="button-attach-file" aria-label="Fotoğraf, video veya dosya ekle" title={uploadConfigQuery.data ? `Dosya ekle · en fazla ${uploadConfigQuery.data.maxUploadSizeMb} MiB` : "Dosya yükleme sınırı yükleniyor"} onClick={() => fileRef.current?.click()} disabled={sendMessage.isPending || !uploadConfigQuery.data} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#8ca394] transition-colors hover:bg-emerald-950/60 hover:text-emerald-400 disabled:opacity-50"><Paperclip size={17} /></button>
            <textarea data-testid="input-message" ref={textareaRef} rows={1} value={messageText} onChange={(event) => setMessageText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitText(); } }} placeholder="Şifreli mesajını yaz…" className="max-h-[132px] min-h-10 flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-sm leading-5 text-[#dcebe1] outline-none placeholder:text-[#62796a]" />
            <button data-testid="button-send-message" aria-label="Mesajı gönder" onClick={() => void submitText()} disabled={!messageText.trim() || sendMessage.isPending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-[#07130c] transition-colors hover:bg-emerald-400 disabled:opacity-35">{sendMessage.isPending ? <span className="h-4 w-4 animate-pulse rounded-full border-2 border-current/50" /> : <Send size={16} />}</button>
          </div>
          <div className="mono mt-2 flex justify-between text-[9px] text-[#617969]"><span>ENTER GÖNDERİR · SHIFT + ENTER YENİ SATIR</span><span>UÇTAN UCA ŞİFRELİ</span></div>
          <input data-testid="input-file" ref={fileRef} type="file" accept="image/*,video/*,*/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void submitFile(file); event.currentTarget.value = ""; }} />
        </div>
      </footer>

      {lightbox && <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#030806]/95 p-4" role="dialog" aria-modal="true" aria-label="Medya görüntüleyici" onClick={() => setLightbox(null)}>
        <button data-testid="button-close-lightbox" aria-label="Kapat" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white" onClick={() => setLightbox(null)}><X size={18} /></button>
        {lightbox.kind === "image" ? <img src={lightbox.src} alt="Şifresi çözülmüş görsel" className="max-h-[90vh] max-w-[94vw] rounded-lg object-contain" onClick={(event) => event.stopPropagation()} /> : <video src={lightbox.src} controls autoPlay className="max-h-[90vh] max-w-[94vw] rounded-lg" onClick={(event) => event.stopPropagation()} />}
      </div>}
      {profileOpen && <ProfileEditor profile={profile} onClose={() => setProfileOpen(false)} onSave={saveRoomProfile} />}
    </div>
  );
}

function MessageBubble({ message, roomId, keyMaterial, profiles, onOpenMedia }: {
  message: DecodedMessage;
  roomId: string;
  keyMaterial: RoomCryptoKey;
  profiles: Map<string, LocalProfile>;
  onOpenMedia: (value: { kind: "image" | "video"; src: string }) => void;
}) {
  const mine = message.sender === SENDER_ID;
  const ownClass = mine ? "rounded-br-md border-emerald-800/40 bg-[#174b34] text-[#e2f4e8]" : "rounded-bl-md border-[#263d2e] bg-[#101d15] text-[#d9e8de]";
  const participant = (message.sender && profiles.get(message.sender)) || { displayName: "Anonim", avatarDataUrl: "", updatedAt: "" };
  const metadata = useMemo(() => {
    if (!message.plainText || message.kind === "text") return null;
    try { return JSON.parse(message.plainText) as MediaMetadata; } catch { return { filename: "Dosya", mime: "", size: 0 }; }
  }, [message.kind, message.plainText]);
  const time = new Date(message.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  if (message.plainText === null) {
    return <div className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine && <ProfileAvatar profile={participant} size="small" testId={`img-message-avatar-${message.id}`} />}
      <article data-testid={`message-${message.id}`} className={`max-w-[85%] border px-3.5 py-2.5 text-xs italic text-[#91a297] sm:max-w-[75%] ${ownClass}`}>
        Bu mesajın şifresi çözülemedi
        <div className="mono mt-1.5 flex justify-end gap-2 text-[9px] not-italic opacity-60"><span data-testid={`text-message-sender-${message.id}`}>{participant.displayName}</span><time>{time}</time></div>
      </article>
      {mine && <ProfileAvatar profile={participant} size="small" testId={`img-message-avatar-${message.id}`} />}
    </div>;
  }
  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine && <ProfileAvatar profile={participant} size="small" testId={`img-message-avatar-${message.id}`} />}
      <article data-testid={`message-${message.id}`} className={`w-fit max-w-[88%] border px-3.5 py-2.5 shadow-[0_5px_18px_rgba(0,0,0,.09)] sm:max-w-[75%] ${ownClass}`}>
        {message.kind === "text" ? <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.65]">{message.plainText}</p>
          : <MediaAttachment message={message} roomId={roomId} keyMaterial={keyMaterial} metadata={metadata} onOpenMedia={onOpenMedia} />}
        <div className="mono mt-1.5 flex items-center justify-end gap-2 text-[9px] opacity-60"><span data-testid={`text-message-sender-${message.id}`} className="flex min-w-0 items-center gap-1.5"><span className="max-w-32 truncate">{participant.displayName}</span>{mine && <span className="opacity-70">(sen)</span>}</span><time>{time}</time></div>
      </article>
      {mine && <ProfileAvatar profile={participant} size="small" testId={`img-message-avatar-${message.id}`} />}
    </div>
  );
}

function MediaAttachment({ message, roomId, keyMaterial, metadata, onOpenMedia }: {
  message: ChatMessage;
  roomId: string;
  keyMaterial: RoomCryptoKey;
  metadata: MediaMetadata | null;
  onOpenMedia: (value: { kind: "image" | "video"; src: string }) => void;
}) {
  const mediaId = message.mediaId || "";
  const mediaQuery = useGetRoomMedia(roomId, mediaId, {
    query: { enabled: !!mediaId, queryKey: getGetRoomMediaQueryKey(roomId, mediaId) },
  });
  const [objectUrl, setObjectUrl] = useState("");
  const [mediaState, setMediaState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    let url = "";
    if (!mediaQuery.data || !metadata) {
      setMediaState(mediaQuery.isError ? "error" : "loading");
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const clear = await decryptMedia(keyMaterial, base64ToBuffer(mediaQuery.data.data));
        const blob = new Blob([clear], { type: metadata.mime || "application/octet-stream" });
        url = URL.createObjectURL(blob);
        if (!cancelled) { setObjectUrl(url); setMediaState("ready"); } else URL.revokeObjectURL(url);
      } catch {
        if (!cancelled) setMediaState("error");
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [keyMaterial, mediaQuery.data, mediaQuery.isError, metadata]);

  if (mediaState === "loading") return <div className="flex min-w-40 items-center gap-2 py-2 text-xs opacity-70"><span className="h-3.5 w-3.5 animate-pulse rounded-full bg-current/30" /> Şifreli medya alınıyor…</div>;
  if (mediaState === "error" || !objectUrl || !metadata) return <div className="flex items-center gap-2 py-2 text-xs text-amber-200/80"><TriangleAlert size={14} /> Medya açılamadı</div>;
  if (message.kind === "image") return <button data-testid={`button-open-media-${message.id}`} className="block cursor-zoom-in border-0 bg-transparent p-0" onClick={() => onOpenMedia({ kind: "image", src: objectUrl })}><img src={objectUrl} alt={metadata.filename || "Şifreli görsel"} className="max-h-80 max-w-full rounded-lg object-contain" /></button>;
  if (message.kind === "video") return <button data-testid={`button-open-media-${message.id}`} className="block cursor-pointer border-0 bg-transparent p-0 text-left" onClick={() => onOpenMedia({ kind: "video", src: objectUrl })}><div className="relative"><video src={objectUrl} preload="metadata" className="max-h-80 max-w-full rounded-lg" /><span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/60 px-4 py-2 text-xs text-white">Videoyu oynat</span></span></div></button>;
  return <a data-testid={`link-download-media-${message.id}`} href={objectUrl} download={metadata.filename || "dosya"} className="flex min-w-48 items-center gap-3 py-1 text-inherit no-underline">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/15"><File size={17} /></span>
    <span className="min-w-0 flex-1"><b className="block max-w-56 truncate text-xs font-bold">{metadata.filename || "Dosya"}</b><small className="text-[10px] opacity-65">{formatSize(metadata.size)}</small></span>
    <ArrowDown size={15} />
  </a>;
}

export default App;
