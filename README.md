# myoutarr

Search YouTube Music, queue downloads, and get a **correctly tagged, Jellyfin-ready music library** - with NFO sidecars, embedded covers, MusicBrainz-canonical metadata, and automatic library refreshes. Authentication is delegated to your Jellyfin server (the Jellyseerr model).

> **What it is not:** a music player or streaming frontend. The UI borrows the shape of a music app (search, artist, album pages, a bottom activity bar), but the bottom bar is the _download queue_. Playback happens in Jellyfin.

## Features

- **Search & browse** - artists (full discographies), albums with tracklists, playlists, and songs, backed by `ytmusicapi`.
- **Queue** - every request expands into per-track jobs with individual progress, retry with exponential backoff, pause/resume/cancel, and live updates over SSE. The queue survives restarts; jobs orphaned by a crash are requeued.
- **Proper metadata** - files are tagged with mutagen (title, artist, album, year, genre, track numbers, MBIDs, embedded cover). Albums get `album.nfo` + `folder.jpg`, artists get `artist.nfo`.
- **MusicBrainz enrichment** - canonical genre/year and MusicBrainz IDs so Jellyfin locks onto the right release (1 req/s, cached, degrades gracefully).
- **Jellyfin integration** - sign in with Jellyfin credentials (admin-only by default), pick your music library during setup, automatic debounced library scans, and **downloaded playlists are recreated as Jellyfin playlists** (including tracks that already existed in your library).
- **Uploads & tag editing** - add your own files and edit any file's tags from the UI; files are re-filed by the naming template and NFOs are rewritten.
- **Configurable** - audio format (Opus/M4A/MP3/FLAC), quality, concurrency, retries, rate limit, SponsorBlock (strips non-music intros/outros), naming template.

> **A note on FLAC:** YouTube serves lossy audio. Transcoding it to FLAC produces a much larger file with zero quality gain. The option exists, with this same warning in the settings UI.

## Quick start (docker compose)

```yaml
services:
  myoutarr:
    image: ghcr.io/liteapplication/myoutarr:latest
    ports: ['8687:8687']
    environment:
      PUID: '1000'
      PGID: '1000'
    volumes:
      - ./config:/config # database + scratch (keep on local disk)
      - /path/to/music:/music # the library Jellyfin reads
    restart: unless-stopped
```

Open `http://host:8687`, point the wizard at your Jellyfin server, sign in with an admin account, pick your music library - done.

## Docker Swarm + GlusterFS

`docker-stack.yml` in this repo is the reference deployment. The short version:

| Path      | Storage                                    | Why                                                                 |
| --------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `/music`  | GlusterFS (bind-mount the FUSE mountpoint) | Shared library, Jellyfin reads it too                               |
| `/config` | **Node-local disk**                        | SQLite + WAL is unsafe on network filesystems; scratch I/O is heavy |

1. Mount Gluster on the node **outside Docker** (fstab with `_netdev`), e.g. at `/mnt/gluster/music`.
2. Pin the service: `docker node update --label-add myoutarr=true <node>`.
3. `docker stack deploy -c docker-stack.yml myoutarr`.

Non-negotiables baked into the stack file:

- **`replicas: 1`** - the download queue has exactly one owner. Two replicas would race the job table and double-download.
- **`update_config.order: stop-first`** - start-first rolling updates would briefly run two queue owners.
- **Mount sentinel** - at setup, myoutarr writes `.myoutarr-mount-ok` into `/music`. If the Gluster mount ever drops, the bare bind-mount directory won't have it, and myoutarr **refuses to write** instead of silently pouring your library into a directory that vanishes when the mount returns.
- **`stop_grace_period: 60s`** - in-flight downloads abort cleanly and requeue.

### PUID/PGID (read this, it's the #1 setup failure)

Gluster stores raw numeric UIDs. `PUID`/`PGID` must resolve to the **same numeric ids on every Gluster node and in Jellyfin's container**, or Jellyfin cannot read what myoutarr writes.

## Configuration

| Env var                    | Default              | Purpose                                                            |
| -------------------------- | -------------------- | ------------------------------------------------------------------ |
| `PORT`                     | `8687`               | HTTP port                                                          |
| `PUID` / `PGID`            | `1000`               | Filesystem identity for written files                              |
| `CONFIG_DIR` / `MUSIC_DIR` | `/config` / `/music` | Data locations                                                     |
| `REQUIRE_ADMIN`            | `true`               | Only Jellyfin admins may sign in                                   |
| `YTDLP_AUTO_UPDATE`        | `false`              | Update yt-dlp at container start (YouTube breaks it periodically)  |
| `BODY_SIZE_LIMIT`          | `500M`               | Upload size cap                                                    |
| `POT_PROVIDER_BASE_URL`    | _(unset)_            | URL of a bgutil PO Token provider (see below); empty = disabled    |
| `YTDLP_JS_RUNTIMES`        | `node` (in image)    | JS runtime for yt-dlp's signature/n-challenge solver; empty = Deno |

Any env var can be supplied as a Docker secret: set `<NAME>_FILE=/run/secrets/<name>` - secret files are read before plain env vars.

### PO Tokens (fixes "Requested format is not available")

Downloading from YouTube now needs two things beyond plain yt-dlp, both wired up
by the bundled Docker image and Compose files:

1. **A GVS PO Token.** YouTube requires one for its `web`/`web_music` clients. The
   Compose files run a [bgutil PO Token provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
   as the `bgutil-provider` service; myoutarr points at it via `POT_PROVIDER_BASE_URL`
   and yt-dlp's bundled plugin fetches tokens automatically. Keep the provider image
   tag and the plugin version (pinned in the `Dockerfile`) on the same release.
2. **A JavaScript runtime.** yt-dlp solves YouTube's signature/"n" challenge with an
   external JS runtime ([EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS)). The image
   installs the solver scripts (`yt-dlp[default]`) and reuses its bundled Node via
   `YTDLP_JS_RUNTIMES=node`. Without this, formats are discarded and the download
   fails with `Requested format is not available` even when a PO Token is supplied.

By default the **yt-dlp player client** on the Settings page is left empty, so
yt-dlp picks its default (token-backed) web client. To run without the provider,
drop the `bgutil-provider` service, unset `POT_PROVIDER_BASE_URL`, and set a
tokenless client there (e.g. `tv,web_safari`) — note `tv` alone is currently often
served DRM-protected by YouTube.

Each user can upload their own YouTube `cookies.txt` (Netscape format) on the in-app **Cookies** page - stored per account under `/config/cookies/<userId>.txt` and passed to yt-dlp for that user's downloads, for age-restricted or premium content. The page links to browser-extension export instructions. A legacy shared `/config/cookies.txt` is still honoured as a fallback when a user has none.

## Development

```sh
npm install
python3 -m venv .venv && .venv/bin/pip install ytmusicapi mutagen yt-dlp
npm run dev        # app on :5173
npm run test:unit  # vitest - includes full-pipeline tests against a fake yt-dlp
npm run test:e2e   # playwright
```

Requires `ffmpeg` on PATH. The test suite never touches the network: yt-dlp is faked, Jellyfin and MusicBrainz are mocked, and a 2-second sine wave stands in for real audio.

## License

[GPL-3.0](LICENSE)
