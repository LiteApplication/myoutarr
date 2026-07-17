#!/bin/sh
set -e

# LinuxServer-style PUID/PGID: the app must write files Jellyfin (and every
# GlusterFS node) can read, so the numeric ids must match across containers.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
	if ! getent group myoutarr > /dev/null 2>&1; then
		groupadd -o -g "$PGID" myoutarr
	fi
	if ! getent passwd myoutarr > /dev/null 2>&1; then
		useradd -o -u "$PUID" -g "$PGID" -d /config -s /bin/sh myoutarr
	fi

	mkdir -p /config/scratch
	chown -R "$PUID:$PGID" /config
	# /music is a shared volume — only ensure top-level access, never recurse
	# (a recursive chown over a large Gluster library would be brutal).
	chown "$PUID:$PGID" /music 2> /dev/null || true

	# Optional: refresh yt-dlp without a rebuild (YouTube breaks it regularly).
	if [ "${YTDLP_AUTO_UPDATE:-false}" = "true" ]; then
		echo "Updating yt-dlp..."
		/opt/venv/bin/pip install --no-cache-dir -U yt-dlp || echo "yt-dlp update failed; keeping bundled version"
	fi

	exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
