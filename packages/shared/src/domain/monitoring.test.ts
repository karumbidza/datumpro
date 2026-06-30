import { describe, it, expect } from 'vitest';
import { clampProgress, mediaStoragePath } from './monitoring';

describe('clampProgress', () => {
  it('clamps to 0–100 and rounds', () => {
    expect(clampProgress(-10)).toBe(0);
    expect(clampProgress(150)).toBe(100);
    expect(clampProgress(42.6)).toBe(43);
    expect(clampProgress(Number.NaN)).toBe(0);
  });
});

describe('mediaStoragePath', () => {
  it('puts org_id first so storage RLS can authorise on it', () => {
    const path = mediaStoragePath({
      orgId: 'org-1',
      projectId: 'proj-2',
      reportId: 'rep-3',
      filename: 'photo.jpg',
    });
    expect(path).toBe('org-1/proj-2/rep-3/photo.jpg');
    expect(path.split('/')[0]).toBe('org-1');
  });
});
