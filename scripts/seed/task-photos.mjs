// Seed task-photo attachments: generate site-photo PNGs, upload to the
// project-media bucket at the app's path convention, and record task_media rows.
// Run from repo root with SB_URL + SB_KEY (service key) in env.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createClient } = await import('../../node_modules/.pnpm/@supabase+supabase-js@2.109.0/node_modules/@supabase/supabase-js/dist/index.mjs');
const sharp = require('../../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp');

const url = process.env.SB_URL, key = process.env.SB_KEY;
if (!url || !key) { console.error('Missing SB_URL/SB_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECTS = {
  P1: '21111111-0000-4000-8000-000000000001',
  P2: '21111111-0000-4000-8000-000000000002',
  P3: '21111111-0000-4000-8000-000000000003',
};
const PM = '5bcce2ae-07a1-47e9-83d8-fe416eb01550';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Palette variants per project so the three sites read differently.
const THEME = {
  [PROJECTS.P1]: { sky1: '#cfe0ec', sky2: '#eef4f8', ground: '#c8b197', vest: '#e8871e' },
  [PROJECTS.P2]: { sky1: '#bcd3e6', sky2: '#e7f0f6', ground: '#c2ac8e', vest: '#1f9d55' },
  [PROJECTS.P3]: { sky1: '#c6d2dc', sky2: '#edf1f4', ground: '#cbb896', vest: '#d64545' },
};

function sceneSVG({ title, project, dateStr, geo, theme, i }) {
  const W = 1280, H = 960;
  const craneX = 300 + (i % 3) * 120;
  const floors = 4 + (i % 4);
  const bh = 90 + floors * 78;
  const by = 640 - (bh - 320);
  // building floors
  let build = '';
  for (let f = 0; f < floors; f++) {
    const fy = 640 - (f + 1) * 78;
    const shade = f === floors - 1 ? 0.10 : 0.18;
    build += `<rect x="720" y="${fy}" width="360" height="78" fill="#7d8a94" fill-opacity="${shade + (f % 2) * 0.05}" stroke="#5c666e" stroke-width="2"/>`;
    for (let c = 0; c < 4; c++) build += `<rect x="${736 + c * 86}" y="${fy + 16}" width="54" height="46" fill="#2b3742" fill-opacity="0.35"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${theme.sky1}"/><stop offset="1" stop-color="${theme.sky2}"/></linearGradient>
    <linearGradient id="grd" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${theme.ground}"/><stop offset="1" stop-color="#a2906f"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="1080" cy="150" r="60" fill="#fff6e0" fill-opacity="0.85"/>
  <!-- distant skyline -->
  <g fill="#9fb0bd" fill-opacity="0.5">
    <rect x="60" y="430" width="90" height="210"/><rect x="170" y="380" width="70" height="260"/><rect x="255" y="460" width="110" height="180"/></g>
  <!-- tower crane -->
  <g stroke="#3c4650" stroke-width="6" fill="none">
    <line x1="${craneX}" y1="640" x2="${craneX}" y2="150"/>
    <line x1="${craneX - 220}" y1="175" x2="${craneX + 330}" y2="175"/>
    <line x1="${craneX}" y1="150" x2="${craneX - 220}" y2="175"/>
    <line x1="${craneX}" y1="150" x2="${craneX + 330}" y2="175"/>
    <line x1="${craneX + 250}" y1="175" x2="${craneX + 250}" y2="300"/></g>
  <rect x="${craneX + 236}" y="300" width="28" height="20" fill="#3c4650"/>
  ${build}
  <!-- scaffolding -->
  <g stroke="#c9a24a" stroke-width="4" fill="none" stroke-opacity="0.9">
    <rect x="700" y="${by}" width="24" height="${640 - by}"/><line x1="700" y1="${by + 60}" x2="724" y2="${by + 60}"/>
    <line x1="700" y1="${by + 160}" x2="724" y2="${by + 160}"/><line x1="700" y1="${by + 260}" x2="724" y2="${by + 260}"/></g>
  <!-- ground -->
  <rect x="0" y="640" width="${W}" height="${H - 640}" fill="url(#grd)"/>
  <ellipse cx="430" cy="720" rx="150" ry="26" fill="#8a785a" fill-opacity="0.5"/>
  <ellipse cx="980" cy="760" rx="180" ry="30" fill="#8a785a" fill-opacity="0.4"/>
  <!-- worker in hi-vis -->
  <g transform="translate(430,640)"><rect x="-16" y="-4" width="32" height="46" rx="6" fill="${theme.vest}"/>
    <circle cx="0" cy="-20" r="15" fill="#e8c9a0"/><path d="M-16 -20 a16 12 0 0 1 32 0z" fill="#f4d03f"/></g>
  <!-- timestamp chip -->
  <g><rect x="${W - 250}" y="26" width="224" height="40" rx="6" fill="#000" fill-opacity="0.45"/>
    <text x="${W - 236}" y="53" fill="#fff" font-size="22" font-family="monospace">${esc(dateStr)}</text></g>
  <!-- caption bar -->
  <rect x="0" y="${H - 96}" width="${W}" height="96" fill="#0d1620" fill-opacity="0.72"/>
  <rect x="0" y="${H - 96}" width="8" height="96" fill="${theme.vest}"/>
  <text x="28" y="${H - 54}" fill="#fff" font-size="30" font-weight="700">${esc(title)}</text>
  <text x="28" y="${H - 22}" fill="#c7d2dc" font-size="20">${esc(project)}  ·  ${esc(geo)}</text>
</svg>`;
}

// Which tasks get photos, and their captions.
const PLAN = [
  // P1 — completed evidence
  ['P1', 'Partition walls & ceilings', ['Partitions framed and boarded', 'Ceiling grid complete']],
  ['P1', 'Flooring & tiling', ['Porcelain tiling to concourse']],
  ['P1', 'Second-fix electrical & fittings', ['Light fittings installed and tested']],
  ['P1', 'Painting & finishes', ['Final decoration complete', 'Shopfront handover finish']],
  ['P1', 'Snagging & handover', ['Punch-list walkthrough with client']],
  // P2 — near complete
  ['P2', 'Superstructure frame', ['RC frame topped out']],
  ['P2', 'Roofing', ['Roof sheeting and flashing complete']],
  ['P2', 'Plastering & screeds', ['Internal plaster to units', 'Floor screeds laid']],
  ['P2', 'Internal finishes & painting', ['Finishes 80% — submitted for sign-off', 'Kitchen joinery installed']],
  ['P2', 'Balcony balustrades', ['Balcony openings awaiting balustrade delivery']],
  // P3 — early
  ['P3', 'Site establishment', ['Site office and hoarding set up']],
  ['P3', 'Bulk earthworks', ['Cut to formation in progress']],
  ['P3', 'Foundation excavation', ['Trench excavation — grid line B']],
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmt(d) { return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

async function main() {
  // Load tasks once
  const { data: tasks, error } = await db.from('tasks')
    .select('id, project_id, org_id, title, assignee_id, actual_end_date, actual_start_date')
    .eq('org_id', ORG);
  if (error) throw error;
  const byKey = new Map(tasks.map((t) => [`${t.project_id}|${t.title}`, t]));

  let uploaded = 0, rows = 0, idx = 0;
  for (const [pk, title, caps] of PLAN) {
    const pid = PROJECTS[pk];
    const t = byKey.get(`${pid}|${title}`);
    if (!t) { console.error('task not found:', pk, title); continue; }
    const theme = THEME[pid];
    const proj = { P1: 'Riverside Mall Fit-Out', P2: 'Hillside Apartments — Block A', P3: 'Central Clinic Extension' }[pk];
    const when = t.actual_end_date ? new Date(t.actual_end_date) : (t.actual_start_date ? new Date(t.actual_start_date) : new Date());
    for (let k = 0; k < caps.length; k++, idx++) {
      const cap = caps[k];
      const svg = sceneSVG({ title: cap, project: proj, dateStr: fmt(when), geo: '\u{1F4CD} -17.83, 31.05', theme, i: idx });
      const png = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
      const uid = (globalThis.crypto?.randomUUID?.()) || require('crypto').randomUUID();
      const path = `${ORG}/${pid}/tasks/${t.id}/${uid}.png`;
      const { error: upErr } = await db.storage.from('project-media').upload(path, png, { contentType: 'image/png', upsert: false });
      if (upErr) { console.error('upload failed', path, upErr.message); continue; }
      uploaded++;
      const captured = new Date(when.getTime() + k * 3600_000);
      const { error: insErr } = await db.from('task_media').insert({
        org_id: ORG, project_id: pid, task_id: t.id, kind: 'photo', purpose: 'completion',
        storage_path: path, caption: cap, uploaded_by: t.assignee_id || PM,
        gps_lat: -17.83, gps_lng: 31.05, captured_at: captured.toISOString(),
      });
      if (insErr) { console.error('task_media insert failed', insErr.message); continue; }
      rows++;
    }
  }
  console.log(`uploaded ${uploaded} PNGs, inserted ${rows} task_media rows`);
}
main().catch((e) => { console.error(e); process.exit(1); });
