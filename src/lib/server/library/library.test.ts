import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobMeta } from '../queue/store.ts';
import { renderTemplate, resolveLibraryPath, sanitizeSegment } from './naming.ts';
import { albumNfo, artistNfo } from './nfo.ts';
import { assertMounted, createSentinel, MountMissingError, publishFile } from './publish.ts';

describe('sanitizeSegment', () => {
	it('replaces reserved characters', () => {
		expect(sanitizeSegment('AC/DC: Back <in> Black?')).toBe('AC_DC_ Back _in_ Black_');
	});

	it('neutralises traversal and hidden-file prefixes', () => {
		expect(sanitizeSegment('..')).not.toMatch(/^\./);
		expect(sanitizeSegment('.hidden')).not.toMatch(/^\./);
	});

	it('escapes Windows reserved device names', () => {
		expect(sanitizeSegment('CON')).toBe('_CON');
		expect(sanitizeSegment('com1')).toBe('_com1');
	});

	it('strips trailing dots and spaces', () => {
		expect(sanitizeSegment('Album...')).toBe('Album');
		expect(sanitizeSegment('Album   ')).toBe('Album');
	});

	it('caps byte length for long unicode names', () => {
		const long = '🎵'.repeat(200);
		expect(Buffer.byteLength(sanitizeSegment(long), 'utf8')).toBeLessThanOrEqual(200);
	});

	it('never returns an empty segment', () => {
		expect(sanitizeSegment('')).toBe('_');
		expect(sanitizeSegment('...')).not.toBe('');
	});
});

describe('renderTemplate', () => {
	const meta: JobMeta = {
		title: 'One More Time',
		artist: 'Daft Punk',
		album: 'Discovery',
		albumArtist: 'Daft Punk',
		year: '2001',
		trackNumber: 1
	};

	it('renders the default template', () => {
		expect(renderTemplate('{albumartist}/{album} ({year})/{track:02} - {title}', meta)).toBe(
			'Daft Punk/Discovery (2001)/01 - One More Time'
		);
	});

	it('drops empty parens when year is missing', () => {
		const noYear = { ...meta, year: undefined };
		expect(renderTemplate('{albumartist}/{album} ({year})/{track:02} - {title}', noYear)).toBe(
			'Daft Punk/Discovery/01 - One More Time'
		);
	});

	it('sanitises hostile metadata inside the template', () => {
		const hostile = { ...meta, albumArtist: '../..', album: 'x/../../etc' };
		const rendered = renderTemplate('{albumartist}/{album}/{title}', hostile);
		expect(rendered).not.toContain('..');
	});
});

describe('resolveLibraryPath', () => {
	it('accepts paths inside the root', () => {
		expect(resolveLibraryPath('/music', 'A/B/01 - T', 'opus')).toBe('/music/A/B/01 - T.opus');
	});

	it('rejects escapes even if sanitisation were bypassed', () => {
		expect(() => resolveLibraryPath('/music', '../evil', 'opus')).toThrow(/escapes library root/);
		expect(() => resolveLibraryPath('/music', 'A/../../evil', 'opus')).toThrow(
			/escapes library root/
		);
	});
});

describe('nfo generation', () => {
	it('escapes XML-hostile band names', () => {
		const xml = albumNfo({
			title: 'Mezzanine <Deluxe> & "Remastered"',
			albumArtist: "Simon & Garfunkel's",
			year: '1998',
			tracks: [{ position: 1, title: 'Angel <live>' }]
		});
		expect(xml).toContain('Mezzanine &lt;Deluxe&gt; &amp; &quot;Remastered&quot;');
		expect(xml).toContain('Simon &amp; Garfunkel&apos;s');
		expect(xml).toContain('<title>Angel &lt;live&gt;</title>');
		expect(xml).not.toMatch(/<Deluxe>/);
	});

	it('emits MBIDs and genres when present', () => {
		const xml = albumNfo({
			title: 'T',
			albumArtist: 'A',
			genres: ['Electronic', 'House'],
			mbAlbumId: 'mbid-album',
			mbReleaseGroupId: 'mbid-rg',
			tracks: []
		});
		expect(xml).toContain('<musicbrainzalbumid>mbid-album</musicbrainzalbumid>');
		expect(xml).toContain('<genre>Electronic</genre>');
		expect(xml).toContain('<genre>House</genre>');
	});

	it('artist nfo defaults sortname to name', () => {
		const xml = artistNfo({ name: 'Daft Punk' });
		expect(xml).toContain('<sortname>Daft Punk</sortname>');
	});
});

describe('publish', () => {
	let dir: string;
	let library: string;
	let staging: string;
	let scratch: string;

	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-publish-'));
		library = path.join(dir, 'music');
		staging = path.join(library, '.staging');
		scratch = path.join(dir, 'scratch');
		mkdirSync(library, { recursive: true });
		mkdirSync(scratch, { recursive: true });
	});

	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('refuses to write without the mount sentinel', () => {
		writeFileSync(path.join(scratch, 'a.opus'), 'audio');
		expect(() =>
			publishFile({
				sourcePath: path.join(scratch, 'a.opus'),
				targetPath: path.join(library, 'A/B/01.opus'),
				jobId: 'j1',
				libraryRoot: library,
				staging
			})
		).toThrow(MountMissingError);
		expect(existsSync(path.join(library, 'A'))).toBe(false);
	});

	it('publishes atomically once the sentinel exists and cleans staging', () => {
		createSentinel(library);
		writeFileSync(path.join(scratch, 'a.opus'), 'audio-bytes');
		const target = path.join(library, 'A/B/01.opus');
		publishFile({
			sourcePath: path.join(scratch, 'a.opus'),
			targetPath: target,
			jobId: 'j1',
			libraryRoot: library,
			staging
		});
		expect(existsSync(target)).toBe(true);
		expect(existsSync(path.join(staging, 'j1'))).toBe(false);
		expect(() => assertMounted(library)).not.toThrow();
	});
});
