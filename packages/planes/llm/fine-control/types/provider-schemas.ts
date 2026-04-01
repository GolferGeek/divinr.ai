import { z } from 'zod';

export const openAIChatCompletionSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z
    .array(
      z.object({
        index: z.number(),
        finish_reason: z
          .enum([
            'stop',
            'length',
            'tool_calls',
            'content_filter',
            'function_call',
          ])
          .nullable()
          .optional(),
        message: z.object({
          role: z.string(),
          content: z.string().nullable(),
        }),
        logprobs: z.unknown().optional(),
      }),
    )
    .nonempty(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
  system_fingerprint: z.string().nullable().optional(),
});

export type OpenAIChatCompletionParsed = z.infer<
  typeof openAIChatCompletionSchema
>;

export const anthropicMessageSchema = z.object({
  id: z.string(),
  model: z.string(),
  content: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
      }),
    )
    .nonempty(),
  stop_reason: z
    .enum(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use'])
    .nullable()
    .optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

export type AnthropicMessageParsed = z.infer<typeof anthropicMessageSchema>;

export const ollamaResponseSchema = z.object({
  model: z.string(),
  response: z.string(),
  done: z.boolean(),
  created_at: z.string(),
  thinking: z.string().optional(),
  total_duration: z.number().optional(),
  load_duration: z.number().optional(),
  prompt_eval_count: z.number().optional(),
  prompt_eval_duration: z.number().optional(),
  eval_count: z.number().optional(),
  eval_duration: z.number().optional(),
});

export type OllamaResponseParsed = z.infer<typeof ollamaResponseSchema>;
