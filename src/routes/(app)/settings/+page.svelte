<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
	let settings = $derived(form?.settings ?? data.settings);
</script>

<svelte:head>
	<title>Settings - myoutarr</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="text-3xl font-bold">Settings</h1>

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				submitting = false;
				await update({ reset: false });
			};
		}}
		class="mt-6 space-y-8"
	>
		<section class="rounded-2xl bg-surface p-6">
			<h2 class="mb-4 text-lg font-semibold">Audio</h2>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="mb-1 block text-sm text-ink-muted">Format</span>
					<select
						name="audioFormat"
						value={settings.audioFormat}
						class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
					>
						<option value="opus">Opus (recommended)</option>
						<option value="m4a">M4A / AAC</option>
						<option value="mp3">MP3</option>
						<option value="flac">FLAC</option>
					</select>
				</label>
				<label class="block">
					<span class="mb-1 block text-sm text-ink-muted">Quality (0 best – 10 worst)</span>
					<input
						name="audioQuality"
						type="number"
						min="0"
						max="10"
						value={settings.audioQuality}
						class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
					/>
				</label>
			</div>
			<p class="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
				Honesty note: YouTube serves lossy audio (Opus/AAC). Choosing FLAC re-encodes that lossy
				source into a much larger file with zero quality gain - it will not make a lossless library.
			</p>
		</section>

		<section class="rounded-2xl bg-surface p-6">
			<h2 class="mb-4 text-lg font-semibold">Downloads</h2>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="mb-1 block text-sm text-ink-muted">Parallel downloads (1–8)</span>
					<input
						name="concurrency"
						type="number"
						min="1"
						max="8"
						value={settings.concurrency}
						class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
					/>
				</label>
				<label class="block">
					<span class="mb-1 block text-sm text-ink-muted">Retries per track</span>
					<input
						name="maxRetries"
						type="number"
						min="0"
						max="10"
						value={settings.maxRetries}
						class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
					/>
				</label>
				<label class="block sm:col-span-2">
					<span class="mb-1 block text-sm text-ink-muted">Speed limit (empty = unlimited)</span>
					<input
						name="rateLimit"
						type="text"
						placeholder="4M"
						value={settings.rateLimit}
						class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink placeholder:text-ink-faint focus:border-accent"
					/>
				</label>
				<label class="block sm:col-span-2">
					<span class="mb-1 block text-sm text-ink-muted">yt-dlp player client</span>
					<input
						name="ytdlpPlayerClient"
						type="text"
						placeholder="(yt-dlp default)"
						value={settings.ytdlpPlayerClient}
						class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent"
					/>
					<span class="mt-1 block text-xs text-ink-faint">
						Which YouTube client yt-dlp impersonates. Leave <strong>empty</strong> when the bgutil
						PO Token provider (<code>POT_PROVIDER_BASE_URL</code>) is running — yt-dlp's default web
						client gets its token automatically. Only override this if you run without the provider:
						<code>tv</code> needs no token but is currently often DRM-blocked, so try
						<code>tv,web_safari</code> or <code>default</code>.
					</span>
				</label>
			</div>
			<label class="mt-4 flex items-center gap-3">
				<input
					type="checkbox"
					name="sponsorBlock"
					checked={settings.sponsorBlock}
					class="accent-accent"
				/>
				<span class="text-sm text-ink">
					SponsorBlock: strip non-music intros/outros from downloads
				</span>
			</label>
		</section>

		<section class="rounded-2xl bg-surface p-6">
			<h2 class="mb-4 text-lg font-semibold">Library</h2>
			<label class="block">
				<span class="mb-1 block text-sm text-ink-muted">Naming template</span>
				<input
					name="namingTemplate"
					type="text"
					value={settings.namingTemplate}
					class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink focus:border-accent"
				/>
				<span class="mt-1 block text-xs text-ink-faint">
					Placeholders: {'{albumartist} {artist} {album} {year} {title} {track:02} {disc}'}
				</span>
			</label>
			<label class="mt-4 flex items-center gap-3">
				<input
					type="checkbox"
					name="musicBrainz"
					checked={settings.musicBrainz}
					class="accent-accent"
				/>
				<span class="text-sm text-ink">
					MusicBrainz: enrich tags with canonical genre, year, and MBIDs
				</span>
			</label>
			<label class="mt-3 flex items-center gap-3">
				<input
					type="checkbox"
					name="jellyfinRefresh"
					checked={settings.jellyfinRefresh}
					class="accent-accent"
				/>
				<span class="text-sm text-ink">Trigger a Jellyfin library scan after downloads finish</span>
			</label>
		</section>

		<section class="rounded-2xl bg-surface p-6">
			<h2 class="mb-4 text-lg font-semibold">Subscriptions</h2>
			<label class="flex items-center gap-3">
				<input
					type="checkbox"
					name="subscriptionsEnabled"
					checked={settings.subscriptionsEnabled}
					class="accent-accent"
				/>
				<span class="text-sm text-ink"> Auto-download new releases from artists you follow </span>
			</label>
			<label class="mt-4 flex items-center gap-3">
				<input
					type="checkbox"
					name="recommendationsEnabled"
					checked={settings.recommendationsEnabled}
					class="accent-accent"
				/>
				<span class="text-sm text-ink">
					Grow <a href="/recommendations" class="text-ink hover:underline"
						>recommendation playlists</a
					>
					daily with new songs matching their vibe
				</span>
			</label>
			<label class="mt-4 block max-w-xs">
				<span class="mb-1 block text-sm text-ink-muted">Check interval (hours, 1–168)</span>
				<input
					name="subscriptionCheckHours"
					type="number"
					min="1"
					max="168"
					value={settings.subscriptionCheckHours}
					class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
				/>
				<span class="mt-1 block text-xs text-ink-faint">
					Shared cadence: how often followed artists, synced playlists, and recommendation playlists
					are checked. Manage the list on the
					<a href="/subscriptions" class="text-ink hover:underline">Subscriptions</a> page.
				</span>
			</label>
		</section>

		{#if form?.error}
			<p class="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">{form.error}</p>
		{/if}
		{#if form?.saved}
			<p class="rounded-lg bg-ok/15 px-3 py-2 text-sm text-ok">Settings saved.</p>
		{/if}

		<button
			type="submit"
			disabled={submitting}
			class="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
		>
			{submitting ? 'Saving…' : 'Save settings'}
		</button>
	</form>
</div>
