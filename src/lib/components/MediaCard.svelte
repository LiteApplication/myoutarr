<script lang="ts">
	import type { Thumbnail } from '$lib/server/ytmusic/api';

	let {
		href,
		title,
		subtitle,
		thumbnails,
		round = false
	}: {
		href: string;
		title: string;
		subtitle: string;
		thumbnails: Thumbnail[];
		round?: boolean;
	} = $props();

	// Pick the largest art we were given; YT Music thumbnails are ordered ascending.
	let art = $derived(thumbnails.at(-1)?.url ?? '');
</script>

<a
	{href}
	class="group block w-full rounded-xl p-3 transition hover:bg-surface-2/70 focus-visible:bg-surface-2/70"
>
	<div
		class="aspect-square w-full overflow-hidden bg-surface-3 {round
			? 'rounded-full'
			: 'rounded-lg'}"
	>
		{#if art}
			<img
				src={art}
				alt=""
				loading="lazy"
				class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
			/>
		{:else}
			<div class="grid h-full w-full place-items-center text-3xl text-ink-faint">♪</div>
		{/if}
	</div>
	<p class="line-clamp-2-fixed mt-2 text-sm font-medium text-ink">{title}</p>
	<p class="mt-0.5 truncate text-xs text-ink-muted">{subtitle}</p>
</a>
