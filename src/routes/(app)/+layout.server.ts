import { redirect } from '@sveltejs/kit';
import { appVersion } from '$lib/server/env';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	// hooks.server.ts already guards; this is belt-and-braces for the group.
	if (!locals.session) redirect(303, '/login');
	return { userName: locals.session.userName, appVersion: appVersion() };
};
