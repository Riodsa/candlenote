"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Globe, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Account, api } from "@/lib/api";
import { useFxRates } from "@/hooks/useFxRates";
import { convertCurrency, getUnitsPerUsd } from "@/lib/format";

function SettingsForm({ acct }: { acct: Account }) {
  const qc = useQueryClient();
  const fx = useFxRates();
  const [name, setName] = useState(acct.name);
  const [currency, setCurrency] = useState(acct.currency);
  const [serverOffset, setServerOffset] = useState(String(acct.server_utc_offset));
  const [displayTz, setDisplayTz] = useState(acct.display_timezone);
  // DB stores initial_balance in acct.base_currency; show it in the selected display currency.
  const [initialBalance, setInitialBalance] = useState(() => {
    const raw = Number(acct.initial_balance);
    if (Number.isNaN(raw) || raw === 0) return "0";
    return convertCurrency(raw, acct.base_currency, acct.currency).toFixed(2);
  });
  const [revengeMin, setRevengeMin] = useState(String(acct.tilt_revenge_minutes ?? 5));
  const [sizeUpMult, setSizeUpMult] = useState(String(Number(acct.tilt_size_up_multiplier ?? 1.5)));
  const [maxLossStreak, setMaxLossStreak] = useState(String(acct.tilt_max_loss_streak ?? 3));

  const handleCurrencyChange = (nextCurrency: string) => {
    const curBal = Number(initialBalance);
    if (!Number.isNaN(curBal) && curBal !== 0) {
      const converted = convertCurrency(curBal, currency, nextCurrency);
      setInitialBalance(converted.toFixed(2));
    }
    setCurrency(nextCurrency);
  };

  const save = useMutation({
    mutationFn: () => {
      const displayed = Number(initialBalance) || 0;
      const baseBal = Number(convertCurrency(displayed, currency, acct.base_currency).toFixed(2));
      return api.updateAccount({
        name,
        currency,
        server_utc_offset: Number(serverOffset) || 0,
        display_timezone: displayTz,
        initial_balance: baseBal,
        tilt_revenge_minutes: Math.max(1, Math.min(240, Math.round(Number(revengeMin) || 5))),
        tilt_size_up_multiplier: Math.max(1.05, Math.min(10, Number(sizeUpMult) || 1.5)),
        tilt_max_loss_streak: Math.max(1, Math.min(20, Math.round(Number(maxLossStreak) || 3))),
      });
    },
    onSuccess: (updated) => {
      toast.success(`Settings saved — values converted to ${updated.currency}`);
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["imports"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const thbRate = getUnitsPerUsd("THB").toFixed(2);
  const eurRate = getUnitsPerUsd("EUR").toFixed(2);
  const rateSource = fx?.source === "frankfurter" ? "live ECB" : "default";

  return (
    <Card className="rounded-3xl border-border/70 bg-card/85 shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-extrabold">
          <Settings2 className="size-5 text-indigo-400" />
          Main Trading Account Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground">Account Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground">
              Display Currency (Report base currency: <strong>{acct.base_currency}</strong> &mdash; auto-converts P/L)
            </label>
            <select
              value={currency}
              onChange={(e) => handleCurrencyChange(e.target.value)}
              className="flex h-9 w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold"
            >
              <option value="USC">USC (US Cent &mdash; 100 USC = 1 USD)</option>
              <option value="USD">USD (US Dollar &mdash; divides USC by 100)</option>
              <option value="THB">THB (Thai Baht &mdash; {thbRate} THB / USD, {rateSource})</option>
              <option value="EUR">EUR (Euro &mdash; {eurRate} EUR / USD, {rateSource})</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground">
              Display Timezone (Thailand GMT+7 default)
            </label>
            <select
              value={displayTz}
              onChange={(e) => setDisplayTz(e.target.value)}
              className="flex h-9 w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold"
            >
              <option value="Asia/Bangkok">Asia/Bangkok (GMT+7 Thailand)</option>
              <option value="UTC">UTC (GMT+0)</option>
              <option value="America/New_York">America/New_York (EST/EDT)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground">
              MT5 Broker Server Offset from UTC (minutes, e.g. 0 for Exness UTC, 120 for GMT+2)
            </label>
            <Input
              type="number"
              value={serverOffset}
              onChange={(e) => setServerOffset(e.target.value)}
              className="rounded-xl font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground">Initial Balance ({currency})</label>
            <Input
              type="number"
              step="0.01"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
              className="rounded-xl font-mono"
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-border/60 pt-4">
          <div className="flex items-center gap-2 text-sm font-extrabold">
            <AlertTriangle className="size-4 text-amber-400" />
            Tilt &amp; Discipline Detection Rules (Same-Day)
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Revenge Window (minutes after loss)</label>
              <Input
                type="number"
                min={1}
                max={240}
                value={revengeMin}
                onChange={(e) => setRevengeMin(e.target.value)}
                className="rounded-xl font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Lot Size-Up Threshold (x after loss)</label>
              <Input
                type="number"
                step="0.1"
                min={1.05}
                max={10}
                value={sizeUpMult}
                onChange={(e) => setSizeUpMult(e.target.value)}
                className="rounded-xl font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Max Consecutive Losses / Day</label>
              <Input
                type="number"
                min={1}
                max={20}
                value={maxLossStreak}
                onChange={(e) => setMaxLossStreak(e.target.value)}
                className="rounded-xl font-mono"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/60 pt-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Globe className="size-3.5 text-teal-400" />
            Broker: {acct.broker ?? "Not set"} &middot; Login: {acct.mt5_login ?? "Not set"} &middot; Native Report
            Currency: <strong>{acct.base_currency}</strong>
          </p>
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-full px-6 font-bold">
            <Save className="mr-2 size-4" />
            {save.isPending ? "Saving\u2026" : "Save Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const q = useQuery({ queryKey: ["account"], queryFn: api.account });

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/70 bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-teal-500/10 p-6">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Account &amp; Timezone Settings</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Configure your display timezone (GMT+7 Bangkok), MT5 server time offset, and currency conversion.
        </p>
      </div>

      {q.isLoading && <Skeleton className="h-64 w-full rounded-3xl" />}
      {q.data && (
        <SettingsForm
          key={`${q.data.currency}-${q.data.mt5_login}-${q.data.initial_balance}-${q.data.tilt_revenge_minutes}-${q.data.tilt_size_up_multiplier}-${q.data.tilt_max_loss_streak}`}
          acct={q.data}
        />
      )}
    </div>
  );
}
