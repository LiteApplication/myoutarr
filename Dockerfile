# ---------- build stage ----------
FROM node:26-alpine AS build
WORKDIR /app

# better-sqlite3 needs its native build (blocked by --ignore-scripts below)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
	npm ci --ignore-scripts \
	&& npm rebuild better-sqlite3

COPY . .
RUN npx svelte-kit sync && npm run build && npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:26-alpine

# Git tag this image was built from (e.g. v1.2.3), shown in the web UI. Set via
# --build-arg from release.yml; empty for local/dev builds.
ARG APP_VERSION=

# Layers below are ordered slow/stable -> fast/churny and split so a bump to one
# dependency doesn't invalidate the others. pip cache mounts survive across local
# rebuilds; gha layer caching reuses each unchanged layer across CI runs.

# ffmpeg for extraction/embedding; dumb-init for signal forwarding and zombie
# reaping (we spawn yt-dlp/ffmpeg/python children); su-exec for PUID/PGID drop.
RUN apk add --no-cache ffmpeg python3 py3-pip dumb-init su-exec shadow

RUN python3 -m venv /opt/venv

# yt-dlp[default] pulls the yt-dlp-ejs challenge-solver scripts; YouTube's
# signature/"n" challenge is solved by the Node runtime this image already ships
# (see YTDLP_JS_RUNTIMES below). Without both, yt-dlp discards every real format
# and fails with "Requested format is not available".
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
	/opt/venv/bin/pip install 'yt-dlp[default]' ytmusicapi mutagen

# bgutil PO Token provider plugin: yt-dlp auto-uses it to fetch GVS PO Tokens
# from the bgutil-provider server (see docker-compose.yml), so the web/web_music
# clients can serve audio. Keep this version in lockstep with the
# brainicism/bgutil-ytdlp-pot-provider image tag in the compose files.
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
	/opt/venv/bin/pip install 'bgutil-ytdlp-pot-provider==1.3.1'

WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY python ./python
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
	APP_VERSION=${APP_VERSION} \
	PORT=8687 \
	CONFIG_DIR=/config \
	MUSIC_DIR=/music \
	YTM_PYTHON=/opt/venv/bin/python \
	YTM_WORKER=/app/python/ytm_worker.py \
	TAG_SCRIPT=/app/python/tag.py \
	READ_TAGS_SCRIPT=/app/python/read_tags.py \
	YTDLP_BIN=/opt/venv/bin/yt-dlp \
	# Use the image's Node for yt-dlp's JS challenge solver (yt-dlp defaults to
	# Deno, which the Alpine image doesn't ship). Node 26 here satisfies EJS's
	# Node >= 22 requirement.
	YTDLP_JS_RUNTIMES=node \
	# uploads: SvelteKit's default body limit is 512KB - far too small for audio
	BODY_SIZE_LIMIT=524288000

EXPOSE 8687
VOLUME ["/config", "/music"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:8687/api/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build"]
