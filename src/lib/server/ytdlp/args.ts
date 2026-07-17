import path from 'node:path';
import type { Settings } from '../settings.ts';

/**
 * Build the yt-dlp argv for one track download.
 *
 * SECURITY: the result is only ever passed to execFile/spawn as an argv array.
 * Building a shell string from any of this (video ids and titles are
 * user-influenced) would be a command injection hole.
 */
export function buildYtdlpArgs(options: {
	videoId: string;
	scratchDir: string;
	settings: Pick<Settings, 'audioFormat' | 'audioQuality' | 'sponsorBlock' | 'rateLimit'>;
	cookiesFile?: string;
}): string[] {
	const { videoId, scratchDir, settings } = options;
	if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
		throw new Error(`suspicious video id rejected: ${JSON.stringify(videoId)}`);
	}
	const args = [
		'--no-playlist',
		'--extract-audio',
		'--audio-format',
		settings.audioFormat,
		'--audio-quality',
		String(settings.audioQuality),
		'--output',
		path.join(scratchDir, 'track.%(ext)s'),
		'--paths',
		`temp:${scratchDir}`,
		'--newline',
		'--progress-template',
		// One JSON object per line; parsed by progress.ts.
		'%(progress)j',
		'--no-warnings',
		'--retries',
		'3',
		'--socket-timeout',
		'15'
	];
	if (settings.sponsorBlock) {
		args.push('--sponsorblock-remove', 'music_offtopic');
	}
	if (settings.rateLimit) {
		if (!/^\d+(\.\d+)?[KMG]?$/i.test(settings.rateLimit)) {
			throw new Error(`invalid rate limit: ${JSON.stringify(settings.rateLimit)}`);
		}
		args.push('--limit-rate', settings.rateLimit);
	}
	if (options.cookiesFile) {
		args.push('--cookies', options.cookiesFile);
	}
	// The id is constrained above, and '--' stops option parsing regardless.
	args.push('--', `https://music.youtube.com/watch?v=${videoId}`);
	return args;
}
