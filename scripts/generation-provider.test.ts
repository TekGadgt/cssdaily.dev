import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGenerationProvider, readProviderConfig } from './generation-provider';

const schema = z.object({ value: z.string() });
const options = {
  system: 'System instructions',
  messages: [{ role: 'user' as const, content: 'Generate' }],
  maxOutputTokens: 8000,
  schema,
  schemaName: 'test_output',
  parseAnthropic: (text: string) => ({ value: text.match(/<value>(.*?)<\/value>/)?.[1] ?? (() => { throw new Error('bad XML'); })() }),
};

function openAIClient(parse: ReturnType<typeof vi.fn>): OpenAI {
  return { responses: { parse } } as unknown as OpenAI;
}

function anthropicClient(create: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { create } } as unknown as Anthropic;
}

describe('provider configuration', () => {
  it('defaults to OpenAI Terra', () => {
    expect(readProviderConfig({})).toEqual({ provider: 'openai', model: 'gpt-5.6-terra' });
  });

  it('uses an explicit provider and model without inferring either', () => {
    expect(readProviderConfig({ AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-sonnet-4-6' }))
      .toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('rejects unsupported providers and blank models', () => {
    expect(() => readProviderConfig({ AI_PROVIDER: 'other' })).toThrow(/Unsupported AI_PROVIDER/);
    expect(() => readProviderConfig({ AI_MODEL: ' ' })).toThrow(/must not be empty/);
  });
});

describe('OpenAI adapter', () => {
  it('translates requests and returns parsed structured output', async () => {
    const parse = vi.fn().mockResolvedValue({
      status: 'completed',
      output_text: '{"value":"ok"}',
      output_parsed: { value: 'ok' },
      output: [],
    });
    const anthropicCreate = vi.fn();
    const provider = createGenerationProvider(
      { AI_PROVIDER: 'openai', AI_MODEL: 'gpt-test' },
      { openai: openAIClient(parse), anthropic: anthropicClient(anthropicCreate) },
    );

    await expect(provider.generateStructured(options)).resolves.toEqual({
      status: 'success', data: { value: 'ok' }, assistantContent: '{"value":"ok"}',
    });
    expect(parse).toHaveBeenCalledOnce();
    expect(parse.mock.calls[0][0]).toMatchObject({
      model: 'gpt-test',
      input: [
        { role: 'system', content: 'System instructions' },
        { role: 'user', content: 'Generate' },
      ],
      max_output_tokens: 8000,
    });
    expect(parse.mock.calls[0][0].text.format).toBeDefined();
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('reports token-limit incompletion for the retry loop', async () => {
    const parse = vi.fn().mockResolvedValue({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'partial', output: [],
    });
    const provider = createGenerationProvider({ AI_PROVIDER: 'openai' }, { openai: openAIClient(parse) });
    await expect(provider.generateStructured(options)).resolves.toEqual({ status: 'truncated', assistantContent: 'partial' });
  });

  it('returns invalid when parsed output is absent', async () => {
    const parse = vi.fn().mockResolvedValue({ status: 'completed', output_text: 'bad', output_parsed: null, output: [] });
    const provider = createGenerationProvider({ AI_PROVIDER: 'openai' }, { openai: openAIClient(parse) });
    const result = await provider.generateStructured(options);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.error.message).toMatch(/did not contain parsed/);
  });

  it('throws refusals without calling Anthropic as a fallback', async () => {
    const parse = vi.fn().mockResolvedValue({
      status: 'completed', output_text: '', output_parsed: null,
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }],
    });
    const anthropicCreate = vi.fn();
    const provider = createGenerationProvider(
      { AI_PROVIDER: 'openai' },
      { openai: openAIClient(parse), anthropic: anthropicClient(anthropicCreate) },
    );
    await expect(provider.generateStructured(options)).rejects.toThrow(/OpenAI refused/);
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('requires the OpenAI key only when the first paid request is made', async () => {
    const provider = createGenerationProvider({ AI_PROVIDER: 'openai' });
    expect(provider.provider).toBe('openai');
    await expect(provider.generateStructured(options)).rejects.toThrow(/OPENAI_API_KEY is required/);
  });
});

describe('Anthropic adapter', () => {
  it('preserves XML parsing and request translation', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '<value>ok</value>' }], stop_reason: 'end_turn',
    });
    const openAIParse = vi.fn();
    const provider = createGenerationProvider(
      { AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-test' },
      { anthropic: anthropicClient(create), openai: openAIClient(openAIParse) },
    );
    await expect(provider.generateStructured(options)).resolves.toEqual({
      status: 'success', data: { value: 'ok' }, assistantContent: '<value>ok</value>',
    });
    expect(create).toHaveBeenCalledWith({
      model: 'claude-test', max_tokens: 8000, messages: options.messages, system: options.system,
    });
    expect(openAIParse).not.toHaveBeenCalled();
  });

  it('reports Anthropic truncation and malformed XML', async () => {
    const truncated = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' });
    const truncatedProvider = createGenerationProvider(
      { AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-test' }, { anthropic: anthropicClient(truncated) },
    );
    await expect(truncatedProvider.generateStructured(options)).resolves.toEqual({ status: 'truncated', assistantContent: 'partial' });

    const malformed = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'bad' }], stop_reason: 'end_turn' });
    const malformedProvider = createGenerationProvider(
      { AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-test' }, { anthropic: anthropicClient(malformed) },
    );
    const result = await malformedProvider.generateStructured(options);
    expect(result.status).toBe('invalid');
  });

  it('requires the Anthropic key only when selected and called', async () => {
    const provider = createGenerationProvider({ AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-sonnet-4-6' });
    await expect(provider.generateStructured(options)).rejects.toThrow(/ANTHROPIC_API_KEY is required/);
  });
});
