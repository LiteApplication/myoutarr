import { describe, expect, it } from 'vitest';
import { splitArtists } from './artists.ts';

describe('splitArtists', () => {
	it('splits a credit on commas and ampersands', () => {
		expect(splitArtists('Jay-Z, Kanye West & Frank Ocean')).toEqual([
			'Jay-Z',
			'Kanye West',
			'Frank Ocean'
		]);
	});

	it('trims, drops empties, and de-duplicates case-insensitively', () => {
		expect(splitArtists('  A ,, b  & A ')).toEqual(['A', 'b']);
	});

	it('leaves a single credit and blanks alone', () => {
		expect(splitArtists('AC/DC')).toEqual(['AC/DC']);
		expect(splitArtists('')).toEqual([]);
		expect(splitArtists(undefined)).toEqual([]);
	});

	it('is only a candidate split - one-act names come apart too', () => {
		// Which is why nothing tags from this directly: callers check the parts
		// against MusicBrainz first (see `musicbrainz/client.ts`).
		expect(splitArtists('Earth, Wind & Fire')).toEqual(['Earth', 'Wind', 'Fire']);
	});
});
