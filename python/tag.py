#!/usr/bin/env python3
"""Tag one audio file with mutagen.

Usage: tag.py <audio-file> <json-metadata-file>

Metadata keys (all optional except title/artist/album):
  title, artist, album, albumartist, date, genre, tracknumber, totaltracks,
  discnumber, mb_artist_id, mb_album_id, mb_releasegroup_id, cover (path to image)

Exits non-zero with a message on stderr on failure.
"""

import json
import sys

from mutagen import File as MutagenFile
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, TALB, TCON, TDRC, TIT2, TPE1, TPE2, TPOS, TRCK, TXXX
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis


def read_cover(path):
    with open(path, "rb") as fh:
        data = fh.read()
    mime = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
    return data, mime


def tag_vorbis_like(audio, meta):
    """Opus / Vorbis / FLAC share Vorbis-comment field names."""
    mapping = {
        "title": "title",
        "artist": "artist",
        "album": "album",
        "albumartist": "albumartist",
        "date": "date",
        "genre": "genre",
        "mb_artist_id": "musicbrainz_artistid",
        "mb_album_id": "musicbrainz_albumid",
        "mb_releasegroup_id": "musicbrainz_releasegroupid",
    }
    for src, dst in mapping.items():
        if meta.get(src):
            audio[dst] = str(meta[src])
    if meta.get("tracknumber"):
        audio["tracknumber"] = str(meta["tracknumber"])
        if meta.get("totaltracks"):
            audio["tracktotal"] = str(meta["totaltracks"])
    if meta.get("discnumber"):
        audio["discnumber"] = str(meta["discnumber"])


def embed_cover_vorbis(audio, data, mime):
    import base64

    pic = Picture()
    pic.type = 3  # front cover
    pic.mime = mime
    pic.data = data
    if isinstance(audio, FLAC):
        audio.clear_pictures()
        audio.add_picture(pic)
    else:
        audio["metadata_block_picture"] = [
            base64.b64encode(pic.write()).decode("ascii")
        ]


def tag_mp3(path, meta):
    audio = MP3(path)
    if audio.tags is None:
        audio.add_tags()
    tags: ID3 = audio.tags
    if meta.get("title"):
        tags.setall("TIT2", [TIT2(encoding=3, text=meta["title"])])
    if meta.get("artist"):
        tags.setall("TPE1", [TPE1(encoding=3, text=meta["artist"])])
    if meta.get("albumartist"):
        tags.setall("TPE2", [TPE2(encoding=3, text=meta["albumartist"])])
    if meta.get("album"):
        tags.setall("TALB", [TALB(encoding=3, text=meta["album"])])
    if meta.get("date"):
        tags.setall("TDRC", [TDRC(encoding=3, text=str(meta["date"]))])
    if meta.get("genre"):
        tags.setall("TCON", [TCON(encoding=3, text=meta["genre"])])
    if meta.get("tracknumber"):
        text = str(meta["tracknumber"])
        if meta.get("totaltracks"):
            text += f"/{meta['totaltracks']}"
        tags.setall("TRCK", [TRCK(encoding=3, text=text)])
    if meta.get("discnumber"):
        tags.setall("TPOS", [TPOS(encoding=3, text=str(meta["discnumber"]))])
    for key, desc in [
        ("mb_artist_id", "MusicBrainz Artist Id"),
        ("mb_album_id", "MusicBrainz Album Id"),
        ("mb_releasegroup_id", "MusicBrainz Release Group Id"),
    ]:
        if meta.get(key):
            tags.setall(
                f"TXXX:{desc}", [TXXX(encoding=3, desc=desc, text=str(meta[key]))]
            )
    if meta.get("cover"):
        data, mime = read_cover(meta["cover"])
        tags.setall("APIC", [APIC(encoding=3, mime=mime, type=3, desc="Cover", data=data)])
    audio.save()


def tag_mp4(path, meta):
    audio = MP4(path)
    text = {
        "title": "\xa9nam",
        "artist": "\xa9ART",
        "album": "\xa9alb",
        "albumartist": "aART",
        "date": "\xa9day",
        "genre": "\xa9gen",
    }
    for src, dst in text.items():
        if meta.get(src):
            audio[dst] = [str(meta[src])]
    if meta.get("tracknumber"):
        audio["trkn"] = [(int(meta["tracknumber"]), int(meta.get("totaltracks") or 0))]
    if meta.get("discnumber"):
        audio["disk"] = [(int(meta["discnumber"]), 0)]
    for key, name in [
        ("mb_artist_id", "MusicBrainz Artist Id"),
        ("mb_album_id", "MusicBrainz Album Id"),
        ("mb_releasegroup_id", "MusicBrainz Release Group Id"),
    ]:
        if meta.get(key):
            audio[f"----:com.apple.iTunes:{name}"] = [str(meta[key]).encode()]
    if meta.get("cover"):
        data, mime = read_cover(meta["cover"])
        fmt = MP4Cover.FORMAT_PNG if mime == "image/png" else MP4Cover.FORMAT_JPEG
        audio["covr"] = [MP4Cover(data, imageformat=fmt)]
    audio.save()


def main():
    if len(sys.argv) != 3:
        print("usage: tag.py <audio-file> <metadata.json>", file=sys.stderr)
        sys.exit(2)
    audio_path, meta_path = sys.argv[1], sys.argv[2]
    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)

    detected = MutagenFile(audio_path)
    if detected is None:
        print(f"unsupported or corrupt audio file: {audio_path}", file=sys.stderr)
        sys.exit(1)

    if isinstance(detected, (OggOpus, OggVorbis, FLAC)):
        tag_vorbis_like(detected, meta)
        if meta.get("cover"):
            embed_cover_vorbis(detected, *read_cover(meta["cover"]))
        detected.save()
    elif isinstance(detected, MP3):
        tag_mp3(audio_path, meta)
    elif isinstance(detected, MP4):
        tag_mp4(audio_path, meta)
    else:
        print(f"unhandled container: {type(detected).__name__}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
