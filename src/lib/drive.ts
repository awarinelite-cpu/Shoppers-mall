import { getSetting, setSettings, exportBackup, markDailyDownload } from './repo';
import { PosError, fmtDate } from './money';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';   // only files/folders this app creates
export const FOLDER_NAME = 'Provision POS Backups';
const DRIVE = 'https://www.googleapis.com/drive/v3';
let cache: { token: string; exp: number } | null = null;

/** Replaceable in tests. */
export const deps = {
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
  getToken: (interactive: boolean) => realGetToken(interactive)
};

export async function clientId(): Promise<string> {
  return ((await getSetting('drive_client_id')) ?? '').trim() || ((import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? '');
}
export async function driveReady(): Promise<boolean> {
  return (await getSetting('drive_enabled')) === '1' && !!(await getSetting('drive_email'))?.trim() && !!(await clientId());
}

function loadGis(): Promise<void> {
  const w = window as any;
  if (w.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    const t = setTimeout(() => reject(new PosError('Could not reach Google. Check your internet connection.')), 12000);
    s.onload = () => { clearTimeout(t); resolve(); };
    s.onerror = () => { clearTimeout(t); reject(new PosError('Could not reach Google. Check your internet connection.')); };
    document.head.appendChild(s);
  });
}

/** interactive=true may open Google's sign-in/consent popup (call from a tap). false tries silently. */
async function realGetToken(interactive: boolean): Promise<string> {
  if (cache && cache.exp > Date.now() + 60_000) return cache.token;
  const cid = await clientId();
  if (!cid) throw new PosError('Add your Google Client ID in Settings first.');
  await loadGis();
  const email = ((await getSetting('drive_email')) ?? '').trim();
  return new Promise<string>((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: cid, scope: SCOPE, hint: email || undefined,
      callback: (r: any) => {
        if (r.error) return reject(new PosError('Google did not allow access: ' + (r.error_description || r.error)));
        cache = { token: r.access_token, exp: Date.now() + Number(r.expires_in || 3000) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e: any) => reject(new PosError(e?.type === 'popup_closed' ? 'Google sign-in was closed before finishing.'
        : e?.type === 'popup_failed_to_open' ? 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.' : 'Google sign-in failed (' + (e?.type ?? 'unknown') + ').'))
    });
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

async function api(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await deps.fetch(url, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers as any) } });
  if (r.status === 401) cache = null;
  if (!r.ok) {
    const body = (await r.text().catch(() => '')).slice(0, 200);
    if (r.status === 403 && /accessNotConfigured|has not been used|disabled/i.test(body)) throw new PosError('Google Drive API is not enabled for your Google Cloud project. Enable "Google Drive API" and try again.');
    throw new PosError(`Google Drive replied ${r.status}. ${body}`);
  }
  return r;
}

async function verifyAccount(token: string) {
  const want = ((await getSetting('drive_email')) ?? '').trim().toLowerCase();
  const r = await api(token, `${DRIVE}/about?fields=user(emailAddress)`);
  const got = ((await r.json())?.user?.emailAddress ?? '').toLowerCase();
  if (want && got && want !== got) { cache = null; throw new PosError(`You signed in as ${got}, but the Drive email in Settings is ${want}. Sign in with the right account.`); }
}

async function ensureFolder(token: string): Promise<string> {
  const saved = await getSetting('drive_folder_id');
  if (saved) {
    const r = await deps.fetch(`${DRIVE}/files/${saved}?fields=id,trashed`, { headers: { Authorization: 'Bearer ' + token } });
    if (r.ok && !(await r.json()).trashed) return saved;
  }
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = (await (await api(token, `${DRIVE}/files?q=${q}&fields=files(id)&pageSize=1`)).json()).files?.[0]?.id as string | undefined;
  const id = found ?? (await (await api(token, `${DRIVE}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) })).json()).id as string;
  await setSettings({ drive_folder_id: id });
  return id;
}

export const folderLink = (id: string) => `https://drive.google.com/drive/folders/${id}`;

export interface DriveResult { name: string; folderId: string; link: string }

/** Uploads a full backup into the "Provision POS Backups" folder in the signed-in Drive. */
export async function backupToDrive(interactive: boolean): Promise<DriveResult> {
  const token = await deps.getToken(interactive);
  await verifyAccount(token);
  const folderId = await ensureFolder(token);
  const d = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  const name = `provision-pos-backup-${fmtDate(d.getTime())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const b = 'ppos' + Math.random().toString(36).slice(2);
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' })}\r\n` +
    `--${b}\r\nContent-Type: application/json\r\n\r\n${await exportBackup()}\r\n--${b}--`;
  await api(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
  await markDailyDownload();
  await setSettings({ drive_last_upload: String(Date.now()), drive_enabled: '1' });
  return { name, folderId, link: folderLink(folderId) };
}

export interface DriveFile { id: string; name: string; createdTime: string; size?: string }
export async function listDriveBackups(): Promise<DriveFile[]> {
  const token = await deps.getToken(true);
  await verifyAccount(token);
  const folderId = await ensureFolder(token);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const r = await api(token, `${DRIVE}/files?q=${q}&orderBy=createdTime%20desc&pageSize=30&fields=files(id,name,createdTime,size)`);
  return (await r.json()).files ?? [];
}
export async function downloadDriveBackup(id: string): Promise<string> {
  const token = await deps.getToken(true);
  return (await api(token, `${DRIVE}/files/${id}?alt=media`)).text();
}
export const resetDriveSession = () => { cache = null; };
