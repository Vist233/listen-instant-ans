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

export const agentRunStatusSchema = z.enum(['running', 'completed', 'cancelled'])
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>

export const qaStatusSchema = z.enum(['shown', 'duplicate'])
export type QaStatus = z.infer<typeof qaStatusSchema>

const sessionId = z.string()
const runFields = { sessionId, runId: z.string(), slot: agentSlotSchema }

export const sessionEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('listening.started'), sessionId, microphoneDevice: z.string() }),
  z.object({ type: z.literal('listening.stopped'), sessionId }),
  z.object({ type: z.literal('listening.failed'), sessionId, message: z.string() }),
  z.object({ type: z.literal('transcript.partial'), sessionId, text: z.string() }),
  z.object({ type: z.literal('transcript.final'), sessionId, transcript: transcriptFinalSchema }),
  z.object({ type: z.literal('agent.started'), ...runFields }),
  z.object({ type: z.literal('qa.partial'), ...runFields, question: z.string(), answer: z.string() }),
  z.object({ type: z.literal('qa.completed'), ...runFields, qaId: z.number().int(), question: z.string(), answer: z.string() }),
  z.object({ type: z.literal('agent.finished'), ...runFields }),
  z.object({ type: z.literal('agent.failed'), ...runFields, message: z.string() }),
])
export type SessionEvent = z.infer<typeof sessionEventSchema>
