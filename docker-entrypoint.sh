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

	# Scratch is ephemeral tmpfs (SCRATCH_DIR), not under /config - nothing to create here.
	#
	# Best-effort chown: on NFS with root_squash the container's root is mapped to
	# an unprivileged user and cannot chown files it doesn't own. That's fine as
	# long as the app user can already write /config (ownership usually already
	# matches PUID). So don't let chown failure abort the entrypoint - probe for
	# actual write access below and only bail if that fails.
	if ! chown -R "$PUID:$PGID" /config 2> /dev/null; then
		echo "note: could not chown /config (expected on root_squash NFS); verifying write access instead"
	fi
	# /music is a shared volume - only ensure top-level access, never recurse
	# (a recursive chown over a large Gluster library would be brutal).
	chown "$PUID:$PGID" /music 2> /dev/null || true

	# The chown may be a no-op or may have failed; what actually matters is that
	# the app user can write /config. Probe by writing a real file (access() can
	# lie over NFS, and a read-only export would pass a bare permission check).
	probe="/config/.write-probe.$$"
	if ! su-exec "$PUID:$PGID" sh -c "touch '$probe' && rm -f '$probe'" 2> /dev/null; then
		echo "FATAL: /config is not writable by ${PUID}:${PGID}." >&2
		echo "  Fix directory ownership/permissions, or map the NFS export to that uid" >&2
		echo "  (e.g. anonuid=${PUID},anongid=${PGID}, or no_root_squash)." >&2
		exit 1
	fi

	# Optional: refresh yt-dlp without a rebuild (YouTube breaks it regularly).
	if [ "${YTDLP_AUTO_UPDATE:-false}" = "true" ]; then
		echo "Updating yt-dlp..."
		/opt/venv/bin/pip install --no-cache-dir -U 'yt-dlp[default]' || echo "yt-dlp update failed; keeping bundled version"
	fi

	exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
