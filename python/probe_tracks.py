#!/usr/bin/env python3
"""Print a JSON array describing each audio file: identity tags + stream quality.

Usage: probe_tracks.py <file> [<file> ...]

Unreadable files are reported as {"path": ..., "error": ...} so one bad file
never hides the rest. Used to match library files against incoming downloads
(upgrade decisions) and by the reconcile script.
"""

import json
import os
import sys

from mutagen import File as MutagenFile
from mutagen.flac import FLAC
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis


def first(value):
    if isinstance(value, list):
        value = value[0] if value else None
    return str(value) if value not in (None, "") else None


def joined(value):
    if isinstance(value, list):
        return ", ".join(str(v) for v in value if str(v)) or None
    return str(value) if value else None


def number(value):
    """'3', '3/12' and 3 all mean track 3."""
    text = first(value)
    if not text:
        return None
    head = text.split("/")[0].strip()
    return int(head) if head.isdigit() else None


def total(value):
    """The "2" of a "1/2" disc number."""
    text = first(value)
    if text and "/" in text:
        tail = text.split("/")[1].strip()
        return int(tail) if tail.isdigit() else None
    return None


def tags_of(audio):
    if isinstance(audio, MP3):
        id3 = audio.tags or {}

        def text(key):
            return list(id3[key].text) if key in id3 and id3[key].text else None

        def txxx(desc):
            frame = id3.get(f"TXXX:{desc}")
            return list(frame.text) if frame and frame.text else None

        return {
            "title": first(text("TIT2")),
            "artist": joined(text("TPE1")),
            "albumartist": joined(text("TPE2")),
            "album": first(text("TALB")),
            "tracknumber": number(text("TRCK")),
            "discnumber": number(text("TPOS")),
            "totaldiscs": total(text("TPOS")),
            "mb_trackid": first(txxx("MusicBrainz Release Track Id")),
        }
    if isinstance(audio, MP4):
        m = audio.tags or {}
        trkn, disk = m.get("trkn"), m.get("disk")
        release_track = m.get("----:com.apple.iTunes:MusicBrainz Release Track Id")
        return {
            "title": first(m.get("\xa9nam")),
            "artist": joined(m.get("\xa9ART")),
            "albumartist": joined(m.get("aART")),
            "album": first(m.get("\xa9alb")),
            "tracknumber": trkn[0][0] if trkn else None,
            "discnumber": disk[0][0] if disk else None,
            "totaldiscs": (disk[0][1] or None) if disk else None,
            "mb_trackid": release_track[0].decode() if release_track else None,
        }
    m = audio.tags or {}  # vorbis-comment family
    return {
        "title": first(m.get("title")),
        "artist": joined(m.get("artist")),
        "albumartist": joined(m.get("albumartist")) or joined(m.get("album_artist")),
        "album": first(m.get("album")),
        "tracknumber": number(m.get("tracknumber")),
        "discnumber": number(m.get("discnumber")) or number(m.get("disc")),
        "totaldiscs": number(m.get("totaldiscs")) or number(m.get("disctotal")),
        "mb_trackid": first(m.get("musicbrainz_releasetrackid")),
    }


def quality_of(audio, path):
    info = audio.info
    length = getattr(info, "length", 0) or 0
    bitrate = getattr(info, "bitrate", 0) or 0
    if not bitrate and length:
        # Opus reports no bitrate; derive the average from size and duration.
        bitrate = os.path.getsize(path) * 8 / length
    kbps = round(bitrate / 1000)
    if isinstance(audio, FLAC):
        return {"codec": "flac", "lossless": True, "bitrate_kbps": kbps,
                "bit_depth": getattr(info, "bits_per_sample", None)}
    if isinstance(audio, OggOpus):
        return {"codec": "opus", "lossless": False, "bitrate_kbps": kbps}
    if isinstance(audio, OggVorbis):
        return {"codec": "vorbis", "lossless": False, "bitrate_kbps": kbps}
    if isinstance(audio, MP3):
        return {"codec": "mp3", "lossless": False, "bitrate_kbps": kbps}
    if isinstance(audio, MP4):
        if getattr(info, "codec", "") == "alac":
            return {"codec": "alac", "lossless": True, "bitrate_kbps": kbps,
                    "bit_depth": getattr(info, "bits_per_sample", None)}
        return {"codec": "aac", "lossless": False, "bitrate_kbps": kbps}
    return {"codec": type(audio).__name__.lower(), "lossless": False, "bitrate_kbps": kbps}


def probe(path):
    try:
        audio = MutagenFile(path)
        if audio is None:
            return {"path": path, "error": "unsupported file"}
        return {"path": path, **tags_of(audio), "length_seconds": round(getattr(audio.info, "length", 0) or 0),
                "quality": quality_of(audio, path)}
    except Exception as error:  # noqa: BLE001 - report, never abort the batch
        return {"path": path, "error": str(error)}


if __name__ == "__main__":
    print(json.dumps([probe(p) for p in sys.argv[1:]]))
