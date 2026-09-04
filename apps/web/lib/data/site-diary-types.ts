/** Client-safe site-diary types. Kept out of the server-only `site-diary.ts` so
 *  client components (the diary composer, the entry list) can import the shapes
 *  without pulling a server module into the browser bundle. */

export interface DiaryPhoto {
  id: string;
  url: string | null; // short-lived signed URL from project-media
  caption: string | null;
  uploadedBy: string | null;
}

export interface SiteDiaryEntry {
  id: string;
  projectId: string;
  entryDate: string; // YYYY-MM-DD
  weather: string | null;
  temperature: number | null;
  labourCount: number | null;
  plant: string | null;
  deliveries: string | null;
  notes: string | null;
  hseIncidents: number | null;
  hseNearMisses: number | null;
  hseToolboxTalk: string | null;
  hseNotes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  photos: DiaryPhoto[];
}
