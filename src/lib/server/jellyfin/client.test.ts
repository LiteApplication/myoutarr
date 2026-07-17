import { describe, expect, it, vi } from 'vitest';
import { JellyfinClient, JellyfinError } from './client.ts';

function mockFetch(status: number, body: unknown): typeof fetch {
	return vi.fn(
		async () =>
			new Response(status === 204 ? null : JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			})
	) as unknown as typeof fetch;
}

describe('JellyfinClient', () => {
	it('rejects non-http(s) URLs', () => {
		expect(() => new JellyfinClient('ftp://example.com')).toThrow(JellyfinError);
		expect(() => new JellyfinClient('not a url')).toThrow();
	});

	it('strips trailing slashes from the base URL', async () => {
		const fetchImpl = mockFetch(200, { Version: '10.9.0', ServerName: 'test' });
		const client = new JellyfinClient('http://jf:8096///', fetchImpl);
		await client.ping();
		const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(calledUrl).toBe('http://jf:8096/System/Info/Public');
	});

	it('sends the MediaBrowser authorization header', async () => {
		const fetchImpl = mockFetch(200, { Version: '10.9.0' });
		await new JellyfinClient('http://jf:8096', fetchImpl).ping();
		const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		const auth = (init.headers as Record<string, string>).Authorization;
		expect(auth).toContain('MediaBrowser Client="myoutarr"');
		expect(auth).not.toContain('Token=');
	});

	it('parses a successful authentication', async () => {
		const fetchImpl = mockFetch(200, {
			AccessToken: 'tok',
			User: { Id: 'u1', Name: 'alexis', Policy: { IsAdministrator: true } }
		});
		const result = await new JellyfinClient('http://jf:8096', fetchImpl).authenticateByName(
			'alexis',
			'pw'
		);
		expect(result).toEqual({ accessToken: 'tok', id: 'u1', name: 'alexis', isAdmin: true });
	});

	it('surfaces 401 as a JellyfinError with status', async () => {
		const fetchImpl = mockFetch(401, {});
		await expect(
			new JellyfinClient('http://jf:8096', fetchImpl).authenticateByName('x', 'y')
		).rejects.toMatchObject({ name: 'JellyfinError', status: 401 });
	});

	it('me() returns null on revoked tokens instead of throwing', async () => {
		const fetchImpl = mockFetch(401, {});
		const result = await new JellyfinClient('http://jf:8096', fetchImpl).me('stale');
		expect(result).toBeNull();
	});

	it('filters virtual folders down to music collections', async () => {
		const fetchImpl = mockFetch(200, [
			{ Name: 'Movies', CollectionType: 'movies', Locations: ['/movies'] },
			{ Name: 'Music', CollectionType: 'music', Locations: ['/music'] },
			{ Name: 'Mixed', Locations: ['/mixed'] }
		]);
		const libraries = await new JellyfinClient('http://jf:8096', fetchImpl).musicLibraries('t');
		expect(libraries.map((l) => l.name)).toEqual(['Music', 'Mixed']);
	});

	it('wraps network failures in JellyfinError', async () => {
		const failing = vi.fn(async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof fetch;
		await expect(new JellyfinClient('http://jf:8096', failing).ping()).rejects.toThrow(
			/Cannot reach Jellyfin/
		);
	});
});
