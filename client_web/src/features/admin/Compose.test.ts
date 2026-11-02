import { describe, expect, it } from 'vitest';
import { dataError, validLink } from './Compose';
describe('compose validation', () => {
  it('accepts safe relative and HTTPS links while rejecting unsafe schemes and redirects', () => {
    expect(validLink('/updates', false)).toBe(true);
    expect(validLink('https://example.test', false)).toBe(true);
    for (const link of [
      '//example.test',
      '/\\example.test',
      'javascript:alert(1)',
      'data:text/plain,x',
      'http://example.test',
    ])
      expect(validLink(link, false)).toBe(false);
    expect(validLink('http://localhost:5173', true)).toBe(true);
  });
  it('rejects reserved or duplicate data keys and long values', () => {
    expect(dataError([{ id: '1', key: 'googleThing', value: 'x' }])).toMatch(
      /reserved/,
    );
    expect(
      dataError([
        { id: '1', key: 'id', value: 'x' },
        { id: '2', key: 'id', value: 'y' },
      ]),
    ).toMatch(/Duplicate/);
    expect(
      dataError([{ id: '1', key: 'valid', value: 'x'.repeat(257) }]),
    ).toMatch(/256/);
    expect(dataError([{ id: '1', key: 'valid', value: 'ok' }])).toBe('');
  });
});
