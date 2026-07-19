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
			User: {
				Id: 'u1',
				Name: 'alexis',
				Policy: { IsAdministrator: true, EnableCollectionManagement: false }
			}
		});
		const result = await new JellyfinClient('http://jf:8096', fetchImpl).authenticateByName(
			'alexis',
			'pw'
		);
		expect(result).toEqual({
			accessToken: 'tok',
			id: 'u1',
			name: 'alexis',
			isAdmin: true,
			canManageCollections: false
		});
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

	it('playlistItemIds returns the ids of items currently in the playlist', async () => {
		const fetchImpl = mockFetch(200, { Items: [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }] });
		const ids = await new JellyfinClient('http://jf:8096', fetchImpl).playlistItemIds(
			't',
			'pl-1',
			'u1'
		);
		expect(ids).toEqual(['a', 'b', 'c']);
		const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(calledUrl).toBe('http://jf:8096/Playlists/pl-1/Items?userId=u1');
	});

	it('prependToPlaylist adds new items and moves them to the front in order', async () => {
		// Playlist starts with one entry; each item id carries a per-playlist entry id.
		const entries: { Id: string; PlaylistItemId: string }[] = [{ Id: 'a', PlaylistItemId: 'pa' }];
		let nextEntry = 0;
		const moves: { playlistItemId: string; index: number }[] = [];

		const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
			const url = new URL(input);
			const method = init?.method ?? 'GET';
			const move = url.pathname.match(/\/Playlists\/pl\/Items\/([^/]+)\/Move\/(\d+)$/);
			if (method === 'POST' && move) {
				moves.push({ playlistItemId: move[1], index: Number(move[2]) });
				return new Response(null, { status: 204 });
			}
			if (method === 'POST' && url.pathname === '/Playlists/pl/Items') {
				for (const id of (url.searchParams.get('ids') ?? '').split(',')) {
					entries.push({ Id: id, PlaylistItemId: `p${id}${nextEntry++}` });
				}
				return new Response(null, { status: 204 });
			}
			// GET /Playlists/pl/Items
			return new Response(JSON.stringify({ Items: entries }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}) as unknown as typeof fetch;

		await new JellyfinClient('http://jf:8096', fetchImpl).prependToPlaylist('t', 'pl', 'u1', [
			'x',
			'y'
		]);

		// Both new items were moved to the front, x before y (indices 0 then 1).
		expect(moves).toEqual([
			{ playlistItemId: 'px0', index: 0 },
			{ playlistItemId: 'py1', index: 1 }
		]);
	});

	it('prependToPlaylist skips items already present', async () => {
		const entries = [
			{ Id: 'a', PlaylistItemId: 'pa' },
			{ Id: 'x', PlaylistItemId: 'px' }
		];
		const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			if (method === 'POST') throw new Error('should not add or move an already-present item');
			return new Response(JSON.stringify({ Items: entries }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}) as unknown as typeof fetch;
		// 'x' is already in the playlist, so nothing is added or moved.
		await new JellyfinClient('http://jf:8096', fetchImpl).prependToPlaylist('t', 'pl', 'u1', ['x']);
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
