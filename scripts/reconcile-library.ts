/**
 * Lidarr-compatibility report for an existing library.
 *
 *   node scripts/reconcile-library.ts            # dry run: print what would change
 *   node scripts/reconcile-library.ts --apply    # perform renames + duplicate removal
 *
 * Duplicates (same track, several files) collapse onto the highest-quality
 * copy; the rest are renamed to the configured naming template. Nothing is
 * touched without --apply.
 */
import { getDb } from '../src/lib/server/db/index.ts';
import { musicDir } from '../src/lib/server/env.ts';
import { assertMounted } from '../src/lib/server/library/publish.ts';
import { applyPlan, planReconcile } from '../src/lib/server/library/reconcile.ts';
import { getSettings } from '../src/lib/server/settings.ts';

const apply = process.argv.includes('--apply');
const root = musicDir();
assertMounted(root);

const db = getDb();
const plan = await planReconcile(root, getSettings(db).namingTemplate);
const rel = (p: string) => p.slice(root.length + 1);

console.log(`scanned ${plan.scanned} files under ${root}\n`);
console.log(`${plan.removals.length} duplicate(s) to remove (a better or equal copy stays):`);
for (const r of plan.removals) console.log(`  - ${rel(r.path)}\n    keeps ${rel(r.keeper)}`);
console.log(`\n${plan.moves.length} file(s) to rename:`);
for (const m of plan.moves) console.log(`  ${rel(m.from)}\n    -> ${rel(m.to)}`);
if (plan.conflicts.length > 0) {
	console.log(`\n${plan.conflicts.length} rename(s) skipped, destination already exists:`);
	for (const m of plan.conflicts) console.log(`  ${rel(m.from)}\n    -> ${rel(m.to)}`);
}
if (plan.splitFolders.length > 0) {
	console.log('\nalbum folders split by case/quoting (merge by hand):');
	for (const dirs of plan.splitFolders) console.log(`  ${dirs.map(rel).join('  |  ')}`);
}

if (apply) {
	applyPlan(plan, db);
	console.log('\napplied. Refresh the Jellyfin library to pick up the changes.');
} else {
	console.log('\ndry run - re-run with --apply to make these changes.');
}
