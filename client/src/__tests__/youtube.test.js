import { describe, expect, it } from 'vitest';
import { formatTime, parseYouTubeId } from '../utils/youtube.js';

describe('parseYouTubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('%s', (url, id) => expect(parseYouTubeId(url)).toBe(id));

  it.each(['https://vimeo.com/123', 'https://youtube.com/watch?v=short', 'hello', '', null])('rejects %s', (bad) => {
    expect(parseYouTubeId(bad)).toBeNull();
  });

  it('formats time', () => {
    expect(formatTime(150)).toBe('2:30');
    expect(formatTime(3725)).toBe('1:02:05');
  });
});
