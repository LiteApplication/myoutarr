import { search, type SearchFilter } from '$lib/server/ytmusic/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const FILTERS: SearchFilter[] = ['songs', 'albums', 'artists', 'playlists'];

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const rawFilter = url.searchParams.get('filter');
	const filter = FILTERS.includes(rawFilter as SearchFilter)
		? (rawFilter as SearchFilter)
		: undefined;

	if (!query) return { query: '', filter, results: [] };

	try {
		const results = await search(query, filter);
		return { query, filter, results };
	} catch (cause) {
		error(502, `Search failed: ${(cause as Error).message}`);
	}
};
