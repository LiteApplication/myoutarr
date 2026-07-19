import { listPlaylists, trackCount } from '$lib/server/recommendations/store';
import { getSettings } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const settings = getSettings();
	return {
		playlists: listPlaylists(locals.session!.userId).map((pl) => ({
			...pl,
			trackCount: trackCount(pl.id)
		})),
		enabled: settings.recommendationsEnabled,
		checkHours: settings.subscriptionCheckHours
	};
};
