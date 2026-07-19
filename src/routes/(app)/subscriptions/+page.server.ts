import { getSettings } from '$lib/server/settings';
import { listSubscriptions } from '$lib/server/subscriptions/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const settings = getSettings();
	return {
		subscriptions: listSubscriptions(locals.session!.userId),
		enabled: settings.subscriptionsEnabled,
		checkHours: settings.subscriptionCheckHours
	};
};
