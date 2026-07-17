import { getArtist, getArtistAlbums } from '$lib/server/ytmusic/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const artist = await getArtist(params.id);
		// When YT Music paginates the discography, fetch the full album list too.
		const allAlbums = artist.albumsParams
			? await getArtistAlbums(artist.albumsParams.browseId, artist.albumsParams.params).catch(
					() => artist.albums
				)
			: artist.albums;
		return { artist, allAlbums };
	} catch (cause) {
		error(502, `Could not load artist: ${(cause as Error).message}`);
	}
};
