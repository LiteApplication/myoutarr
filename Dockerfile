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

# ffmpeg for extraction/embedding; dumb-init for signal forwarding and zombie
# reaping (we spawn yt-dlp/ffmpeg/python children); su-exec for PUID/PGID drop.
RUN apk add --no-cache ffmpeg python3 py3-pip dumb-init su-exec shadow \
	&& python3 -m venv /opt/venv \
	&& /opt/venv/bin/pip install --no-cache-dir yt-dlp ytmusicapi mutagen

WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY python ./python
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
	PORT=8687 \
	CONFIG_DIR=/config \
	MUSIC_DIR=/music \
	YTM_PYTHON=/opt/venv/bin/python \
	YTM_WORKER=/app/python/ytm_worker.py \
	TAG_SCRIPT=/app/python/tag.py \
	READ_TAGS_SCRIPT=/app/python/read_tags.py \
	YTDLP_BIN=/opt/venv/bin/yt-dlp \
	# uploads: SvelteKit's default body limit is 512KB — far too small for audio
	BODY_SIZE_LIMIT=524288000

EXPOSE 8687
VOLUME ["/config", "/music"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:8687/api/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build"]
