// Seed brand assets: a company logo for Meridian Construction + monogram avatars
// for the team. Uploads to the public org-logos / avatars buckets and sets
// organizations.logo_path and profiles.avatar_url. Run from repo root.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createClient } = await import('../../node_modules/.pnpm/@supabase+supabase-js@2.109.0/node_modules/@supabase/supabase-js/dist/index.mjs');
const sharp = require('../../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp');

const url = process.env.SB_URL, key = process.env.SB_KEY;
if (!url || !key) { console.error('Missing SB_URL/SB_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const ORG = '11111111-1111-4111-8111-111111111111';

const TEAM = [
  { id: 'a1a04760-5a1b-4f9a-802a-6c9c2d137262', initials: 'AK', c1: '#4148a6', c2: '#2b3080' }, // Allen (owner)
  { id: '5bcce2ae-07a1-47e9-83d8-fe416eb01550', initials: 'PN', c1: '#2478ab', c2: '#164a6d' }, // Patience (PM)
  { id: '6338af37-3c82-4ffb-b9c9-eee06031b340', initials: 'BC', c1: '#12897e', c2: '#0d5f57' }, // Brian (BuildRight)
  { id: '56232919-3204-4a8b-ab1d-c7cd555ededc', initials: 'SD', c1: '#d1810f', c2: '#9a5c08' }, // Sipho (Spark)
  { id: 'b3c6008b-251a-4490-8f1d-21e37209e631', initials: 'TM', c1: '#8b4fe6', c2: '#6929c4' }, // Tendai (AquaPlumb)
  { id: '03ea0f6c-8153-4871-bcd7-16e31322c08d', initials: 'GB', c1: '#d24d86', c2: '#a01f5c' }, // Grace (client)
];

function avatarSVG({ initials, c1, c2 }) {
  const S = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="${S}" height="${S}" fill="${c2}"/>
  <circle cx="256" cy="256" r="256" fill="url(#g)"/>
  <circle cx="256" cy="200" r="250" fill="#ffffff" fill-opacity="0.06"/>
  <text x="50%" y="50%" dy="0.34em" text-anchor="middle" fill="#ffffff"
    font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="212" letter-spacing="4">${initials}</text>
</svg>`;
}

// Company emblem: a blue badge with three white summit peaks (a "meridian" ridge).
function logoSVG() {
  const S = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2478ab"/><stop offset="1" stop-color="#164a6d"/></linearGradient></defs>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="4"/>
  <!-- summit peaks forming an M-like ridge -->
  <path d="M92 372 L188 214 L256 300 L324 214 L420 372 Z" fill="#ffffff"/>
  <path d="M188 214 L256 300 L324 214 L292 214 L256 258 L220 214 Z" fill="#cfe0ee"/>
  <!-- meridian line -->
  <line x1="92" y1="400" x2="420" y2="400" stroke="#ffffff" stroke-opacity="0.55" stroke-width="8" stroke-linecap="round"/>
  <circle cx="256" cy="400" r="13" fill="#ffffff"/>
</svg>`;
}

async function main() {
  // Logo
  const logoPng = await sharp(Buffer.from(logoSVG())).png().toBuffer();
  const logoPath = `${ORG}/logo`;
  const { error: le } = await db.storage.from('org-logos').upload(logoPath, logoPng, { contentType: 'image/png', upsert: true });
  if (le) throw le;
  const { error: lue } = await db.from('organizations').update({ logo_path: logoPath, logo_updated_at: new Date().toISOString() }).eq('id', ORG);
  if (lue) throw lue;
  console.log('logo set:', logoPath);

  // Avatars
  let n = 0;
  for (const u of TEAM) {
    const png = await sharp(Buffer.from(avatarSVG(u))).png().toBuffer();
    const path = `${u.id}/avatar.png`;
    const { error: ue } = await db.storage.from('avatars').upload(path, png, { contentType: 'image/png', upsert: true });
    if (ue) { console.error('avatar upload failed', u.initials, ue.message); continue; }
    const pub = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    const { error: pe } = await db.from('profiles').update({ avatar_url: pub }).eq('id', u.id);
    if (pe) { console.error('profile update failed', u.initials, pe.message); continue; }
    n++;
  }
  console.log(`avatars set: ${n}/${TEAM.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
