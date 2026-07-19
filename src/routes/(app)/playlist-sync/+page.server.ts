import { listPlaylistSubscriptions } from '$lib/server/playlists/store';
import { getSettings } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const settings = getSettings();
	return {
		subscriptions: listPlaylistSubscriptions(),
		checkHours: settings.subscriptionCheckHours
	};
};
