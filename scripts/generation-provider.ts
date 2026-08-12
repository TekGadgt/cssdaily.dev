import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { ZodType } from 'zod';

export type AIProvider = 'openai' | 'anthropic';
export type GenerationRole = 'user' | 'assistant';

export interface GenerationMessage {
  role: GenerationRole;
  content: string;
}

export interface GenerateStructuredOptions<T> {
  system: string;
  messages: GenerationMessage[];
  maxOutputTokens: number;
  schema: ZodType<T>;
  schemaName: string;
  parseAnthropic: (text: string) => T;
}

export type GenerationResult<T> =
  | { status: 'success'; data: T; assistantContent: string }
  | { status: 'truncated'; assistantContent: string }
  | { status: 'invalid'; assistantContent: string; error: Error };

export interface GenerationProvider {
  provider: AIProvider;
  model: string;
  generateStructured<T>(options: GenerateStructuredOptions<T>): Promise<GenerationResult<T>>;
}

export interface ProviderClients {
  openai?: OpenAI;
  anthropic?: Anthropic;
}

function requiredKey(env: NodeJS.ProcessEnv, key: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY'): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required when AI_PROVIDER selects this provider`);
  return value;
}

export function readProviderConfig(env: NodeJS.ProcessEnv = process.env): { provider: AIProvider; model: string } {
  const rawProvider = (env.AI_PROVIDER ?? 'openai').trim().toLowerCase();
  if (rawProvider !== 'openai' && rawProvider !== 'anthropic') {
    throw new Error(`Unsupported AI_PROVIDER "${rawProvider}"; expected "openai" or "anthropic"`);
  }

  const model = (env.AI_MODEL ?? 'gpt-5.6-terra').trim();
  if (!model) throw new Error('AI_MODEL must not be empty');
  return { provider: rawProvider, model };
}

/**
 * Creates a provider selected entirely by environment configuration.
 * SDK clients are constructed on the first paid request, so completed-date
 * no-op runs never require credentials and never contact either provider.
 */
export function createGenerationProvider(
  env: NodeJS.ProcessEnv = process.env,
  clients: ProviderClients = {}
): GenerationProvider {
  const config = readProviderConfig(env);
  let openai = clients.openai;
  let anthropic = clients.anthropic;

  return {
    ...config,
    async generateStructured<T>(options: GenerateStructuredOptions<T>): Promise<GenerationResult<T>> {
      if (config.provider === 'openai') {
        const client = openai ??= new OpenAI({ apiKey: requiredKey(env, 'OPENAI_API_KEY') });
        const response = await client.responses.parse({
          model: config.model,
          input: [
            { role: 'system', content: options.system },
            ...options.messages.map((message) => ({ role: message.role, content: message.content })),
          ],
          max_output_tokens: options.maxOutputTokens,
          text: { format: zodTextFormat(options.schema, options.schemaName) },
        });

        const assistantContent = response.output_text ?? '';
        if (response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') {
          return { status: 'truncated', assistantContent };
        }

        const refusal = response.output
          ?.flatMap((item: any) => item.type === 'message' ? item.content ?? [] : [])
          .find((item: any) => item.type === 'refusal');
        if (refusal) throw new Error(`OpenAI refused the generation request: ${refusal.refusal}`);
        if (!response.output_parsed) {
          return {
            status: 'invalid',
            assistantContent,
            error: new Error('OpenAI response did not contain parsed structured output'),
          };
        }

        return {
          status: 'success',
          data: response.output_parsed as T,
          // Structured responses are replayed as JSON on stateless retries.
          assistantContent: assistantContent || JSON.stringify(response.output_parsed),
        };
      }

      const client = anthropic ??= new Anthropic({ apiKey: requiredKey(env, 'ANTHROPIC_API_KEY') });
      const response = await client.messages.create({
        model: config.model,
        max_tokens: options.maxOutputTokens,
        messages: options.messages,
        system: options.system,
      });
      const block = response.content?.[0];
      if (!block || block.type !== 'text') {
        throw new Error(`Unexpected Anthropic response content: ${JSON.stringify(response.content).substring(0, 200)}`);
      }
      if (response.stop_reason === 'max_tokens') {
        return { status: 'truncated', assistantContent: block.text };
      }

      try {
        return {
          status: 'success',
          data: options.parseAnthropic(block.text),
          assistantContent: block.text,
        };
      } catch (error) {
        return {
          status: 'invalid',
          assistantContent: block.text,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  };
}
