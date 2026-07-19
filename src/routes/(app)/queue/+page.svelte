<script lang="ts">
	import { queue, type QueueJob } from '$lib/stores/queue.svelte';
	import { onMount } from 'svelte';

	onMount(() => queue.connect());

	const statusStyles: Record<QueueJob['status'], string> = {
		queued: 'text-ink-muted',
		running: 'text-accent',
		paused: 'text-warn',
		completed: 'text-ok',
		failed: 'text-danger',
		cancelled: 'text-ink-faint'
	};

	let expandedError = $state<string | null>(null);
</script>

<svelte:head>
	<title>Queue - myoutarr</title>
</svelte:head>

<div class="mb-6 flex items-center justify-between">
	<h1 class="text-3xl font-bold">Queue</h1>
	<div class="flex gap-2">
		<button
			onclick={() => queue.action('pause')}
			class="rounded-full bg-surface-2 px-4 py-1.5 text-sm text-ink-muted transition hover:bg-surface-3 hover:text-ink"
		>
			Pause all
		</button>
		<button
			onclick={() => queue.action('resume')}
			class="rounded-full bg-surface-2 px-4 py-1.5 text-sm text-ink-muted transition hover:bg-surface-3 hover:text-ink"
		>
			Resume
		</button>
	</div>
</div>

{#if queue.batches.length === 0}
	<p class="mt-16 text-center text-ink-muted">Nothing here yet - find an album and hit download.</p>
{/if}

<div class="space-y-6">
	{#each queue.batches as batch (batch.id)}
		{@const open = batch.jobs.filter((j) => ['queued', 'running', 'paused'].includes(j.status))}
		{@const done = batch.jobs.filter((j) => j.status === 'completed')}
		<section class="overflow-hidden rounded-xl bg-surface">
			<header class="flex items-center gap-4 border-b border-line px-4 py-3">
				{#if batch.thumbnail}
					<img src={batch.thumbnail} alt="" class="h-12 w-12 rounded object-cover" />
				{/if}
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium text-ink">{batch.title}</p>
					<p class="truncate text-xs text-ink-muted">
						{batch.artist ?? ''} · {batch.kind} · {done.length}/{batch.jobs.length} done
					</p>
				</div>
				{#if batch.kind === 'playlist'}
					{#if batch.jellyfinPlaylistId}
						<span
							class="flex shrink-0 items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-1 text-xs font-medium text-ok"
							title="Materialised into a Jellyfin playlist"
						>
							<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5" aria-hidden="true">
								<path
									fill-rule="evenodd"
									d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.79 6.8-6.8a1 1 0 0 1 1.4 0Z"
									clip-rule="evenodd"
								/>
							</svg>
							Synced to Jellyfin
						</span>
					{:else}
						<span
							class="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-muted"
							title="Not yet synced to Jellyfin"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-ink-faint"></span>
							Not synced
						</span>
					{/if}
				{/if}
				{#if open.length > 0}
					<button
						onclick={() => queue.action('cancel', { batchId: batch.id })}
						class="rounded-full px-3 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-danger"
					>
						Cancel batch
					</button>
				{/if}
			</header>
			<ul class="divide-y divide-line">
				{#each batch.jobs as job (job.id)}
					<li class="px-4 py-2">
						<div class="flex items-center gap-3">
							<span class="w-20 shrink-0 text-xs {statusStyles[job.status]}">{job.status}</span>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm text-ink">{job.meta.title}</p>
								{#if job.status === 'running'}
									<div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
										<div
											class="h-full rounded-full bg-accent transition-[width] duration-300"
											style="width: {Math.round(job.progress * 100)}%"
										></div>
									</div>
								{/if}
							</div>
							{#if job.status === 'failed' && job.error}
								<button
									onclick={() => (expandedError = expandedError === job.id ? null : job.id)}
									class="rounded-full px-2 py-1 text-xs text-danger transition hover:bg-surface-3"
								>
									details
								</button>
							{/if}
							{#if ['failed', 'cancelled'].includes(job.status)}
								<button
									onclick={() => queue.action('retry', { jobId: job.id })}
									class="rounded-full px-2 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink"
								>
									retry
								</button>
							{:else if ['queued', 'running', 'paused'].includes(job.status)}
								<button
									onclick={() => queue.action('cancel', { jobId: job.id })}
									class="rounded-full px-2 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-danger"
								>
									cancel
								</button>
							{/if}
						</div>
						{#if expandedError === job.id && job.error}
							<pre
								class="mt-2 overflow-x-auto rounded-lg bg-canvas p-3 text-xs text-danger">{job.error}</pre>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>
