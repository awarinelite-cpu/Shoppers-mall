import { db } from './db';
import { getSetting, setSettings } from './repo';
import { PosError } from './money';

/**
 * Product photos. The picture is shrunk on the phone, uploaded to Cloudinary (a free image host) and only the returned link is
 * stored on the product, so the app and its database stay small. A photo taken with no network waits in `photoQueue`
 * (about 60-100 KB) and is uploaded later; once it has a link the waiting copy is deleted.
 */
export const deps = { fetch: (url: string, init?: RequestInit) => fetch(url, init) };
class RetryLater extends Error {}

export async function photoConfig(): Promise<{ cloud: string; preset: string } | null> {
  const cloud = ((await getSetting('photo_cloud')) ?? '').trim(), preset = ((await getSetting('photo_preset')) ?? '').trim();
  return cloud && preset ? { cloud, preset } : null;
}

const isCloudinary = (u: string) => /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(u);
/** size = square thumbnail in px; null = a screen-sized version. Other hosts' links are used as they are. */
export function photoSrc(url: string, size: number | null): string {
  if (!isCloudinary(url)) return url;
  const t = size ? `w_${size},h_${size},c_fill,q_auto,f_auto` : 'w_900,c_limit,q_auto,f_auto';
  return url.replace('/image/upload/', `/image/upload/${t}/`);
}

/** Browser only: scale the longest side down to `max` px and re-encode as JPEG. */
export async function shrinkImage(file: Blob, max = 800, quality = 0.8): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any).catch(() => { throw new PosError('That file could not be read as a picture.'); });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  return c.toDataURL('image/jpeg', quality);
}

export async function uploadPhoto(dataUrl: string): Promise<string> {
  const cfg = await photoConfig();
  if (!cfg) throw new PosError('Photo hosting is not set up. Add your Cloudinary details in Settings > Product photos.');
  const body = new FormData(); body.append('file', dataUrl); body.append('upload_preset', cfg.preset);
  let r: Response;
  try { r = await deps.fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloud)}/image/upload`, { method: 'POST', body }); }
  catch { throw new RetryLater('offline'); }
  const j: any = await r.json().catch(() => ({}));
  if (r.status >= 500 || r.status === 429) throw new RetryLater('busy');
  if (!r.ok) throw new PosError('Cloudinary refused the photo: ' + (j?.error?.message ?? 'error ' + r.status));
  if (!j.secure_url) throw new PosError('Cloudinary did not return a link for the photo.');
  return String(j.secure_url);
}

let working: Promise<{ left: number; error?: string }> | null = null;
/** Uploads waiting photos one by one. Stops at the first failure and keeps the rest. Safe to call any time. */
export function processPhotoQueue(): Promise<{ left: number; error?: string }> {
  if (working) return working;
  working = (async () => {
    let error: string | undefined;
    try {
      for (const job of await db.photoQueue.orderBy('at').toArray()) {
        if (!(await db.products.get(job.productId))) { await db.photoQueue.delete(job.productId); continue; }   // product no longer exists
        if (!(await photoConfig())) { error = 'Photo hosting is not set up. Add your Cloudinary details in Settings > Product photos.'; break; }
        try {
          const url = await uploadPhoto(job.dataUrl);
          await db.transaction('rw', db.products, db.photoQueue, async () => {
            const cur = await db.photoQueue.get(job.productId);
            if (cur && cur.at !== job.at) return;                       // a newer photo was taken meanwhile; that one goes next round
            await db.products.update(job.productId, { photoUrl: url });  // a detail edit, so it syncs to the other phones
            await db.photoQueue.delete(job.productId);
          });
        } catch (e: any) { if (!(e instanceof RetryLater)) error = e?.message ?? 'Upload failed'; break; }
      }
    } finally { working = null; }
    await setSettings({ photo_error: error ?? '' });
    return { left: await db.photoQueue.count(), error };
  })();
  return working;
}

/** Keep `dataUrl` for the product and upload it now if possible. Resolves 'uploaded' or 'waiting' (no network, try again later). */
export async function attachPhoto(productId: number, dataUrl: string): Promise<'uploaded' | 'waiting'> {
  if (!(await photoConfig())) throw new PosError('Photo hosting is not set up. Add your Cloudinary details in Settings > Product photos.');
  await db.photoQueue.put({ productId, dataUrl, at: Date.now() });
  let r = await processPhotoQueue();
  if (!r.error && (await db.photoQueue.get(productId))) r = await processPhotoQueue();   // an earlier run may have started before this photo was queued
  if (r.error) throw new PosError(r.error);
  return (await db.photoQueue.get(productId)) ? 'waiting' : 'uploaded';
}

export const photoQueueCount = () => db.photoQueue.count();
