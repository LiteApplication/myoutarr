<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let query = $state(page.url.searchParams.get('q') ?? '');

	const navItems = [
		{ href: '/', label: 'Home', icon: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10' },
		{
			href: '/queue',
			label: 'Queue',
			icon: 'M4 6h16M4 12h16M4 18h10M17 15l3 3-3 3'
		},
		{
			href: '/settings',
			label: 'Settings',
			icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 01-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 01-2 1.2L14 21h-4l-.4-2.6a7 7 0 01-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 015 12a7 7 0 01.1-1.2l-2-1.6 2-3.4 2.4 1a7 7 0 012-1.2L10 3h4l.4 2.6a7 7 0 012 1.2l2.4-1 2 3.4-2 1.6c.1.4.2.8.2 1.2z'
		}
	];

	function isActive(href: string): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}
</script>

<div class="flex min-h-screen bg-canvas text-ink">
	<!-- Left rail -->
	<nav
		class="fixed inset-y-0 left-0 z-20 hidden w-rail flex-col border-r border-line bg-canvas md:flex"
	>
		<a href="/" class="flex h-topbar items-center gap-2 px-5">
			<span
				class="grid h-8 w-8 place-items-center rounded-full bg-accent font-black text-accent-ink"
			>
				m
			</span>
			<span class="text-lg font-bold tracking-tight">myoutarr</span>
		</a>
		<div class="mt-2 flex flex-col gap-1 px-3">
			{#each navItems as item (item.href)}
				<a
					href={item.href}
					class="flex items-center gap-4 rounded-lg px-3 py-2.5 text-sm transition
						{isActive(item.href)
						? 'bg-surface-2 font-medium text-ink'
						: 'text-ink-muted hover:bg-surface-2/60 hover:text-ink'}"
				>
					<svg
						viewBox="0 0 24 24"
						class="h-5 w-5 shrink-0"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d={item.icon} />
					</svg>
					{item.label}
				</a>
			{/each}
		</div>
		<form action="/logout" method="POST" class="mt-auto p-4">
			<p class="mb-2 truncate px-2 text-xs text-ink-faint">{data.userName}</p>
			<button
				type="submit"
				class="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink"
			>
				Sign out
			</button>
		</form>
	</nav>

	<!-- Main column -->
	<div class="flex min-w-0 flex-1 flex-col md:pl-rail">
		<!-- Top bar with search -->
		<header
			class="sticky top-0 z-10 flex h-topbar items-center gap-4 border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-8"
		>
			<a href="/" class="font-bold md:hidden">myoutarr</a>
			<form action="/search" method="GET" class="mx-auto w-full max-w-xl">
				<div class="relative">
					<svg
						viewBox="0 0 24 24"
						class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					>
						<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
					</svg>
					<input
						name="q"
						type="search"
						required
						placeholder="Search songs, albums, artists, playlists"
						bind:value={query}
						class="w-full rounded-full border border-line bg-surface-2 py-2 pl-10 pr-4 text-sm text-ink placeholder:text-ink-faint focus:border-accent"
					/>
				</div>
			</form>
		</header>

		<!-- Routed content; bottom padding reserves room for the queue bar -->
		<main class="min-w-0 flex-1 px-4 pb-queuebar pt-6 md:px-8">
			{@render children()}
		</main>
	</div>
</div>
