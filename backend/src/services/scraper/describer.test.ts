import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The SDK is replaced wholesale: these tests are about what the describer
 * asks for and how it reads the answer (GOI-130 / GOI-131), not the network.
 */
const create = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class BadRequestError extends Error {}
  class Anthropic {
    static BadRequestError = BadRequestError;
    messages = { create };
  }
  return { default: Anthropic };
});

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicDescriber } from './describer.js';

/** The mocked class takes just a message; the real one's signature is wider. */
const badRequest = (message: string) =>
  new (Anthropic.BadRequestError as unknown as new (m: string) => Error)(message);

const text = (t: string) => ({ type: 'text', text: t });
const reply = (content: unknown[], stop_reason = 'end_turn') => ({
  content,
  stop_reason,
  usage: { input_tokens: 100, output_tokens: 20 },
});

const INPUT = {
  text: 'Trojanki. Spektakl w reżyserii…',
  url: 'https://teatr.example/spektakl/trojanki',
  title: 'Trojanki',
  note: 'Scena: scena duża',
  venue: { name: 'Teatr Powszechny', city: 'Warsaw', category: 'theatre' },
};

beforeEach(() => create.mockReset());

describe('AnthropicDescriber', () => {
  it('asks for English, offers web search, and returns the description', async () => {
    create.mockResolvedValueOnce(reply([
      text('CATEGORY: performance\nDESCRIPTION: Euripides’ tragedy of the women of Troy.'),
    ]));

    const out = await new AnthropicDescriber('key', 'model-x').describe(INPUT);

    const req = create.mock.calls[0]![0];
    expect(req.system).toMatch(/Always write the description in English/);
    expect(req.system).toMatch(/Never describe logistics/);
    expect(req.tools).toEqual([expect.objectContaining({ type: 'web_search_20260209', name: 'web_search' })]);
    expect(req.messages[0].content).toContain('Listing note: Scena: scena duża');
    expect(out).toEqual({
      description: 'Euripides’ tragedy of the women of Troy.',
      category: 'performance',
      inputTokens: 100,
      outputTokens: 20,
      searched: false,
    });
  });

  it('reports a search, and reads the text around its blocks', async () => {
    create.mockResolvedValueOnce(reply([
      text('I will look this up.'),
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Trojanki Powszechny' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
      text('CATEGORY: performance\nDESCRIPTION: A staging of '),
      text('The Trojan Women.'),
    ]));

    const out = await new AnthropicDescriber('key').describe(INPUT);

    expect(out.searched).toBe(true);
    expect(out.description).toBe('A staging of The Trojan Women.');
  });

  it('resumes a paused turn and counts every leg', async () => {
    const paused = reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], 'pause_turn');
    create
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce(reply([text('CATEGORY: screening\nDESCRIPTION: A film about bees.')]));

    const out = await new AnthropicDescriber('key').describe(INPUT);

    expect(create).toHaveBeenCalledTimes(2);
    // The paused assistant turn is handed back as-is, with no extra user turn.
    expect(create.mock.calls[1]![0].messages.at(-1)).toEqual({ role: 'assistant', content: paused.content });
    expect(out).toMatchObject({ description: 'A film about bees.', inputTokens: 200, outputTokens: 40 });
  });

  it('drops web search for good once the account rejects it', async () => {
    create
      .mockRejectedValueOnce(badRequest('web search is not enabled'))
      .mockResolvedValue(reply([text('CATEGORY: other\nDESCRIPTION: A play.')]));

    const describer = new AnthropicDescriber('key');
    expect((await describer.describe(INPUT)).description).toBe('A play.');
    await describer.describe(INPUT);

    expect(create.mock.calls[1]![0].tools).toBeUndefined();
    expect(create.mock.calls[2]![0].tools).toBeUndefined();
  });

  it('keeps web search when the 400 was about something else', async () => {
    create
      .mockRejectedValueOnce(badRequest('prompt is too long'))
      .mockRejectedValueOnce(badRequest('prompt is too long'))
      .mockResolvedValue(reply([text('CATEGORY: other\nDESCRIPTION: A play.')]));

    const describer = new AnthropicDescriber('key');
    await expect(describer.describe(INPUT)).rejects.toThrow('prompt is too long');
    await describer.describe(INPUT);

    expect(create.mock.calls[2]![0].tools).toHaveLength(1);
  });
});
