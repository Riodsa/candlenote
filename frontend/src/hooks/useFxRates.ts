"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { setFxRates } from "@/lib/format";

/** Fetches cached FX rates from the backend and syncs format.ts conversion rates. */
export function useFxRates() {
  const q = useQuery({
    queryKey: ["fx-rates"],
    queryFn: async () => {
      const res = await api.fxRates();
      setFxRates(res.usd_per_unit);
      return res;
    },
    staleTime: 30 * 60_000,
  });
  if (q.data) setFxRates(q.data.usd_per_unit);
  return q.data;
}
