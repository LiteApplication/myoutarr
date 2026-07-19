import {
	createSession,
	loginAllowed,
	resetLoginAttempts,
	SESSION_COOKIE
} from '$lib/server/auth/session';
import { requireAdmin } from '$lib/server/env';
import { canUseMyoutarr, JellyfinClient, JellyfinError } from '$lib/server/jellyfin/client';
import { getSettings } from '$lib/server/settings';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.session) redirect(303, '/');
	if (getSettings().jellyfinUrl === '') redirect(303, '/setup');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		if (!loginAllowed(getClientAddress())) {
			return fail(429, { error: 'Too many attempts. Try again in a few minutes.' });
		}

		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');
		if (!username) return fail(400, { error: 'Username is required.' });

		const client = new JellyfinClient(getSettings().jellyfinUrl);
		try {
			const auth = await client.authenticateByName(username, password);
			if (requireAdmin() && !auth.isAdmin) {
				return fail(403, { error: 'This instance is restricted to Jellyfin administrators.' });
			}
			if (!requireAdmin() && !canUseMyoutarr(auth)) {
				return fail(403, {
					error: 'Your Jellyfin account needs collection-management rights to use this.'
				});
			}
			resetLoginAttempts(getClientAddress());
			const session = createSession(auth, auth.accessToken);
			cookies.set(SESSION_COOKIE, session.id, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: false,
				maxAge: 30 * 24 * 60 * 60
			});
		} catch (error) {
			if (error instanceof JellyfinError && error.status === 401) {
				return fail(401, { error: 'Wrong username or password.' });
			}
			return fail(502, {
				error: error instanceof JellyfinError ? error.message : 'Login failed unexpectedly.'
			});
		}
		redirect(303, '/');
	}
};
