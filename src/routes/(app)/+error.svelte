<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Error - myoutarr</title>
</svelte:head>

<div class="mt-16 flex flex-col items-center gap-4 text-center">
	<div class="grid h-12 w-12 place-items-center rounded-lg bg-surface-3 text-danger">
		<svg
			viewBox="0 0 24 24"
			class="h-6 w-6"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path
				d="M12 9v4M12 17h.01M10.3 3.9L2.5 17.6a1.5 1.5 0 001.3 2.4h16.4a1.5 1.5 0 001.3-2.4L13.7 3.9a1.5 1.5 0 00-2.6 0z"
			/>
		</svg>
	</div>
	<p class="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">
		{page.error?.message ?? 'Something went wrong.'}
	</p>
	<a
		href="/"
		class="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover"
	>
		Back to home
	</a>
</div>
