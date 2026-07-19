import { search, type SearchFilter } from '$lib/server/ytmusic/api';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const FILTERS: SearchFilter[] = ['songs', 'albums', 'artists', 'playlists'];

/**
 * JSON search endpoint powering in-page pickers (e.g. the recommendation seed
 * picker). The search *page* has its own SSR loader; this is the fetch-friendly
 * variant returning `SearchResult[]` directly.
 */
export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	if (!query) return json({ results: [] });

	const rawFilter = url.searchParams.get('filter');
	const filter = FILTERS.includes(rawFilter as SearchFilter)
		? (rawFilter as SearchFilter)
		: undefined;

	try {
		const results = await search(query, filter);
		return json({ results });
	} catch (cause) {
		return json({ error: (cause as Error).message }, { status: 502 });
	}
};
