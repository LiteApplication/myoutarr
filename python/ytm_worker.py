#!/usr/bin/env python3
"""Long-lived ytmusicapi worker.

Speaks newline-delimited JSON-RPC over stdin/stdout:
    -> {"id": 1, "method": "search", "params": {"query": "...", "filter": "songs"}}
    <- {"id": 1, "result": [...]}
    <- {"id": 2, "error": {"message": "..."}}

One process serves all requests; a small thread pool keeps concurrent
searches from serialising. stdout is reserved for protocol frames —
anything else (logs, tracebacks) goes to stderr.
"""

import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from ytmusicapi import YTMusic

_stdout_lock = threading.Lock()
_ytm = None
_ytm_lock = threading.Lock()


def ytm() -> YTMusic:
    """Lazy singleton so a network hiccup at boot doesn't kill the worker."""
    global _ytm
    with _ytm_lock:
        if _ytm is None:
            _ytm = YTMusic()
        return _ytm


def _search(params):
    return ytm().search(
        params["query"],
        filter=params.get("filter"),
        limit=int(params.get("limit", 20)),
    )


def _get_artist(params):
    return ytm().get_artist(params["id"])


def _get_artist_albums(params):
    return ytm().get_artist_albums(
        params["id"], params["params"], limit=params.get("limit")
    )


def _get_album(params):
    return ytm().get_album(params["id"])


def _get_playlist(params):
    return ytm().get_playlist(params["id"], limit=params.get("limit"))


def _get_song(params):
    return ytm().get_song(params["id"])


def _ping(_params):
    return "pong"


METHODS = {
    "search": _search,
    "get_artist": _get_artist,
    "get_artist_albums": _get_artist_albums,
    "get_album": _get_album,
    "get_playlist": _get_playlist,
    "get_song": _get_song,
    "ping": _ping,
}


def _reply(payload) -> None:
    line = json.dumps(payload, ensure_ascii=False, default=str)
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def _handle(request) -> None:
    request_id = request.get("id")
    method = request.get("method")
    handler = METHODS.get(method)
    if handler is None:
        _reply({"id": request_id, "error": {"message": f"unknown method: {method}"}})
        return
    try:
        result = handler(request.get("params") or {})
        _reply({"id": request_id, "result": result})
    except Exception as exc:  # deliberately broad: any failure must produce a reply
        _reply({"id": request_id, "error": {"message": f"{type(exc).__name__}: {exc}"}})


def main() -> None:
    pool = ThreadPoolExecutor(max_workers=4)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _reply({"id": None, "error": {"message": f"bad frame: {exc}"}})
            continue
        pool.submit(_handle, request)
    pool.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    main()
