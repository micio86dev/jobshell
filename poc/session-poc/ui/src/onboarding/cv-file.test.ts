import { describe, expect, it } from 'vitest';

import { cvFileKind } from './cv-file';

describe('cvFileKind', () => {
  it('accepts a PDF, a text file and a markdown file, by name or media type', () => {
    expect(cvFileKind({ name: 'cv.pdf', type: 'application/pdf' })).toBe('pdf');
    expect(cvFileKind({ name: 'cv.txt', type: 'text/plain' })).toBe('text');
    expect(cvFileKind({ name: 'cv.md', type: '' })).toBe('text');
  });

  it('refuses any other file, so no document is read as a CV by mistake', () => {
    expect(cvFileKind({ name: 'cv.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBeNull();
    expect(cvFileKind({ name: 'photo.png', type: 'image/png' })).toBeNull();
  });
});

