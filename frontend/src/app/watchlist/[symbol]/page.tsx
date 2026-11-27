import { Suspense } from "react";
import { SymbolView } from "@/components/watchlist/SymbolView";

export default function SymbolPage({ params }: { params: Promise<{ symbol: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading&hellip;</p>}>
      <SymbolView params={params} />
    </Suspense>
  );
}
