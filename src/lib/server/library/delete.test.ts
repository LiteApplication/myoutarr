import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { deleteLibraryEntry } from './delete.ts';
import { ingestUpload } from './edit.ts';
import { createSentinel } from './publish.ts';

const PROJECT = path.resolve(import.meta.dirname, '../../../..');
const PYTHON = path.join(PROJECT, '.venv/bin/python');
const TAG_SCRIPT = path.join(PROJECT, 'python/tag.py');
const FIXTURE = path.join(tmpdir(), 'myoutarr-fixture.opus');

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
});

let root: string;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'myoutarr-delete-'));
	createSentinel(root);
	process.env.MUSIC_DIR = root;
	process.env.CONFIG_DIR = path.join(root, '.config');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seed(tags: { title: string; artist: string; album: string; trackNumber: number }) {
	const { newPath } = await ingestUpload('song.opus', readFileSync(FIXTURE), tags, {
		root,
		pythonBin: PYTHON,
		tagScript: TAG_SCRIPT
	});
	return newPath;
}

describe('deleteLibraryEntry', () => {
	it('deletes a lone track and prunes the empty album and artist tree', async () => {
		const rel = await seed({ title: 'Only Song', artist: 'Solo', album: 'Alone', trackNumber: 1 });
		const result = deleteLibraryEntry(rel, { root });
		expect(result.kind).toBe('track');
		expect(existsSync(path.join(root, rel))).toBe(false);
		// Album and artist directories are pruned since nothing musical remains.
		expect(existsSync(path.join(root, 'Solo'))).toBe(false);
	});

	it('deletes one track but keeps siblings and refreshes the album.nfo tracklist', async () => {
		await seed({ title: 'First', artist: 'Band', album: 'Record', trackNumber: 1 });
		const second = await seed({ title: 'Second', artist: 'Band', album: 'Record', trackNumber: 2 });

		deleteLibraryEntry(second, { root });

		const albumDir = path.join(root, 'Band/Record');
		expect(existsSync(albumDir)).toBe(true);
		expect(existsSync(path.join(albumDir, '01 - First.opus'))).toBe(true);
		expect(existsSync(path.join(albumDir, '02 - Second.opus'))).toBe(false);

		const nfo = readFileSync(path.join(albumDir, 'album.nfo'), 'utf8');
		expect(nfo).toContain('<title>First</title>');
		expect(nfo).not.toContain('<title>Second</title>');
		// Album-level metadata is preserved through the rebuild.
		expect(nfo).toContain('<title>Record</title>');
		expect(nfo).toContain('<albumartist>Band</albumartist>');
	});

	it('deletes an album directory but leaves other albums of the artist', async () => {
		await seed({ title: 'A', artist: 'Prolific', album: 'First Album', trackNumber: 1 });
		await seed({ title: 'B', artist: 'Prolific', album: 'Second Album', trackNumber: 1 });

		const result = deleteLibraryEntry('Prolific/First Album', { root });
		expect(result.kind).toBe('album');
		expect(existsSync(path.join(root, 'Prolific/First Album'))).toBe(false);
		expect(existsSync(path.join(root, 'Prolific/Second Album'))).toBe(true);
	});

	it('deletes an artist directory and everything under it', async () => {
		await seed({ title: 'A', artist: 'Gone', album: 'X', trackNumber: 1 });
		await seed({ title: 'B', artist: 'Gone', album: 'Y', trackNumber: 1 });

		const result = deleteLibraryEntry('Gone', { root });
		expect(result.kind).toBe('artist');
		expect(existsSync(path.join(root, 'Gone'))).toBe(false);
	});

	it('refuses to escape the library, delete the root, or delete a missing entry', () => {
		expect(() => deleteLibraryEntry('../outside', { root })).toThrow(/escapes/);
		expect(() => deleteLibraryEntry('', { root })).toThrow(/library root/);
		expect(() => deleteLibraryEntry('nope/gone.opus', { root })).toThrow(/not found/);
	});
});
