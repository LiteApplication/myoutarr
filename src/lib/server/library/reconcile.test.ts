import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeName } from './existing.ts';
import { LIDARR_TEMPLATE } from './naming.ts';
import { isUpgrade } from './quality.ts';
import { applyPlan, planReconcile } from './reconcile.ts';

const PROJECT = path.resolve(import.meta.dirname, '../../../..');
const PYTHON = path.join(PROJECT, '.venv/bin/python');
const PROBE = { pythonBin: PYTHON, script: path.join(PROJECT, 'python/probe_tracks.py') };

describe('isUpgrade', () => {
	const opus = { codec: 'opus', lossless: false, bitrateKbps: 128 };
	const flac16 = { codec: 'flac', lossless: true, bitrateKbps: 900, bitDepth: 16 };
	const flac24 = { codec: 'flac', lossless: true, bitrateKbps: 3000, bitDepth: 24 };

	it('never replaces lossless with lossy, nor equal with equal', () => {
		expect(isUpgrade(opus, flac16)).toBe(false);
		expect(isUpgrade(opus, opus)).toBe(false);
		expect(isUpgrade(flac16, flac16)).toBe(false);
	});

	it('upgrades lossy to lossless and 16-bit to 24-bit', () => {
		expect(isUpgrade(flac16, opus)).toBe(true);
		expect(isUpgrade(flac24, flac16)).toBe(true);
	});

	it('needs a real margin between lossy copies', () => {
		expect(isUpgrade(opus, { ...opus, bitrateKbps: 120 })).toBe(false);
		expect(isUpgrade(opus, { codec: 'mp3', lossless: false, bitrateKbps: 64 })).toBe(true);
	});
});

describe('normalizeName', () => {
	it('folds case, quotes, accents and sanitised punctuation', () => {
		expect(normalizeName('when the party’s over')).toBe(normalizeName("When the party's over"));
		expect(normalizeName('The Hunger Games_ Catching Fire')).toBe(
			normalizeName('The Hunger Games: Catching Fire')
		);
		expect(normalizeName('Beyoncé')).toBe(normalizeName('Beyonce'));
	});
});

describe('planReconcile', () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'myoutarr-reconcile-'));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function audio(rel: string, codec: string[], title: string, track: number) {
		const file = path.join(root, rel);
		mkdirSync(path.dirname(file), { recursive: true });
		execFileSync('ffmpeg', [
			'-y',
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=440:duration=1',
			...codec,
			'-metadata',
			`title=${title}`,
			'-metadata',
			'artist=Faouzia',
			'-metadata',
			'album_artist=Faouzia',
			'-metadata',
			'album=FILM NOIR',
			'-metadata',
			`track=${track}`,
			file
		]);
		return file;
	}

	it('collapses an opus/flac pair onto the flac and renames to the Lidarr layout', async () => {
		const opus = audio('Faouzia/FILM NOIR (2025)/01 - PEACE.opus', ['-c:a', 'libopus'], 'PEACE', 1);
		const flac = audio(
			'Faouzia/FILM NOIR (2025)/Faouzia - FILM NOIR - 01 - PEACE.flac',
			['-c:a', 'flac'],
			'PEACE',
			1
		);
		const lone = audio(
			'Faouzia/FILM NOIR (2025)/02 - ORNAMENT.opus',
			['-c:a', 'libopus'],
			'ORNAMENT',
			2
		);

		const plan = await planReconcile(root, LIDARR_TEMPLATE, PROBE);
		expect(plan.removals).toEqual([{ path: opus, keeper: flac }]);
		expect(plan.moves).toEqual([
			{ from: lone, to: path.join(path.dirname(lone), 'Faouzia - FILM NOIR - 02 - ORNAMENT.opus') }
		]);

		// A dry run changes nothing; applying does.
		expect(existsSync(opus)).toBe(true);
		applyPlan(plan);
		expect(existsSync(opus)).toBe(false);
		expect(existsSync(plan.moves[0].to)).toBe(true);
	}, 30_000);

	it('reports folders that differ only by case instead of merging them', async () => {
		audio('Faouzia/Porcelain (2025)/01 - A.opus', ['-c:a', 'libopus'], 'A', 1);
		audio('Faouzia/PORCELAIN (2025)/01 - B.opus', ['-c:a', 'libopus'], 'B', 1);
		const plan = await planReconcile(root, LIDARR_TEMPLATE, PROBE);
		expect(plan.splitFolders).toHaveLength(1);
	}, 30_000);
});
