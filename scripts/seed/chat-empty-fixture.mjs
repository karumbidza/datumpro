/**
 * Temporary fixture for screenshotting the chat-v2 EMPTY state: creates a
 * second project ("Depot access road") with a conversation and the same
 * members, prints its project id, and with `--cleanup <projectId>` deletes it
 * again (cascades take the conversation with it).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { createClient } = requireWeb('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync(new URL('../../apps/web/.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

if (process.argv[2] === '--cleanup') {
  const id = process.argv[3];
  if (!id) throw new Error('pass the project id');
  const { error } = await db.from('projects').delete().eq('id', id).eq('name', 'Depot access road (fixture)');
  if (error) throw new Error(error.message);
  console.log('cleaned up', id);
  process.exit(0);
}

const { data: src } = await db.from('projects').select('id, org_id, created_by, start_date, end_date').limit(1).single();
const { data: proj, error } = await db
  .from('projects')
  .insert({
    org_id: src.org_id,
    name: 'Depot access road (fixture)',
    status: 'planning',
    created_by: src.created_by,
    start_date: src.start_date,
    end_date: src.end_date,
  })
  .select('id')
  .single();
if (error) throw new Error(error.message);

const { data: members } = await db.from('project_members').select('user_id, role').eq('project_id', src.id);
await db.from('project_members').insert(members.map((m) => ({ project_id: proj.id, user_id: m.user_id, role: m.role, org_id: src.org_id })));
const { error: convErr } = await db
  .from('conversations')
  .insert({ org_id: src.org_id, project_id: proj.id, type: 'project', created_by: src.created_by });
if (convErr) throw new Error(convErr.message);
console.log(proj.id);
