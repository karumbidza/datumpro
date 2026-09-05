-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — enforce upload size limits on the two unbounded buckets
--
-- Production audit: `project-media` and `chat-media` were created with no
-- file_size_limit (avatars = 5 MB and org-logos = 2 MB already have theirs),
-- so any authenticated member could upload arbitrarily large files — a cost
-- and abuse risk. Cap them server-side; the apps add matching client-side
-- checks for a friendly error before the request is even sent.
--
-- MIME types stay unrestricted on these two: project-media legitimately holds
-- photos, PDFs, drawings and office documents; chat-media mirrors what members
-- attach in conversation.
-- ─────────────────────────────────────────────────────────────────────────────

-- Site photos, drawings, task/report documents: 50 MB per object.
update storage.buckets set file_size_limit = 52428800 where id = 'project-media';

-- Chat attachments: 25 MB per object.
update storage.buckets set file_size_limit = 26214400 where id = 'chat-media';
