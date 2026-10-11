import { randomUUID } from "node:crypto";
import { generateObject, streamObject, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { reasoningHash, type Forecast, type JudgeOutput, type PersonaName, type PersonaOutput } from "@cassandra/shared";
import { config } from "../config.js";
import { bus, log } from "../bus.js";
import { contextSnippets } from "./context.js";
import { PERSONAS, JUDGE_SYSTEM } from "./prompts.js";

export const PersonaSchema = z.object({
  probability: z.number().min(0).max(1).describe("Probability that the YES side resolves true"),
  confidence: z.number().min(0).max(1),
  argument: z.string().describe("At most 70 words"),
  cruxes: z.array(z.string().describe("Under 12 words")).max(3),
});
export const JudgeSchema = z.object({
  probability: z.number().min(0).max(1),
  lo80: z.number().min(0).max(1),
  hi80: z.number().min(0).max(1),
  rationale: z.string().describe("At most 80 words. First sentence: 'Market X%, council Y%', then why they differ"),
  whatWouldChangeMyMind: z.array(z.string().describe("One observable with a threshold and a date")).max(4),
  biasHints: z.array(z.string().describe("Exactly one of: overround, favoriteLongshot, roundNumberAnchoring, herding, recencyShock")).max(4),
});

export interface CouncilContext {
  symbol: string; eventTitle: string; contractLabel: string; description: string | null; category: string;
  daysToResolution: number | null; expiryDate: string | null; midBps: number; bidBps: number | null; askBps: number | null;
  siblings: { label: string; midBps: number | null }[]; pricePath: string; biasSummary: string;
}

export const llmLive = !config.llm.dryRun;
let model: LanguageModel | null = null;
function getModel(): LanguageModel {
  if (!model) {
    model = config.llm.provider === "openai"
      ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(config.llm.model)
      : createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(config.llm.model);
  }
  return model;
}

const pct = (bps: number | null) => (bps == null ? "n/a" : `${(bps / 100).toFixed(1)}%`);
export function contextBlock(c: CouncilContext): string {
  return [
    `Market: ${c.eventTitle}`,
    `Contract (YES side): ${c.contractLabel}  [${c.symbol}]`,
    c.description ? `Resolution rules: ${c.description.slice(0, 900)}` : "",
    `Category: ${c.category}. Resolves ${c.expiryDate ?? "at an unspecified date"}${c.daysToResolution != null ? ` (${c.daysToResolution.toFixed(1)} days from now)` : ""}.`,
    `Now (UTC): ${new Date().toISOString()}`,
    `Market YES price: mid ${pct(c.midBps)}, bid ${pct(c.bidBps)}, ask ${pct(c.askBps)}.`,
    c.siblings.length ? `Other contracts on this event:\n${c.siblings.slice(0, 14).map((s) => `  - ${s.label}: ${pct(s.midBps)}`).join("\n")}` : "",
    `24h price path: ${c.pricePath}`,
    `Deterministic bias scan: ${c.biasSummary}`,
  ].filter(Boolean).join("\n");
}

const runTimes: number[] = [];
const forcedTimes: number[] = [];
/** Button presses ("Run a new forecast") draw from their own hourly pool so the automatic loop can't starve them. */
const FORCED_PER_HOUR = 8;
export function councilBudgetLeft(forced = false): number {
  const cutoff = Date.now() - 3600_000;
  const times = forced ? forcedTimes : runTimes;
  while (times.length && times[0]! < cutoff) times.shift();
  return (forced ? FORCED_PER_HOUR : config.councilMaxRunsPerHour) - times.length;
}

export interface CouncilResult { forecast: Forecast; personas: Record<PersonaName, PersonaOutput>; judge: JudgeOutput }

/** Four adversarial personas stream in parallel, then the Judge aggregates. Streams council.delta / council.final over SSE. */
export async function runCouncil(ctx: CouncilContext, runId = randomUUID(), forced = false): Promise<CouncilResult> {
  if (!llmLive) throw new Error("LLM is in dry-run mode (no ANTHROPIC_API_KEY/OPENAI_API_KEY or DRY_RUN_LLM=true); refusing to fabricate a forecast");
  if (councilBudgetLeft(forced) <= 0) throw new Error(forced ? `manual forecast limit (${FORCED_PER_HOUR}/hour) reached` : `COUNCIL_MAX_RUNS_PER_HOUR=${config.councilMaxRunsPerHour} reached`);
  const times = forced ? forcedTimes : runTimes;
  const at = Date.now();
  times.push(at);
  try {
    return await councilRun(ctx, runId);
  } catch (e) {
    // a run that produced no forecast gives its slot back
    const i = times.indexOf(at);
    if (i >= 0) times.splice(i, 1);
    throw e;
  }
}

async function councilRun(ctx: CouncilContext, runId: string): Promise<CouncilResult> {
  const block = contextBlock(ctx);
  const snippets = config.contextDevKey ? await contextSnippets(`${ctx.eventTitle} ${ctx.contractLabel}`).catch(() => []) : [];

  const personas = await Promise.all(PERSONAS.map(async (p) => {
    const extra = p.name === "reporter"
      ? snippets.length
        ? `\n\nFresh web context (Context.dev, fetched ${new Date().toISOString()}):\n${snippets.map((s, i) => `[${i + 1}] ${s}`).join("\n")}`
        : "\n\nNo web context is available this run. Work only from the price path and say so."
      : "";
    const res = streamObject({
      model: getModel(), schema: PersonaSchema, maxOutputTokens: 700, maxRetries: 1, reasoning: "none",
      system: p.system, prompt: `${block}${extra}\n\nGive your probability for YES.`,
    });
    let lastLen = 0;
    for await (const partial of res.partialObjectStream) {
      const text = partial.argument ?? "";
      if (text.length > lastLen) {
        bus.emit({ type: "council.delta", symbol: ctx.symbol, runId, persona: p.name, text: text.slice(lastLen) });
        lastLen = text.length;
      }
    }
    const output = (await res.object) as PersonaOutput;
    bus.emit({ type: "council.persona", symbol: ctx.symbol, runId, persona: p.name, output });
    return [p.name, output] as const;
  }));
  const byName = Object.fromEntries(personas) as Record<PersonaName, PersonaOutput>;

  const judgeRes = await generateObject({
    model: getModel(), schema: JudgeSchema, maxOutputTokens: 1200, maxRetries: 1, reasoning: "none",
    system: JUDGE_SYSTEM,
    prompt: `${block}\n\nPersona forecasts:\n${personas.map(([n, o]) => `${n}: p=${o.probability.toFixed(3)} conf=${o.confidence.toFixed(2)}\n  ${o.argument}\n  cruxes: ${o.cruxes.join("; ")}`).join("\n")}`,
  });
  const j = judgeRes.object;
  const judge: JudgeOutput = { ...j, lo80: Math.min(j.lo80, j.probability), hi80: Math.max(j.hi80, j.probability) };
  bus.emit({ type: "council.delta", symbol: ctx.symbol, runId, persona: "judge", text: judge.rationale });

  const hash = reasoningHash(byName, judge);
  const forecast: Forecast = {
    id: runId, symbol: ctx.symbol, createdAt: Date.now(), marketMidBps: ctx.midBps, pBps: Math.round(judge.probability * 10000),
    loBps: Math.round(judge.lo80 * 10000), hiBps: Math.round(judge.hi80 * 10000), personas: byName, judge, reasoningHash: hash,
    model: config.llm.model, source: "live",
  };
  log("info", `council ${ctx.symbol}: market ${pct(ctx.midBps)} → judge ${pct(forecast.pBps)} [${pct(forecast.loBps)}–${pct(forecast.hiBps)}]`);
  return { forecast, personas: byName, judge };
}
