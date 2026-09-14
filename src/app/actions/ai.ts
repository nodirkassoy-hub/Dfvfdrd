"use server";

import { requireContext } from "@/lib/auth/guard";
import { attempt, str, type ActionState } from "@/lib/actions/support";
import { answerQuestion, periodFromParams, type AiAnswer } from "@/lib/services/intelligence";

export type AskResult = { ok: boolean; error?: string; answer?: AiAnswer };

export async function askAiAction(_prev: AskResult | undefined, form: FormData): Promise<AskResult> {
  const context = await requireContext();
  const question = str(form, "question");
  if (question.trim().length < 3) return { ok: false, error: "Type a question about your finances." };
  const period = periodFromParams(context.company.id, { preset: str(form, "period", "this_month") }, context.locale);
  const result = await attempt(() =>
    answerQuestion(
      {
        companyId: context.company.id,
        companyName: context.company.name,
        currency: context.currency,
        locale: context.locale,
        period,
      },
      question,
    ),
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, answer: result.data as AiAnswer };
}
