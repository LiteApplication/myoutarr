import { describe, expect, it } from 'vitest';
import { buildYtdlpArgs } from './args.ts';
import { parseProgressLine } from './progress.ts';

const settings = {
	audioFormat: 'opus' as const,
	audioQuality: 0,
	sponsorBlock: true,
	rateLimit: ''
};

describe('buildYtdlpArgs', () => {
	it('builds a complete argv for a normal id', () => {
		const args = buildYtdlpArgs({ videoId: 'IluRBvnYMoY', scratchDir: '/scratch/j1', settings });
		expect(args).toContain('--extract-audio');
		expect(args).toContain('opus');
		expect(args).toContain('--sponsorblock-remove');
		expect(args.at(-1)).toBe('https://music.youtube.com/watch?v=IluRBvnYMoY');
		expect(args.at(-2)).toBe('--');
	});

	it('rejects hostile video ids before they reach any process boundary', () => {
		for (const hostile of [
			'$(rm -rf /)',
			'; rm -rf /',
			'`id`',
			'--exec=evil',
			'a b',
			'"quoted"',
			'',
			'x'.repeat(50)
		]) {
			expect(() => buildYtdlpArgs({ videoId: hostile, scratchDir: '/s', settings })).toThrow(
				/suspicious video id/
			);
		}
	});

	it('validates the rate limit shape', () => {
		expect(
			buildYtdlpArgs({
				videoId: 'IluRBvnYMoY',
				scratchDir: '/s',
				settings: { ...settings, rateLimit: '4M' }
			})
		).toContain('--limit-rate');
		expect(() =>
			buildYtdlpArgs({
				videoId: 'IluRBvnYMoY',
				scratchDir: '/s',
				settings: { ...settings, rateLimit: '4M; rm -rf /' }
			})
		).toThrow(/invalid rate limit/);
	});

	it('omits sponsorblock and cookies unless enabled', () => {
		const args = buildYtdlpArgs({
			videoId: 'IluRBvnYMoY',
			scratchDir: '/s',
			settings: { ...settings, sponsorBlock: false }
		});
		expect(args).not.toContain('--sponsorblock-remove');
		expect(args).not.toContain('--cookies');
	});
});

describe('parseProgressLine', () => {
	it('parses a downloading frame with byte totals', () => {
		const update = parseProgressLine(
			'{"status": "downloading", "downloaded_bytes": 500, "total_bytes": 1000, "speed": 12345.6}'
		);
		expect(update).toMatchObject({ status: 'downloading', fraction: 0.5, speedBps: 12345.6 });
	});

	it('falls back to total_bytes_estimate', () => {
		const update = parseProgressLine(
			'{"status": "downloading", "downloaded_bytes": 250, "total_bytes_estimate": 1000}'
		);
		expect(update?.fraction).toBe(0.25);
	});

	it('caps fraction at 1 and handles finished frames', () => {
		expect(
			parseProgressLine('{"status": "downloading", "downloaded_bytes": 2000, "total_bytes": 1000}')
				?.fraction
		).toBe(1);
		expect(parseProgressLine('{"status": "finished"}')?.fraction).toBe(1);
	});

	it('ignores non-JSON and non-progress lines', () => {
		expect(parseProgressLine('[ExtractAudio] Destination: track.opus')).toBeNull();
		expect(parseProgressLine('{"status": "postprocessing"}')).toBeNull();
		expect(parseProgressLine('{broken json')).toBeNull();
		expect(parseProgressLine('')).toBeNull();
	});
});
