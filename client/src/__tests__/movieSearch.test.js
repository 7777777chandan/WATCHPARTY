import { describe, expect, it } from 'vitest';
import { fuzzySearch, mergeById } from '../utils/movieSearch.js';

const pool = [
  { id: 1, title: 'Inception', overview: 'A thief who steals corporate secrets through dream-sharing technology.' },
  { id: 2, title: 'Interstellar', overview: 'Explorers travel through a wormhole in space.' },
  { id: 3, title: 'The Dark Knight', overview: 'Batman faces the Joker in Gotham.' },
  { id: 4, title: 'Spirited Away', overview: 'A girl wanders into a world of spirits.' },
];

describe('fuzzySearch', () => {
  it('tolerates typos', () => {
    expect(fuzzySearch(pool, 'inceptoin')[0].id).toBe(1);
    expect(fuzzySearch(pool, 'intersteller')[0].id).toBe(2);
    expect(fuzzySearch(pool, 'dark nite')[0].id).toBe(3);
  });
  it('also matches the overview, ranked below title matches', () => {
    expect(fuzzySearch(pool, 'joker')[0].id).toBe(3);
  });
  it('dedupes merged lists', () => {
    expect(mergeById([pool[0], pool[1]], [pool[1], pool[2]]).map((m) => m.id)).toEqual([1, 2, 3]);
  });
});
