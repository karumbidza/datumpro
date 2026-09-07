/**
 * Seed a realistic chat-v2 demo conversation into the project chat of the
 * current demo org ("Chugutu road works" at time of writing): a pinned kickoff,
 * a site update with geotagged photos, a voice note, a thread, reactions, a
 * work-item link chip and an @mention — so the redesigned page is judged with
 * content, not lorem.
 *
 * Idempotent-ish: refuses to run if the conversation already has messages
 * (pass --force to append anyway).
 *
 * Usage: node scripts/seed/chat-demo.mjs [--force]
 * Reads SUPABASE_URL + SUPABASE_SECRET_KEY from .env.local at the repo root.
 */
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';

// supabase-js lives in the web workspace, not the repo root.
const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { createClient } = requireWeb('@supabase/supabase-js');

// ── env ─────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../../apps/web/.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY missing from .env.local');
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

// ── tiny PNG encoder (truecolor, zlib) — placeholder "site photos" ──────────
function crc32(buf) {
  let c,
    table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A photo-ish frame: sky band, horizon haze, earthworks ground with noise and
 *  a few dark "machinery" blobs. Enough texture to read as a thumbnail. */
function sitePhoto(w, h, seedNum) {
  let s = seedNum;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 2 ** 32);
  const rows = [];
  const blobs = Array.from({ length: 4 }, () => ({ x: rnd() * w, y: h * (0.62 + rnd() * 0.3), r: 8 + rnd() * 22 }));
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const t = y / h;
      let r, g, b;
      if (t < 0.42) {
        // sky
        r = 168 + t * 90 + rnd() * 6;
        g = 196 + t * 60 + rnd() * 6;
        b = 224 + t * 20 + rnd() * 6;
      } else if (t < 0.5) {
        // haze / horizon
        r = 190 + rnd() * 10;
        g = 186 + rnd() * 10;
        b = 172 + rnd() * 10;
      } else {
        // ground: reddish-brown earthworks
        const d = (t - 0.5) * 2;
        r = 148 - d * 40 + rnd() * 22;
        g = 106 - d * 34 + rnd() * 18;
        b = 74 - d * 26 + rnd() * 14;
      }
      for (const bl of blobs) {
        const dist = Math.hypot(x - bl.x, y - bl.y);
        if (dist < bl.r) {
          const k = 1 - dist / bl.r;
          r -= 70 * k;
          g -= 60 * k;
          b -= 50 * k;
        }
      }
      const o = 1 + x * 3;
      row[o] = Math.max(0, Math.min(255, r));
      row[o + 1] = Math.max(0, Math.min(255, g));
      row[o + 2] = Math.max(0, Math.min(255, b));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── tiny WAV synth — a speech-shaped voice note ─────────────────────────────
function voiceWav(seconds) {
  const rate = 16000;
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // Syllable envelope: bursts ~3.2/s with pauses, like speech cadence.
    const syllable = Math.max(0, Math.sin(t * Math.PI * 3.2)) ** 1.6;
    const pause = t % 3 > 2.5 ? 0.08 : 1; // breath every ~3 s
    const f = 130 + 40 * Math.sin(t * 1.9) + 18 * Math.sin(t * 7.1);
    phase += (2 * Math.PI * f) / rate;
    const voice = Math.sin(phase) * 0.55 + Math.sin(phase * 2) * 0.22 + Math.sin(phase * 3.1) * 0.1;
    const breath = (Math.random() - 0.5) * 0.12;
    const sample = (voice + breath) * syllable * pause * 0.7;
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ── the conversation ────────────────────────────────────────────────────────
const { data: conv } = await db.from('conversations').select('id, org_id, project_id').eq('type', 'project').limit(1).single();
if (!conv) throw new Error('No project conversation found');
const { id: CONV, org_id: ORG, project_id: PROJECT } = conv;

const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', CONV);
if ((count ?? 0) > 0 && !process.argv.includes('--force')) {
  console.log(`Conversation already has ${count} messages — pass --force to append.`);
  process.exit(0);
}

const { data: people } = await db
  .from('profiles')
  .select('id, display_name')
  .in(
    'id',
    (await db.from('project_members').select('user_id').eq('project_id', PROJECT)).data.map((r) => r.user_id),
  );
const byName = (frag) => people.find((p) => p.display_name?.includes(frag))?.id;
const PATIENCE = byName('Patience');
const BRIAN = byName('BuildRight');
const SIPHO = byName('Spark');
if (!PATIENCE || !BRIAN || !SIPHO) throw new Error('Demo people missing from project members');

const { data: task } = await db.from('tasks').select('id, title').eq('project_id', PROJECT).ilike('title', '%clearing%').single();

// ── storage uploads ─────────────────────────────────────────────────────────
async function upload(name, buf, mime) {
  const path = `${ORG}/${PROJECT}/chat/${CONV}/${name}`;
  const { error } = await db.storage.from('chat-media').upload(path, buf, { contentType: mime, upsert: true });
  if (error) throw new Error(`upload ${name}: ${error.message}`);
  return path;
}
console.log('Uploading media…');
const photo1 = await upload('seed-cut-1.png', sitePhoto(640, 480, 7), 'image/png');
const photo2 = await upload('seed-cut-2.png', sitePhoto(640, 480, 99), 'image/png');
const photo3 = await upload('seed-cut-3.png', sitePhoto(640, 480, 1234), 'image/png');
const voice = await upload('seed-voice.wav', voiceWav(11), 'audio/wav');

// ── messages (chronological, so seq follows) ────────────────────────────────
const today = new Date();
const at = (dayOffset, h, m) => {
  const d = new Date(today);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, Math.floor(Math.random() * 50), 0);
  return d.toISOString();
};

async function msg(sender, body, createdAt, parent = null) {
  const { data, error } = await db
    .from('messages')
    .insert({ conversation_id: CONV, sender_id: sender, body, parent_message_id: parent, created_at: createdAt })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

console.log('Writing conversation…');
const m1 = await msg(
  PATIENCE,
  'Welcome everyone — this channel is the site record for Chugutu road works. Post updates, photos and blockers here so the whole team sees them. Toolbox talk is 07:00 on site each morning.',
  at(-1, 16, 40),
);
const m2 = await msg(BRIAN, 'Morning all. Cut to formation level on the first 400 m is done, starting on the culvert bedding after tea. Grader needs a new blade bolt — sorted by the fitter.', at(0, 7, 58));
const m3 = await msg(BRIAN, 'Photos from the eastern end this morning.', at(0, 8, 1));
await db.from('message_attachments').insert(
  [
    [photo1, 7],
    [photo2, 9],
    [photo3, 11],
  ].map(([p, min]) => ({
    message_id: m3,
    kind: 'image',
    storage_path: p,
    mime: 'image/png',
    filename: p.split('/').pop(),
    size_bytes: 180_000,
    width: 640,
    height: 480,
    lat: -18.1305,
    lng: 30.1418,
    taken_at: at(0, 7, min),
  })),
);
// Thread under the photos.
await msg(PATIENCE, 'Good progress. Is the drainage line pegged out before you bed the culvert?', at(0, 8, 15), m3);
await msg(BRIAN, 'Pegged yesterday with the surveyor — offset pegs are in at 10 m centres.', at(0, 8, 22), m3);

const m4 = await msg(SIPHO, null, at(0, 9, 12));
await db.from('message_attachments').insert({
  message_id: m4,
  kind: 'audio',
  storage_path: voice,
  mime: 'audio/wav',
  filename: 'voice-note.wav',
  size_bytes: 352_000,
  duration_seconds: 11,
});

const m5 = await msg(
  PATIENCE,
  `@Brian let's get the clearing crew onto the western section this week so the paving team isn't waiting.`,
  at(0, 10, 5),
);
if (task) {
  await db.from('message_links').insert({ message_id: m5, target_type: 'task', target_id: task.id, created_by: PATIENCE });
}
await db.from('message_mentions').insert({ message_id: m5, mentioned_user_id: BRIAN });

// Reactions + pin.
await db.from('message_reactions').insert([
  { message_id: m2, user_id: PATIENCE, emoji: '👍' },
  { message_id: m2, user_id: SIPHO, emoji: '👍' },
  { message_id: m3, user_id: PATIENCE, emoji: '🎉' },
  { message_id: m5, user_id: BRIAN, emoji: '✅' },
]);
await db.from('message_pins').insert({ message_id: m1, pinned_by: PATIENCE });

console.log('Seeded chat demo into conversation', CONV);
