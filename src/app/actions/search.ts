"use server";

import { requireContext } from "@/lib/auth/guard";
import { globalSearch, type SearchHit } from "@/lib/services/operations";

export async function searchAction(query: string): Promise<SearchHit[]> {
  const context = await requireContext();
  return globalSearch(context.company.id, query);
}
