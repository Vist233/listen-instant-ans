import { z } from 'zod'

export const agentSlotSchema = z.enum(['A', 'B'])
export type AgentSlot = z.infer<typeof agentSlotSchema>

export const transcriptFinalSchema = z.object({
  sequence: z.number().int().positive(),
  startedAtMs: z.number().int().nonnegative(),
  endedAtMs: z.number().int().nonnegative(),
  text: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
})
export type TranscriptFinal = z.infer<typeof transcriptFinalSchema>

export const qaSourceSchema = z.object({
  title: z.string().min(1),
  url: z.url(),
})

const qaResultFieldsSchema = z.object({
  status: z.enum(['ignore', 'answer', 'needs_clarification']),
  question: z.string().min(1).nullable(),
  answer: z.string().min(1).nullable(),
  sources: z.array(qaSourceSchema),
  confidence: z.number().min(0).max(1),
})

export const qaResultSchema = qaResultFieldsSchema.superRefine((value, context) => {
  if (value.status === 'ignore' && (value.question !== null || value.answer !== null)) {
    context.addIssue({ code: 'custom', message: 'ignore must not include question or answer' })
  }
  if (value.status !== 'ignore' && (value.question === null || value.answer === null)) {
    context.addIssue({ code: 'custom', message: 'non-ignore result requires question and answer' })
  }
})
export type QaResult = z.infer<typeof qaResultSchema>
export const qaResultPartialSchema = qaResultFieldsSchema.partial()

export const agentRunStatusSchema = z.enum([
  'running',
  'completed',
  'cancelled',
  'failed',
])
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>

export const sessionEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('transcript.partial'), sessionId: z.string(), text: z.string() }),
  z.object({ type: z.literal('transcript.final'), sessionId: z.string(), transcript: transcriptFinalSchema }),
  z.object({ type: z.literal('agent.started'), sessionId: z.string(), runId: z.string(), slot: agentSlotSchema }),
  z.object({ type: z.literal('qa.partial'), sessionId: z.string(), runId: z.string(), slot: agentSlotSchema, partial: qaResultPartialSchema }),
  z.object({ type: z.literal('qa.completed'), sessionId: z.string(), runId: z.string(), slot: agentSlotSchema, result: qaResultSchema }),
  z.object({ type: z.literal('agent.failed'), sessionId: z.string(), runId: z.string(), slot: agentSlotSchema, message: z.string() }),
])
export type SessionEvent = z.infer<typeof sessionEventSchema>
