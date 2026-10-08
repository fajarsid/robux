import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  isPageSize,
  lastPageOf,
  PAGE_SIZE_OPTIONS,
  pageWindow,
} from './pagination-model';

describe('pagination model', () => {
  it('offers 10/25/50/100 rows per page and starts at 10', () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([10, 25, 50, 100]);
    expect(DEFAULT_PAGE_SIZE).toBe(10);
    expect(isPageSize(25)).toBe(true);
    expect(isPageSize(20)).toBe(false);
  });

  it('always has at least one page', () => {
    expect(lastPageOf(0, 10)).toBe(1);
    expect(lastPageOf(10, 10)).toBe(1);
    expect(lastPageOf(11, 10)).toBe(2);
  });

  it('shows every page when there are few', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it('keeps first, last and neighbours, with gaps for the rest', () => {
    expect(pageWindow(5, 12)).toEqual([1, null, 4, 5, 6, null, 12]);
    expect(pageWindow(1, 12)).toEqual([1, 2, null, 12]);
    expect(pageWindow(12, 12)).toEqual([1, null, 11, 12]);
  });

  it('fills a single missing page instead of showing a gap', () => {
    expect(pageWindow(4, 12)).toEqual([1, 2, 3, 4, 5, null, 12]);
  });
});
