import { describe, expect, it } from 'vitest';
import { parseYtUrl } from './parseUrl.ts';

describe('parseYtUrl', () => {
	it('classifies album, artist and playlist browse urls', () => {
		expect(parseYtUrl('https://music.youtube.com/browse/MPREb_4U7yfKKFZLv')).toEqual({
			kind: 'album',
			id: 'MPREb_4U7yfKKFZLv'
		});
		expect(parseYtUrl('https://music.youtube.com/channel/UCk91oFc2hY2CdHirU93baLg')).toEqual({
			kind: 'artist',
			id: 'UCk91oFc2hY2CdHirU93baLg'
		});
		expect(parseYtUrl('https://music.youtube.com/browse/UCk91oFc2hY2CdHirU93baLg')).toEqual({
			kind: 'artist',
			id: 'UCk91oFc2hY2CdHirU93baLg'
		});
	});

	it('reads playlist ids from ?list=, including unlisted ones', () => {
		expect(parseYtUrl('https://music.youtube.com/playlist?list=PLunlisted123')).toEqual({
			kind: 'playlist',
			id: 'PLunlisted123'
		});
		expect(parseYtUrl('https://music.youtube.com/playlist?list=OLAK5uy_albumAudio')).toEqual({
			kind: 'playlist',
			id: 'OLAK5uy_albumAudio'
		});
	});

	it('treats watch links as songs, even with a &list= context', () => {
		expect(parseYtUrl('https://music.youtube.com/watch?v=J7p4bzqLvCw')).toEqual({
			kind: 'song',
			videoId: 'J7p4bzqLvCw'
		});
		expect(parseYtUrl('https://www.youtube.com/watch?v=J7p4bzqLvCw&list=RD123')).toEqual({
			kind: 'song',
			videoId: 'J7p4bzqLvCw'
		});
		expect(parseYtUrl('https://youtu.be/J7p4bzqLvCw')).toEqual({
			kind: 'song',
			videoId: 'J7p4bzqLvCw'
		});
	});

	it('ignores non-youtube urls and plain text', () => {
		expect(parseYtUrl('blinding lights')).toBeNull();
		expect(parseYtUrl('https://example.com/watch?v=abc')).toBeNull();
		expect(parseYtUrl('https://evil.com/browse/MPREb_x')).toBeNull();
		expect(parseYtUrl('not a url')).toBeNull();
	});

	it('rejects ids with illegal characters', () => {
		expect(parseYtUrl('https://music.youtube.com/browse/MPRE%20b')).toBeNull();
		expect(parseYtUrl('https://music.youtube.com/playlist?list=a b')).toBeNull();
	});
});
