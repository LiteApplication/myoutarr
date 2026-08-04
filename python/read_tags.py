#!/usr/bin/env python3
"""Print a JSON dump of one audio file's tags. Usage: read_tags.py <file>"""

import json
import sys

from mutagen import File as MutagenFile
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4


def first(value):
    if isinstance(value, list) and value:
        return str(value[0])
    return str(value) if value else None


def joined(value):
    """Multi-valued artist tags come back as one editable ", "-joined string."""
    if isinstance(value, list):
        return ", ".join(str(v) for v in value if str(v)) or None
    return str(value) if value else None


def main():
    audio = MutagenFile(sys.argv[1])
    if audio is None:
        print(json.dumps({"error": "unsupported file"}))
        sys.exit(1)

    tags = {}
    if isinstance(audio, MP3):
        id3 = audio.tags or {}
        get = lambda k: str(id3[k].text[0]) if k in id3 and id3[k].text else None  # noqa: E731
        get_all = lambda k: joined(list(id3[k].text)) if k in id3 else None  # noqa: E731
        track = get("TRCK")
        tags = {
            "title": get("TIT2"),
            "artist": get_all("TPE1"),
            "albumartist": get_all("TPE2"),
            "album": get("TALB"),
            "date": get("TDRC"),
            "genre": get("TCON"),
            "tracknumber": track.split("/")[0] if track else None,
        }
    elif isinstance(audio, MP4):
        m = audio.tags or {}
        trkn = m.get("trkn")
        tags = {
            "title": first(m.get("\xa9nam")),
            "artist": joined(m.get("\xa9ART")),
            "albumartist": joined(m.get("aART")),
            "album": first(m.get("\xa9alb")),
            "date": first(m.get("\xa9day")),
            "genre": first(m.get("\xa9gen")),
            "tracknumber": str(trkn[0][0]) if trkn else None,
        }
    else:  # vorbis-comment family (opus, vorbis, flac)
        m = audio.tags or {}
        tags = {
            "title": first(m.get("title")),
            "artist": joined(m.get("artist")),
            "albumartist": joined(m.get("albumartist")),
            "album": first(m.get("album")),
            "date": first(m.get("date")),
            "genre": first(m.get("genre")),
            "tracknumber": first(m.get("tracknumber")),
        }

    tags["length_seconds"] = round(getattr(audio.info, "length", 0))
    print(json.dumps(tags))


if __name__ == "__main__":
    main()
