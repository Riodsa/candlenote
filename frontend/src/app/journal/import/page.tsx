"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ImportResponse } from "@/lib/api";
import { useFxRates } from "@/hooks/useFxRates";
import { formatCurrency, formatDateTimeTz, getTzShortLabel } from "@/lib/format";

export default function ImportPage() {
  const qc = useQueryClient();
  useFxRates();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResponse | null>(null);

  const history = useQuery({ queryKey: ["imports"], queryFn: api.imports });
  const account = useQuery({ queryKey: ["account"], queryFn: api.account });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadImport(file),
    onSuccess: (res) => {
      setLastResult(res);
      qc.invalidateQueries({ queryKey: ["imports"] });
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      if (res.already_imported) {
        toast.info("This exact report file was already imported earlier (0 duplicates added).");
      } else {
        toast.success(`Imported ${res.import_record.rows_inserted} new trades!`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    upload.mutate(file);
  };

  const currency = lastResult?.account.currency ?? account.data?.currency ?? "USD";
  const baseCurrency = lastResult?.account.base_currency ?? account.data?.base_currency ?? currency;
  const tz = account.data?.display_timezone ?? "Asia/Bangkok";
  const tzShort = getTzShortLabel(tz);

  return (
    <div className="space-y-6">
      <Link
        href="/journal"
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3.5 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Trade Journal
      </Link>

      <div className="rounded-3xl border border-border/70 bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-teal-500/10 p-6">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Import MT5 Trade History</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Upload a MetaTrader 5 Trade History Report (<code>.html</code> or <code>.xlsx</code>). Positions and Deals
          are deduplicated by Ticket ID, and account currency (e.g. <strong>USD</strong> or <strong>USC</strong>) is
          detected automatically.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-12 text-center transition-all ${
          dragging
            ? "border-primary bg-primary/10 scale-[1.01]"
            : "border-border/70 bg-card/70 hover:border-primary/60 hover:bg-accent/30"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".html,.htm,.xlsx,.xlsm"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500/20 via-violet-500/20 to-teal-500/20 text-indigo-400 shadow-inner">
          <UploadCloud className="size-8" />
        </div>
        <p className="mt-4 text-lg font-extrabold">
          {upload.isPending ? "Parsing & importing MT5 report\u2026" : "Drop your MT5 report here, or click to browse"}
        </p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          Supports UTF-16 / UTF-8 <code>.html</code> and <code>.xlsx</code> exports up to 10 MB
        </p>
        <Button
          type="button"
          disabled={upload.isPending}
          className="mt-5 rounded-full px-6 font-bold"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <FileSpreadsheet className="mr-2 size-4" />
          Choose Report File
        </Button>
      </div>

      {lastResult && (
        <div className="rounded-3xl border border-emerald-500/35 bg-emerald-500/10 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-lg">
              <CheckCircle2 className="size-5" />
              <span>
                {lastResult.already_imported
                  ? "File Already Imported (Deduplicated)"
                  : "Import Complete & Verified"}
              </span>
            </div>
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">
              Account #{lastResult.account.mt5_login ?? "Default"} &middot; {lastResult.account.currency}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-sm">
            <div className="rounded-2xl bg-card/80 p-3">
              <span className="text-xs font-semibold text-muted-foreground">Positions Found</span>
              <p className="mt-1 font-mono text-xl font-bold">{lastResult.import_record.rows_total}</p>
            </div>
            <div className="rounded-2xl bg-card/80 p-3">
              <span className="text-xs font-semibold text-muted-foreground">New Inserted</span>
              <p className="mt-1 font-mono text-xl font-bold text-emerald-400">
                +{lastResult.import_record.rows_inserted}
              </p>
            </div>
            <div className="rounded-2xl bg-card/80 p-3">
              <span className="text-xs font-semibold text-muted-foreground">Duplicates Skipped</span>
              <p className="mt-1 font-mono text-xl font-bold text-amber-400">
                {lastResult.import_record.rows_duplicate}
              </p>
            </div>
            <div className="rounded-2xl bg-card/80 p-3">
              <span className="text-xs font-semibold text-muted-foreground">Parsed Net P/L</span>
              <p className="mt-1 font-mono text-base font-bold">
                {formatCurrency(lastResult.import_record.parsed_net_pnl, currency, true, baseCurrency)}
              </p>
            </div>
            <div className="rounded-2xl bg-card/80 p-3">
              <span className="text-xs font-semibold text-muted-foreground">MT5 Report Net P/L</span>
              <p className="mt-1 font-mono text-base font-bold">
                {formatCurrency(lastResult.import_record.reported_net_pnl, currency, true, baseCurrency)}
              </p>
            </div>
          </div>
        </div>
      )}

      {history.data && history.data.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-extrabold">Import History</h2>
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/80">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 bg-muted/40">
                  <TableHead className="pl-5 font-bold">Imported ({tzShort})</TableHead>
                  <TableHead className="font-bold">File</TableHead>
                  <TableHead className="text-right font-bold">Inserted</TableHead>
                  <TableHead className="text-right font-bold">Duplicates</TableHead>
                  <TableHead className="text-right font-bold">Deals</TableHead>
                  <TableHead className="pr-5 text-right font-bold">Parsed Net P/L ({currency})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.map((imp) => (
                  <TableRow key={imp.id} className="border-border/50">
                    <TableCell className="pl-5 font-mono text-xs">
                      {formatDateTimeTz(imp.imported_at, account.data?.display_timezone ?? "Asia/Bangkok")}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {imp.filename}{" "}
                      <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">
                        {imp.format}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-emerald-400 font-bold">
                      +{imp.rows_inserted}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {imp.rows_duplicate}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {imp.deals_inserted}
                    </TableCell>
                    <TableCell className="pr-5 text-right font-mono font-bold">
                      {formatCurrency(imp.parsed_net_pnl, currency, true, baseCurrency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
