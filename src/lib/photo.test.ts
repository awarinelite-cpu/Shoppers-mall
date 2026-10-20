import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import * as repo from './repo';
import * as photo from './photo';

const mk = (name: string) => repo.saveProduct({ name, barcode: undefined, category: 'T', costKobo: 100, priceKobo: 500, stockMilli: 1000, lowThresholdMilli: 0, unit: 'PIECE' });
const ok = (url: string) => async () => new Response(JSON.stringify({ secure_url: url }), { status: 200 });
const URL1 = 'https://res.cloudinary.com/democloud/image/upload/v1/pos/a.jpg';
const DATA = 'data:image/jpeg;base64,/9j/4AAQ';

describe('product photos', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    photo.deps.fetch = ok(URL1);
    await repo.setSettings({ photo_cloud: 'democloud', photo_preset: 'pos' });
  });

  it('makes small thumbnails from a Cloudinary link and leaves other links alone', () => {
    expect(photo.photoSrc(URL1, 96)).toBe('https://res.cloudinary.com/democloud/image/upload/w_96,h_96,c_fill,q_auto,f_auto/v1/pos/a.jpg');
    expect(photo.photoSrc(URL1, null)).toContain('/upload/w_900,c_limit,q_auto,f_auto/v1/');
    expect(photo.photoSrc('https://example.com/x.png', 96)).toBe('https://example.com/x.png');
  });

  it('uploads, stores only the link on the product, and clears the waiting copy', async () => {
    const id = await mk('Rice'); let sent: any;
    photo.deps.fetch = async (u, init) => { sent = { u, body: init!.body as FormData }; return new Response(JSON.stringify({ secure_url: URL1 }), { status: 200 }); };
    expect(await photo.attachPhoto(id, DATA)).toBe('uploaded');
    const p = (await db.products.get(id))!;
    expect(p.photoUrl).toBe(URL1); expect(p.dirty).toBe(1);                  // a detail edit: it will sync to other phones
    expect(await db.photoQueue.count()).toBe(0);
    expect(sent.u).toBe('https://api.cloudinary.com/v1_1/democloud/image/upload');
    expect(sent.body.get('upload_preset')).toBe('pos'); expect(sent.body.get('file')).toBe(DATA);
    expect(JSON.stringify(p).length).toBeLessThan(600);                        // the record holds a link, not a picture
  });

  it('offline: the photo waits, the product is fine, and it uploads later', async () => {
    const id = await mk('Rice');
    photo.deps.fetch = async () => { throw new TypeError('Failed to fetch'); };
    expect(await photo.attachPhoto(id, DATA)).toBe('waiting');
    expect((await db.products.get(id))!.photoUrl).toBeUndefined(); expect(await db.photoQueue.count()).toBe(1);
    photo.deps.fetch = ok(URL1);
    expect(await photo.processPhotoQueue()).toEqual({ left: 0, error: undefined });
    expect((await db.products.get(id))!.photoUrl).toBe(URL1);
  });

  it('a server hiccup (5xx) is retried later; a refusal (bad preset) is reported and kept', async () => {
    const id = await mk('Rice');
    photo.deps.fetch = async () => new Response('{}', { status: 503 });
    expect(await photo.attachPhoto(id, DATA)).toBe('waiting');
    photo.deps.fetch = async () => new Response(JSON.stringify({ error: { message: 'Upload preset not found' } }), { status: 400 });
    await expect(photo.attachPhoto(id, DATA)).rejects.toThrow(/Upload preset not found/);
    expect(await db.photoQueue.count()).toBe(1); expect(await repo.getSetting('photo_error')).toMatch(/preset/);
    photo.deps.fetch = ok(URL1); await photo.processPhotoQueue();
    expect(await repo.getSetting('photo_error')).toBe(''); expect((await db.products.get(id))!.photoUrl).toBe(URL1);
  });

  it('refuses clearly when photo hosting is not set up, and drops photos of deleted products', async () => {
    const id = await mk('Rice');
    await db.settings.bulkDelete(['photo_cloud', 'photo_preset']);
    await expect(photo.attachPhoto(id, DATA)).rejects.toThrow(/not set up/);
    expect(await db.photoQueue.count()).toBe(0);
    await repo.setSettings({ photo_cloud: 'democloud', photo_preset: 'pos' });
    await db.photoQueue.put({ productId: 999, dataUrl: DATA, at: 1 });
    expect((await photo.processPhotoQueue()).left).toBe(0);
  });

  it('saving the product form with no new photo keeps the link; removing it clears it', async () => {
    const id = await mk('Rice'); await photo.attachPhoto(id, DATA);
    const p = (await db.products.get(id))!;
    await repo.saveProduct({ ...p, name: 'Rice 50kg' }); expect((await db.products.get(id))!.photoUrl).toBe(URL1);
    await repo.saveProduct({ ...p, name: 'Rice 50kg', photoUrl: undefined }); expect((await db.products.get(id))!.photoUrl).toBeUndefined();
  });

  it('photo hosting details are shared with other phones; the waiting queue is not part of backups', async () => {
    const id = await mk('Rice'); photo.deps.fetch = async () => { throw new TypeError('x'); }; await photo.attachPhoto(id, DATA);
    expect(repo.SHARED_SETTINGS).toContain('photo_cloud');
    expect(await repo.exportBackup()).not.toContain('base64');
  });
});
