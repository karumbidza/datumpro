// Demo reset — wipe ALL auth users and create the RBAC demo set.
// Run: node scripts/seed/reset-users.mjs   (from repo root)
// Reads SUPABASE_URL + service key from the shell env (see run command).
import { createClient } from '../../node_modules/.pnpm/@supabase+supabase-js@2.109.0/node_modules/@supabase/supabase-js/dist/index.mjs';

const url = process.env.SB_URL;
const key = process.env.SB_KEY;
if (!url || !key) {
  console.error('Missing SB_URL / SB_KEY');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = 'DatumproDemo!2026';

// email → { display_name }  (roles/memberships are wired in the SQL seed step)
const USERS = [
  ['karumbidzaallen21@gmail.com', 'Allen Karumbidza'],   // owner (your real login)
  ['pm@datumpro.demo', 'Patience Ncube'],                 // project manager
  ['buildright@datumpro.demo', 'Brian Chikto · BuildRight Civils'],   // contractor
  ['sparkelec@datumpro.demo', 'Sipho Dube · Spark Electrical'],       // contractor
  ['aquaplumb@datumpro.demo', 'Tendai Moyo · AquaPlumb Services'],    // contractor
  ['client@datumpro.demo', 'Grace Bhebe · Client Rep'],   // client / viewer
];

async function deleteAll() {
  let page = 1;
  let removed = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data.users;
    if (users.length === 0) break;
    for (const u of users) {
      const { error: e } = await admin.auth.admin.deleteUser(u.id);
      if (e) console.error('delete failed', u.email, e.message);
      else removed++;
    }
    if (users.length < 200) break;
  }
  return removed;
}

async function main() {
  const removed = await deleteAll();
  console.log(`deleted ${removed} existing users`);
  const out = {};
  for (const [email, display_name] of USERS) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name },
    });
    if (error) {
      console.error('create failed', email, error.message);
      process.exit(1);
    }
    out[email] = data.user.id;
    console.log(`created ${email}  ${data.user.id}`);
  }
  console.log('MAP=' + JSON.stringify(out));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
