import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YtMusicWorker } from './client.ts';

const FAKE = path.join(import.meta.dirname, 'fake_worker.py');

let worker: YtMusicWorker | null = null;

afterEach(() => {
	worker?.stop();
	worker = null;
});

describe('YtMusicWorker', () => {
	it('matches concurrent responses to their requests by id', async () => {
		worker = new YtMusicWorker('python3', FAKE);
		const [a, b, c] = await Promise.all([
			worker.call<{ method: string }>('alpha', {}),
			worker.call<{ method: string }>('beta', {}),
			worker.call<{ method: string }>('gamma', {})
		]);
		expect(a.method).toBe('alpha');
		expect(b.method).toBe('beta');
		expect(c.method).toBe('gamma');
	});

	it('passes params through and returns them intact', async () => {
		worker = new YtMusicWorker('python3', FAKE);
		const result = await worker.call<{ params: { query: string } }>('search', {
			query: 'daft punk & friends "1998" <test>'
		});
		expect(result.params.query).toBe('daft punk & friends "1998" <test>');
	});

	it('surfaces worker-side errors as YtMusicError', async () => {
		worker = new YtMusicWorker('python3', FAKE);
		await expect(worker.call('boom', {})).rejects.toThrow('synthetic failure');
	});

	it('recovers after a worker crash', async () => {
		worker = new YtMusicWorker('python3', FAKE, ['crash']);
		await worker.call('first', {}); // fake exits right after this reply
		// Wait past the first restart backoff, then the call must succeed again.
		await new Promise((r) => setTimeout(r, 700));
		const result = await worker.call<{ method: string }>('second', {});
		expect(result.method).toBe('second');
	});
});
