import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listLibrary, readTags, safeLibraryPath } from './browse.ts';
import { applyTags, ingestUpload } from './edit.ts';
import { createSentinel } from './publish.ts';

const PROJECT = path.resolve(import.meta.dirname, '../../../..');
const PYTHON = path.join(PROJECT, '.venv/bin/python');
const TAG_SCRIPT = path.join(PROJECT, 'python/tag.py');
const READ_SCRIPT = path.join(PROJECT, 'python/read_tags.py');
// Per-file fixture path: test files run in parallel workers, so a shared name
// would let one worker read the fixture while another is mid-ffmpeg-write.
const FIXTURE = path.join(tmpdir(), 'myoutarr-fixture-edit.opus');

beforeAll(() => {
	if (!existsSync(FIXTURE)) {
		execFileSync('ffmpeg', [
			'-y',
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=440:duration=2',
			'-c:a',
			'libopus',
			FIXTURE
		]);
	}
	process.env.YTM_PYTHON = PYTHON;
	process.env.TAG_SCRIPT = TAG_SCRIPT;
	process.env.READ_TAGS_SCRIPT = READ_SCRIPT;
});

let root: string;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'myoutarr-edit-'));
	createSentinel(root);
	process.env.MUSIC_DIR = root;
	// Settings read from a throwaway config db.
	process.env.CONFIG_DIR = path.join(root, '.config');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('safeLibraryPath', () => {
	it('rejects escapes', () => {
		expect(() => safeLibraryPath('../outside', root)).toThrow(/escapes/);
		expect(() => safeLibraryPath('a/../../b', root)).toThrow(/escapes/);
		expect(safeLibraryPath('a/b.opus', root)).toBe(path.join(root, 'a/b.opus'));
	});
});

describe('upload → edit round trip', () => {
	it('ingests an upload into the templated location with real tags', async () => {
		const data = readFileSync(FIXTURE);
		const result = await ingestUpload(
			'my song.opus',
			data,
			{ title: 'Home Recording', artist: 'Alexis', album: 'Demos', year: '2026', trackNumber: 1 },
			{ root, pythonBin: PYTHON, tagScript: TAG_SCRIPT }
		);
		expect(result.newPath).toBe('Alexis/Demos (2026)/01 - Home Recording.opus');
		expect(existsSync(path.join(root, result.newPath))).toBe(true);
		expect(existsSync(path.join(root, 'Alexis/Demos (2026)/album.nfo'))).toBe(true);

		const tags = await readTags(result.newPath, { root, pythonBin: PYTHON, script: READ_SCRIPT });
		expect(tags).toMatchObject({ title: 'Home Recording', artist: 'Alexis', album: 'Demos' });
	});

	it('rejects unsupported upload extensions', async () => {
		await expect(
			ingestUpload('evil.exe', Buffer.from('x'), { title: 'T', artist: 'A', album: 'B' }, { root })
		).rejects.toThrow(/unsupported audio format/);
	});

	it('re-files a track when its metadata changes and prunes the old directory', async () => {
		const data = readFileSync(FIXTURE);
		const first = await ingestUpload(
			'song.opus',
			data,
			{ title: 'Track', artist: 'Wrong Artist', album: 'Wrong Album', trackNumber: 1 },
			{ root, pythonBin: PYTHON, tagScript: TAG_SCRIPT }
		);
		const result = await applyTags(
			first.newPath,
			{
				title: 'Track',
				artist: 'Right Artist',
				album: 'Right Album',
				year: '2020',
				trackNumber: 1
			},
			{ root, pythonBin: PYTHON, tagScript: TAG_SCRIPT }
		);
		expect(result.newPath).toBe('Right Artist/Right Album (2020)/01 - Track.opus');
		expect(existsSync(path.join(root, result.newPath))).toBe(true);
		// Old tree is gone entirely.
		expect(existsSync(path.join(root, 'Wrong Artist'))).toBe(false);

		const tags = await readTags(result.newPath, { root, pythonBin: PYTHON, script: READ_SCRIPT });
		expect(tags.artist).toBe('Right Artist');
		expect(tags.date).toBe('2020');
	});

	it('lists the library tree and hides dotted internals', async () => {
		await ingestUpload(
			'song.opus',
			readFileSync(FIXTURE),
			{ title: 'T', artist: 'A', album: 'B' },
			{ root, pythonBin: PYTHON, tagScript: TAG_SCRIPT }
		);
		mkdirSync(path.join(root, '.myoutarr-staging/x'), { recursive: true });
		const top = listLibrary('', root);
		expect(top.map((e) => e.name)).toEqual(['A']);
		const album = listLibrary('A/B', root);
		expect(album.some((e) => e.name.endsWith('.opus'))).toBe(true);
	});
});
