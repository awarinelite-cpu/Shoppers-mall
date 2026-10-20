import { describe, it, expect } from 'vitest';
import { lookupName } from './barcodeName';
const mk = (body: any, ok = true) => (async () => ({ ok, json: async () => body })) as any;
describe('lookupName', () => {
  it('joins brand, name and size', async () => expect(await lookupName('6001234567890', mk({ product: { product_name: 'Noodles', brands: 'Indomie', quantity: '70 g' } }))).toBe('Indomie Noodles 70 g'));
  it('null when unknown', async () => expect(await lookupName('6001234567890', mk({ status: 0 }))).toBeNull());
  it('null on network error / bad code', async () => { expect(await lookupName('6001234567890', (async () => { throw new Error('x'); }) as any)).toBeNull(); expect(await lookupName('abc')).toBeNull(); });
});
