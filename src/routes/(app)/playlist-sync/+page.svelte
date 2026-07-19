<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let checking = $state(false);
	let checkResult = $state('');
	let busyId = $state('');

	function lastChecked(ms: number | null): string {
		if (!ms) return 'not yet checked';
		return `checked ${new Date(ms).toLocaleString()}`;
	}

	async function checkNow() {
		checking = true;
		checkResult = '';
		try {
			const response = await fetch('/api/playlists/check', { method: 'POST' });
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error ?? `request failed (${response.status})`);
			checkResult =
				body.enqueued > 0
					? `Queued ${body.enqueued} new song${body.enqueued === 1 ? '' : 's'}.`
					: 'No new songs found.';
			await invalidateAll();
		} catch (cause) {
			checkResult = (cause as Error).message;
		} finally {
			checking = false;
		}
	}

	async function toggle(browseId: string, enabled: boolean) {
		busyId = browseId;
		try {
			await fetch('/api/playlists', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ browseId, enabled })
			});
			await invalidateAll();
		} finally {
			busyId = '';
		}
	}

	async function stopSyncing(browseId: string) {
		busyId = browseId;
		try {
			await fetch('/api/playlists', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ browseId })
			});
			await invalidateAll();
		} finally {
			busyId = '';
		}
	}
</script>

<svelte:head>
	<title>Playlist Sync - myoutarr</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-bold tracking-tight">Playlist Sync</h1>
		<p class="mt-1 text-sm text-ink-muted">
			Songs added to a followed playlist download automatically and join the matching Jellyfin
			playlist, checked about every {data.checkHours} hour{data.checkHours === 1 ? '' : 's'}. Toggle
			a playlist off to leave it alone without forgetting it.
		</p>
	</div>
	<button
		onclick={checkNow}
		disabled={checking || data.subscriptions.length === 0}
		class="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
	>
		{checking ? 'Checking…' : 'Check now'}
	</button>
</header>

{#if checkResult}
	<p class="mb-4 text-sm text-ink-muted" role="status">{checkResult}</p>
{/if}

{#if data.subscriptions.length === 0}
	<p class="mt-16 text-center text-ink-muted">
		You aren't syncing any playlists yet. Open a playlist and choose
		<span class="text-ink">Sync new songs</span>.
	</p>
{:else}
	<ul class="divide-y divide-line overflow-hidden rounded-xl bg-surface">
		{#each data.subscriptions as sub (sub.browseId)}
			<li class="flex items-center gap-4 px-4 py-3">
				<a href="/playlist/{sub.browseId}" class="shrink-0">
					{#if sub.thumbnail}
						<img src={sub.thumbnail} alt="" class="h-12 w-12 rounded bg-surface-3 object-cover" />
					{:else}
						<div class="h-12 w-12 rounded bg-surface-3"></div>
					{/if}
				</a>
				<div class="min-w-0 flex-1">
					<a href="/playlist/{sub.browseId}" class="truncate font-medium hover:underline">
						{sub.title}
					</a>
					<p class="truncate text-xs text-ink-faint">
						{sub.enabled ? lastChecked(sub.lastCheckedAt) : 'paused'}
					</p>
				</div>
				<button
					onclick={() => toggle(sub.browseId, !sub.enabled)}
					disabled={busyId === sub.browseId}
					role="switch"
					aria-checked={sub.enabled}
					aria-label="Toggle syncing for {sub.title}"
					class={[
						'relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50',
						sub.enabled ? 'bg-accent' : 'bg-surface-3'
					]}
				>
					<span
						class={[
							'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
							sub.enabled ? 'left-[1.375rem]' : 'left-0.5'
						]}
					></span>
				</button>
				<button
					onclick={() => stopSyncing(sub.browseId)}
					disabled={busyId === sub.browseId}
					class="rounded-full border border-line px-4 py-1.5 text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
				>
					{busyId === sub.browseId ? '…' : 'Stop syncing'}
				</button>
			</li>
		{/each}
	</ul>
{/if}
