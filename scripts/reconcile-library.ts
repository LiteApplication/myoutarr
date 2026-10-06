/**
 * Lidarr-compatibility report for an existing library.
 *
 *   node scripts/reconcile-library.ts            # dry run: print what would change
 *   node scripts/reconcile-library.ts --apply    # perform renames + duplicate removal
 *
 * Duplicates (same track, several files) collapse onto the highest-quality
 * copy; the rest are renamed to the configured naming template. Nothing is
 * touched without --apply.
 *
 * The running app holds an exclusive lock on its SQLite file, so a dry run never
 * opens it (the naming template comes from --template, default Lidarr's). --apply
 * needs the database to repoint finished jobs at renamed files, so stop the app
 * first, or pass --no-db to skip that bookkeeping.
 */
import { getDb } from '../src/lib/server/db/index.ts';
import { musicDir } from '../src/lib/server/env.ts';
import { LIDARR_TEMPLATE } from '../src/lib/server/library/naming.ts';
import { assertMounted } from '../src/lib/server/library/publish.ts';
import { applyPlan, planReconcile } from '../src/lib/server/library/reconcile.ts';
import { getSettings } from '../src/lib/server/settings.ts';

const apply = process.argv.includes('--apply');
const root = musicDir();
assertMounted(root);

const flag = (name: string) => process.argv.indexOf(name);
const templateArg = process.argv[flag('--template') + 1];
const db = apply && !process.argv.includes('--no-db') ? getDb() : undefined;
const template =
	flag('--template') >= 0 ? templateArg : db ? getSettings(db).namingTemplate : LIDARR_TEMPLATE;
const plan = await planReconcile(root, template);
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
