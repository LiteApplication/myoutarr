<script lang="ts">
	import { navigating, page } from '$app/state';
	import QueueBar from '$lib/components/QueueBar.svelte';
	import type { LayoutData } from './$types';
	import { fade, fly } from 'svelte/transition';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let query = $state(page.url.searchParams.get('q') ?? '');

	// Mobile navigation drawer. Closes on every navigation so a tapped link
	// never leaves the overlay hanging over the new page.
	let menuOpen = $state(false);
	$effect(() => {
		if (page.url.pathname) menuOpen = false;
	});

	let isSearching = $derived(navigating.to?.url.pathname === '/search');

	const navItems = [
		{ href: '/', label: 'Home', icon: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10' },
		{
			href: '/queue',
			label: 'Queue',
			icon: 'M4 6h16M4 12h16M4 18h10M17 15l3 3-3 3'
		},
		{
			href: '/logs',
			label: 'Logs',
			icon: 'M9 12h6M9 16h6M9 8h6M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM15 3v5h5'
		},
		{
			href: '/library',
			label: 'Library',
			icon: 'M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM8 3v18M15 10.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z'
		},
		{
			href: '/subscriptions',
			label: 'Subscriptions',
			icon: 'M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z'
		},
		{
			href: '/playlist-sync',
			label: 'Playlist Sync',
			icon: 'M4 6h11M4 12h11M4 18h7M16 16l3 3 3-3M19 19V9'
		},
		{
			href: '/recommendations',
			label: 'Recommendations',
			icon: 'M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3zM18 14l1 2.4L21.5 17l-2.5 1L18 20.5 17 18l-2.5-1 2.5-.6L18 14z'
		},
		{
			href: '/cookies',
			label: 'Cookies',
			icon: 'M12 2a10 10 0 1010 10 4 4 0 01-5-5 4 4 0 01-5-5zM8.5 10.5h.01M15 14h.01M10.5 15.5h.01'
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

{#snippet navLinks()}
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
{/snippet}

{#snippet versionLink()}
	{#if data.appVersion}
		<a
			href="https://github.com/LiteApplication/myoutarr/releases/tag/{data.appVersion}"
			target="_blank"
			rel="noreferrer"
			class="mt-2 block truncate px-2 text-xs text-ink-faint hover:text-ink-muted hover:underline"
		>
			{data.appVersion}
		</a>
	{/if}
{/snippet}

{#if navigating.to}
	<div class="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-accent/20">
		<div class="loading-bar h-full w-1/3 bg-accent"></div>
	</div>
{/if}

<div class="flex min-h-dvh bg-canvas text-ink">
	<!-- Left rail -->
	<nav
		class="fixed inset-y-0 left-0 z-20 hidden w-rail flex-col border-r border-line bg-canvas md:flex"
	>
		<a href="/" class="flex h-topbar items-center gap-2.5 px-5">
			<span
				class="font-display grid h-8 w-8 place-items-center rounded-lg bg-accent text-xl font-black italic text-accent-ink"
			>
				m
			</span>
			<span class="font-display text-xl font-semibold tracking-tight">myoutarr</span>
		</a>
		<div class="mt-2 flex flex-col gap-1 px-3">
			{@render navLinks()}
		</div>
		<form action="/logout" method="POST" class="mt-auto p-4">
			<p class="mb-2 truncate px-2 text-xs text-ink-faint">{data.userName}</p>
			<button
				type="submit"
				class="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink"
			>
				Sign out
			</button>
			{@render versionLink()}
		</form>
	</nav>

	<!-- Main column -->
	<div class="flex min-w-0 flex-1 flex-col md:pl-rail">
		<!-- Top bar with search -->
		<header
			class="sticky top-0 z-10 flex h-topbar items-center gap-4 border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-8"
		>
			<button
				type="button"
				onclick={() => (menuOpen = true)}
				class="-ml-1 rounded-lg p-2 text-ink-muted transition hover:bg-surface-2 hover:text-ink md:hidden"
				aria-label="Open menu"
			>
				<svg
					viewBox="0 0 24 24"
					class="h-6 w-6"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				>
					<path d="M4 6h16M4 12h16M4 18h16" />
				</svg>
			</button>
			<form action="/search" method="GET" class="mx-auto w-full max-w-xl">
				<div class="relative">
					{#if isSearching}
						<svg
							viewBox="0 0 24 24"
							class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-ink-faint"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						>
							<path d="M11 4a7 7 0 100 14" opacity="0.9" />
						</svg>
					{:else}
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
					{/if}
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
		<main class="hero-wash min-w-0 flex-1 px-4 pb-queuebar pt-6 md:px-8">
			{@render children()}
		</main>
	</div>
</div>

<!-- Mobile navigation drawer -->
{#if menuOpen}
	<div class="fixed inset-0 z-40 md:hidden">
		<button
			type="button"
			class="absolute inset-0 bg-black/60"
			aria-label="Close menu"
			onclick={() => (menuOpen = false)}
			transition:fade={{ duration: 150 }}
		></button>
		<nav
			class="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col border-r border-line bg-canvas"
			transition:fly={{ x: -288, duration: 200 }}
		>
			<div class="flex h-topbar items-center justify-between px-5">
				<a href="/" class="flex items-center gap-2.5">
					<span
						class="font-display grid h-8 w-8 place-items-center rounded-lg bg-accent text-xl font-black italic text-accent-ink"
					>
						m
					</span>
					<span class="font-display text-xl font-semibold tracking-tight">myoutarr</span>
				</a>
				<button
					type="button"
					onclick={() => (menuOpen = false)}
					class="rounded-lg p-2 text-ink-muted transition hover:bg-surface-2 hover:text-ink"
					aria-label="Close menu"
				>
					<svg
						viewBox="0 0 24 24"
						class="h-5 w-5"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					>
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>
			<div class="mt-2 flex flex-col gap-1 px-3">
				{@render navLinks()}
			</div>
			<form action="/logout" method="POST" class="mt-auto p-4">
				<p class="mb-2 truncate px-2 text-xs text-ink-faint">{data.userName}</p>
				<button
					type="submit"
					class="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink"
				>
					Sign out
				</button>
				{@render versionLink()}
			</form>
		</nav>
	</div>
{/if}

<QueueBar />

<style>
	.loading-bar {
		animation: loading-bar-slide 1.1s ease-in-out infinite;
	}

	@keyframes loading-bar-slide {
		0% {
			transform: translateX(-100%);
		}
		50% {
			transform: translateX(100%);
		}
		100% {
			transform: translateX(250%);
		}
	}
</style>
