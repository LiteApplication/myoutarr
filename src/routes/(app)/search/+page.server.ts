import { resolveSong, search, type SearchFilter } from '$lib/server/ytmusic/api';
import { parseYtUrl } from '$lib/server/ytmusic/parseUrl';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const FILTERS: SearchFilter[] = ['songs', 'albums', 'artists', 'playlists'];

/**
 * When the query is a YouTube / YouTube Music URL, jump straight to the
 * matching page instead of running a text search. Returns the redirect target,
 * or `null` to fall through to normal search. Songs have no page of their own,
 * so they resolve to their album (or a title/artist search as a fallback).
 */
async function urlTarget(query: string): Promise<string | null> {
	const target = parseYtUrl(query);
	if (!target) return null;

	switch (target.kind) {
		case 'album':
			return `/album/${encodeURIComponent(target.id)}`;
		case 'artist':
			return `/artist/${encodeURIComponent(target.id)}`;
		case 'playlist':
			return `/playlist/${encodeURIComponent(target.id)}`;
		case 'song': {
			try {
				const song = await resolveSong(target.videoId);
				if (song.albumId) return `/album/${encodeURIComponent(song.albumId)}`;
				const text = [song.title, song.artist].filter(Boolean).join(' ').trim();
				if (text) return `/search?q=${encodeURIComponent(text)}`;
			} catch {
				// Fall through to a normal (empty-ish) search rather than 502.
			}
			return null;
		}
	}
}

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const rawFilter = url.searchParams.get('filter');
	const filter = FILTERS.includes(rawFilter as SearchFilter)
		? (rawFilter as SearchFilter)
		: undefined;

	if (!query) return { query: '', filter, results: [] };

	const target = await urlTarget(query);
	if (target) redirect(303, target);

	try {
		const results = await search(query, filter);
		return { query, filter, results };
	} catch (cause) {
		error(502, `Search failed: ${(cause as Error).message}`);
	}
};
