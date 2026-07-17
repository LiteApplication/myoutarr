import { createSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { requireAdmin } from '$lib/server/env';
import { JellyfinClient, JellyfinError } from '$lib/server/jellyfin/client';
import { getSettings, updateSettings } from '$lib/server/settings';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const settings = getSettings();
	// Once fully configured, the wizard is off-limits: reconfiguration happens
	// in Settings by an authenticated admin, not on an unauthenticated route.
	if (settings.jellyfinUrl !== '' && settings.jellyfinLibraryPath !== '') {
		redirect(303, '/login');
	}
	// Mid-wizard (authenticated, library not yet chosen): offer the pick step.
	if (settings.jellyfinUrl !== '' && locals.session) {
		const client = new JellyfinClient(settings.jellyfinUrl);
		const libraries = await client.musicLibraries(locals.session.jellyfinToken).catch(() => []);
		return {
			phase: 'library' as const,
			libraries: libraries.map((l) => ({ name: l.name, locations: l.locations }))
		};
	}
	return { phase: 'connect' as const, libraries: [] };
};

export const actions: Actions = {
	/** Probe the server URL before asking for credentials. */
	test: async ({ request }) => {
		const form = await request.formData();
		const url = String(form.get('url') ?? '').trim();
		if (!url) return fail(400, { step: 'test', error: 'Enter your Jellyfin server URL.' });
		try {
			const info = await new JellyfinClient(url).ping();
			return { step: 'test', ok: true, serverName: info.serverName, version: info.version, url };
		} catch (error) {
			const message = error instanceof JellyfinError ? error.message : 'Could not reach that URL.';
			return fail(400, { step: 'test', error: message });
		}
	},

	/** Authenticate and persist the server URL; the library pick follows as an authenticated step. */
	connect: async ({ request, cookies }) => {
		const form = await request.formData();
		const url = String(form.get('url') ?? '').trim();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!url || !username) {
			return fail(400, { step: 'connect', error: 'Server URL and username are required.' });
		}

		let client: JellyfinClient;
		try {
			client = new JellyfinClient(url);
		} catch {
			return fail(400, { step: 'connect', error: 'That server URL is not valid.' });
		}

		try {
			const auth = await client.authenticateByName(username, password);
			if (requireAdmin() && !auth.isAdmin) {
				return fail(403, {
					step: 'connect',
					error: 'Setup requires a Jellyfin administrator account.'
				});
			}
			updateSettings({ jellyfinUrl: url });
			const session = createSession(auth, auth.accessToken);
			cookies.set(SESSION_COOKIE, session.id, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: false, // container is expected to sit behind a TLS-terminating proxy
				maxAge: 30 * 24 * 60 * 60
			});
		} catch (error) {
			if (error instanceof JellyfinError && error.status === 401) {
				return fail(401, { step: 'connect', error: 'Wrong username or password.' });
			}
			return fail(502, {
				step: 'connect',
				error: error instanceof JellyfinError ? error.message : 'Setup failed unexpectedly.'
			});
		}
		// Reload the wizard: the load function now serves the library-pick phase.
		redirect(303, '/setup');
	},

	/** Final step: persist the chosen music library path. Requires the session from `connect`. */
	library: async ({ request, locals }) => {
		if (!locals.session)
			return fail(401, { step: 'library', error: 'Session expired — log in again.' });
		const form = await request.formData();
		const libraryPath = String(form.get('libraryPath') ?? '').trim();
		if (!libraryPath) {
			return fail(400, { step: 'library', error: 'Choose or enter a library path.' });
		}
		updateSettings({ jellyfinLibraryPath: libraryPath });
		redirect(303, '/');
	}
};
