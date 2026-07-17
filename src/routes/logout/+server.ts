import { deleteSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies, locals }) => {
	if (locals.session) deleteSession(locals.session.id);
	cookies.delete(SESSION_COOKIE, { path: '/' });
	redirect(303, '/login');
};
