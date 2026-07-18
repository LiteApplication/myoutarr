import { getSettings, updateSettings, type Settings } from '$lib/server/settings';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return { settings: getSettings() };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const patch: Partial<Settings> = {};

		const audioFormat = String(form.get('audioFormat') ?? '');
		if (['opus', 'm4a', 'mp3', 'flac'].includes(audioFormat)) {
			patch.audioFormat = audioFormat as Settings['audioFormat'];
		}
		const quality = Number(form.get('audioQuality'));
		if (Number.isInteger(quality) && quality >= 0 && quality <= 10) patch.audioQuality = quality;
		const concurrency = Number(form.get('concurrency'));
		if (Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8) {
			patch.concurrency = concurrency;
		}
		const maxRetries = Number(form.get('maxRetries'));
		if (Number.isInteger(maxRetries) && maxRetries >= 0 && maxRetries <= 10) {
			patch.maxRetries = maxRetries;
		}
		const template = String(form.get('namingTemplate') ?? '').trim();
		if (template.includes('{title}')) patch.namingTemplate = template;
		patch.sponsorBlock = form.get('sponsorBlock') === 'on';
		patch.musicBrainz = form.get('musicBrainz') === 'on';
		patch.jellyfinRefresh = form.get('jellyfinRefresh') === 'on';
		const rateLimit = String(form.get('rateLimit') ?? '').trim();
		if (rateLimit === '' || /^\d+(\.\d+)?[KMG]?$/i.test(rateLimit)) patch.rateLimit = rateLimit;
		else return fail(400, { error: 'Rate limit must look like 500K or 4M.' });

		const playerClient = String(form.get('ytdlpPlayerClient') ?? '').trim();
		if (playerClient === '' || /^[A-Za-z0-9_+,-]+$/.test(playerClient)) {
			patch.ytdlpPlayerClient = playerClient;
		} else {
			return fail(400, {
				error: 'Player client may only contain letters, digits, _ + - and commas.'
			});
		}

		return { settings: updateSettings(patch), saved: true };
	}
};
