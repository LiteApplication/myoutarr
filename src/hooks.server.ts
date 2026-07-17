import { getSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { getSettings } from '$lib/server/settings';
import { redirect, type Handle } from '@sveltejs/kit';

/** Paths reachable without a session. */
const PUBLIC_PATHS = new Set(['/login', '/setup', '/api/health']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.session = getSession(event.cookies.get(SESSION_COOKIE));

	const { pathname } = event.url;
	const isPublic = PUBLIC_PATHS.has(pathname);

	if (!isPublic && !event.locals.session) {
		// Unconfigured instance goes to the wizard, configured one to login.
		const configured = getSettings().jellyfinUrl !== '';
		if (pathname.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'unauthorized' }), {
				status: 401,
				headers: { 'content-type': 'application/json' }
			});
		}
		redirect(303, configured ? '/login' : '/setup');
	}

	return resolve(event);
};
