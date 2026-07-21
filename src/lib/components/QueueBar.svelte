<script lang="ts">
	import { queue } from '$lib/stores/queue.svelte';
	import { onMount } from 'svelte';

	onMount(() => queue.connect());

	let current = $derived(queue.activeJobs[0] ?? null);
	let open = $derived(queue.openCount);
	let progress = $derived(queue.sessionProgress ?? current?.progress ?? 0);
</script>

{#if current || open > 0}
	<a
		href="/queue"
		class="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur transition hover:bg-surface-2/95 md:left-rail"
	>
		<div class="flex h-queuebar items-center gap-4 px-4 md:px-8">
			{#if current}
				{#if current.meta.thumbnail}
					<img src={current.meta.thumbnail} alt="" class="h-11 w-11 rounded object-cover" />
				{:else}
					<div class="grid h-11 w-11 place-items-center rounded bg-surface-3 text-ink-faint">♪</div>
				{/if}
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm text-ink">{current.meta.title}</p>
					<p class="truncate text-xs text-ink-muted">{current.meta.artist}</p>
					<div class="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
						<div
							class="h-full rounded-full bg-accent transition-[width] duration-300"
							style="width: {Math.round(progress * 100)}%"
						></div>
					</div>
				</div>
			{:else}
				<div class="min-w-0 flex-1">
					<p class="text-sm text-ink-muted">Queue idle</p>
					<div class="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
						<div
							class="h-full rounded-full bg-accent transition-[width] duration-300"
							style="width: {Math.round(progress * 100)}%"
						></div>
					</div>
				</div>
			{/if}
			<span class="shrink-0 rounded-full bg-counter-soft px-3 py-1 text-xs text-ink">
				{open} in queue
			</span>
		</div>
	</a>
{/if}
