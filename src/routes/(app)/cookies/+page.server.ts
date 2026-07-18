import {
	deleteCookies,
	hasCookies,
	looksLikeCookiesFile,
	saveCookies
} from '$lib/server/ytdlp/cookies';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.session) error(401);
	return { hasCookies: hasCookies(locals.session.userId) };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (!locals.session) error(401);
		const form = await request.formData();

		// Prefer an uploaded file; fall back to pasted text.
		const upload = form.get('file');
		const raw =
			upload instanceof File && upload.size > 0
				? await upload.text()
				: String(form.get('cookies') ?? '');
		const contents = raw.replace(/\r\n/g, '\n').trim();

		if (contents.length === 0) {
			return fail(400, { error: 'Paste your cookies.txt or choose a file first.' });
		}
		if (!looksLikeCookiesFile(contents)) {
			return fail(400, {
				error:
					'That does not look like a Netscape cookies.txt export. Use the recommended browser extension and export the raw file.'
			});
		}

		saveCookies(locals.session.userId, contents + '\n');
		return { saved: true, hasCookies: true };
	},

	delete: async ({ locals }) => {
		if (!locals.session) error(401);
		deleteCookies(locals.session.userId);
		return { deleted: true, hasCookies: false };
	}
};
