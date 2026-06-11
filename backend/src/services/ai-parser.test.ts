import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Anthropic SDK so no real API call is ever made. The factory is
// hoisted, so the spy is created via vi.hoisted to be referenceable inside it.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
    constructor(_opts: unknown) {}
  },
}));

// Provide a key so the lazy client constructs; it never hits the network.
vi.mock('../config.js', () => ({ env: { ANTHROPIC_API_KEY: 'test-key' } }));

import { extractJson, parseEventsFromHtml } from './ai-parser.js';

function aiResponse(events: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(events) }] };
}

const validEntry = {
  title: 'Perfect Days',
  description: null,
  startsAt: '2026-06-01T18:00:00.000Z',
  endsAt: null,
  durationMinutes: 124,
  director: 'Wim Wenders',
  genre: 'Drama',
  priceMin: 28,
  priceMax: 32,
  link: 'https://muranow.example/perfect-days',
};

describe('extractJson', () => {
  it('parses raw JSON', () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('parses JSON wrapped in a fenced code block', () => {
    const text = 'sure:\n```json\n[{"title":"x"}]\n```';
    expect(extractJson(text)).toEqual([{ title: 'x' }]);
  });

  it('throws on non-JSON text', () => {
    expect(() => extractJson('definitely not json')).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => extractJson('')).toThrow();
  });
});

describe('parseEventsFromHtml', () => {
  beforeEach(() => createMock.mockReset());

  it('returns validated events for a well-formed Claude response', async () => {
    createMock.mockResolvedValue(aiResponse([validEntry]));
    const events = await parseEventsFromHtml('<html>...</html>', 'https://muranow.example');
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe('Perfect Days');
    expect(events[0]!.cast).toEqual([]); // zod default applied
    expect(createMock).toHaveBeenCalledOnce();
  });

  it('handles a fenced JSON array from Claude', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '```json\n' + JSON.stringify([validEntry]) + '\n```' }],
    });
    const events = await parseEventsFromHtml('<html>...</html>', 'https://muranow.example');
    expect(events).toHaveLength(1);
  });

  it('throws when Claude returns an entry missing required fields', async () => {
    const bad = { description: null, startsAt: '2026-06-01T18:00:00.000Z' }; // no title/link
    createMock.mockResolvedValue(aiResponse([bad]));
    await expect(parseEventsFromHtml('<html>...</html>', 'https://x')).rejects.toThrow(
      /invalid event payload/i,
    );
  });
});
