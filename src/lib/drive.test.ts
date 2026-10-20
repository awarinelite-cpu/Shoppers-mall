import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import * as repo from './repo';
import * as drive from './drive';
import { PosError } from './money';

// Minimal in-memory fake of the Google Drive v3 endpoints used by the app.
function fakeDrive(email = 'owner@gmail.com') {
  const files = new Map<string, any>(); let n = 0; const log: string[] = [];
  const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status });
  const f = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url); const method = init.method ?? 'GET'; log.push(`${method} ${u.pathname}`);
    if (!(init.headers as any)?.Authorization?.startsWith('Bearer ')) return json({}, 401);
    if (u.pathname === '/drive/v3/about') return json({ user: { emailAddress: email } });
    if (u.pathname === '/upload/drive/v3/files') {
      const body = String(init.body); const parts = body.split(/--ppos\w+/).filter((p) => p.includes('Content-Type'));
      const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim()); const content = parts[1].split('\r\n\r\n')[1].replace(/\r\n$/, '');
      const id = 'f' + ++n; files.set(id, { id, ...meta, content, createdTime: new Date(2026, 9, n).toISOString() }); return json({ id, name: meta.name });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') { const meta = JSON.parse(String(init.body)); const id = 'd' + ++n; files.set(id, { id, ...meta }); return json({ id }); }
    if (u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q') ?? '';
      const list = [...files.values()].filter((x) => /in parents/.test(q) ? x.parents?.includes(q.match(/'([^']+)' in parents/)![1]) : q.includes(x.name) && x.mimeType.includes('folder'));
      return json({ files: list.sort((a, b) => b.createdTime?.localeCompare(a.createdTime ?? '') ?? 0) });
    }
    const m = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/);
    if (m) { const x = files.get(m[1]); if (!x) return json({}, 404); return u.searchParams.get('alt') === 'media' ? new Response(x.content) : json({ id: x.id, trashed: false }); }
    return json({}, 404);
  };
  return { f, files, log };
}

const mk = () => repo.saveProduct({ name: 'Rice', barcode: '1', category: '', costKobo: 1, priceKobo: 100, stockMilli: 5000, lowThresholdMilli: 1000, unit: 'PIECE' });

describe('google drive backup', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear())); drive.resetDriveSession();
    drive.deps.getToken = async () => 'tok';
  });

  it('creates the folder once, uploads a restorable backup into it, and records the time', async () => {
    const d = fakeDrive(); drive.deps.fetch = d.f as any;
    await repo.setSettings({ drive_email: 'Owner@Gmail.com', store_name: 'Shop' }); await mk();
    const r1 = await drive.backupToDrive(true); await drive.backupToDrive(true);
    const folders = [...d.files.values()].filter((x) => x.mimeType.includes('folder')); expect(folders.length).toBe(1);
    const ups = [...d.files.values()].filter((x) => !x.mimeType.includes('folder'));
    expect(ups.length).toBe(2); expect(ups[0].parents).toEqual([folders[0].id]); expect(r1.link).toContain(folders[0].id);
    expect(ups[0].name).toMatch(/^provision-pos-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    await db.products.clear();                                                // lose data, then restore from what Drive holds
    const text = await drive.downloadDriveBackup(ups[0].id); await repo.restoreBackup(text);
    expect(await db.products.count()).toBe(1);
    expect(await repo.getSetting('drive_last_upload')).toBeTruthy();         // this phone's Drive link survives the restore
    expect(await repo.getSetting('drive_folder_id')).toBe(folders[0].id); expect(await repo.getSetting('store_name')).toBe('Shop');
  });
  it('lists backups newest first', async () => {
    const d = fakeDrive(); drive.deps.fetch = d.f as any; await repo.setSettings({ drive_email: 'owner@gmail.com' }); await mk();
    await drive.backupToDrive(true); await drive.backupToDrive(true);
    const l = await drive.listDriveBackups(); expect(l.length).toBe(2); expect(l[0].createdTime > l[1].createdTime).toBe(true);
  });
  it('refuses a different Google account and uploads nothing', async () => {
    const d = fakeDrive('someone.else@gmail.com'); drive.deps.fetch = d.f as any;
    await repo.setSettings({ drive_email: 'owner@gmail.com' }); await mk();
    await expect(drive.backupToDrive(true)).rejects.toThrow(/signed in as someone.else@gmail.com/);
    expect(d.files.size).toBe(0);
  });
  it('shows friendly errors for API disabled and missing client id', async () => {
    drive.deps.fetch = (async () => new Response('{"error":{"errors":[{"reason":"accessNotConfigured"}]}}', { status: 403 })) as any;
    await expect(drive.backupToDrive(true)).rejects.toThrow(/Drive API is not enabled/);
    expect(await drive.driveReady()).toBe(false);
    await repo.setSettings({ drive_enabled: '1', drive_email: 'a@b.com', drive_client_id: 'x.apps.googleusercontent.com' }); expect(await drive.driveReady()).toBe(true);
    await repo.setSettings({ drive_client_id: '' }); expect(await drive.driveReady()).toBe(false);
  });
  it('a failed upload does not mark the daily backup as done', async () => {
    drive.deps.fetch = (async () => new Response('nope', { status: 500 })) as any; await repo.setSettings({ drive_email: 'a@b.com' }); await mk();
    await expect(drive.backupToDrive(true)).rejects.toThrow(PosError);
    expect(await repo.dueDailyDownload()).toBe(true);
  });
});
