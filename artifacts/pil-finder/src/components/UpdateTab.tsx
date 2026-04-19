import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Upload, ClipboardPaste, Play, Pause, X, Download, CheckCircle, XCircle, Loader2, FileText, RefreshCw, Copy, Check, ArrowUp, ChevronUp, ChevronDown, ChevronRight, PauseCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { parseNameAndBrand, buildSearchQuery, pickBestResult } from "@/lib/pilUtils";

interface MedicationItem {
  id: string;
  raw: string;
  searchTerm: string;
  brand: string;
  status: "pending" | "checking" | "unchanged" | "searching" | "found" | "not_found" | "error";
  documentUrl?: string;
  productName?: string;
  plNumber?: string[];
  title?: string;
  jsKey?: string;
  originalUrl?: string;
  existingFullUrl?: string;
  defaultedToGeneric?: boolean;
}

interface SearchApiResult {
  results: Array<{
    documentUrl: string;
    productName: string;
    plNumber: string[];
    title: string;
    fileName?: string;
  }>;
  totalCount: number;
}

type InputFormat = "text" | "json" | "js";

const EXAMPLE_TEXT = `Aspirin 75mg Gastro-Resistant Tablets [GENERIC]
Aspirin 75mg Tablets [GENERIC]
Paracetamol 500mg Tablets [GENERIC]
Ibuprofen 400mg Tablets [GENERIC]
Amoxicillin 500mg Capsules [GENERIC]
Atorvastatin 20mg Tablets [GENERIC]`;

function joinUrlParts(base: string, pathPart: string): string {
  const trimmedBase = base.trim();
  const trimmedPath = pathPart.trim();

  if (/^https?:\/\//i.test(trimmedPath)) {
    return trimmedPath;
  }

  if (!trimmedBase) {
    return trimmedPath;
  }

  return `${trimmedBase.replace(/\/+$/, "")}/${trimmedPath.replace(/^\/+/, "")}`;
}

function normalizePilUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url.trim());
    const pathname = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
    return `${parsed.origin.toLowerCase()}${pathname}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

function getPilDocumentKey(url: string | undefined): string | undefined {
  if (!url) return undefined;

  const trimmed = url.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    const parts = decodeURIComponent(parsed.pathname)
      .split("/")
      .map(part => part.trim())
      .filter(Boolean);
    return parts.at(-1)?.toLowerCase();
  } catch {
    const pathOnly = trimmed.split(/[?#]/)[0];
    const parts = decodeURIComponent(pathOnly)
      .split("/")
      .map(part => part.trim())
      .filter(Boolean);
    return parts.at(-1)?.toLowerCase();
  }
}

function isSamePilUrl(a: string | undefined, b: string | undefined): boolean {
  const normalizedA = normalizePilUrl(a);
  const normalizedB = normalizePilUrl(b);

  if (normalizedA && normalizedB && normalizedA === normalizedB) {
    return true;
  }

  const documentKeyA = getPilDocumentKey(a);
  const documentKeyB = getPilDocumentKey(b);

  return !!documentKeyA && documentKeyA.length > 8 && documentKeyA === documentKeyB;
}

function matchesExistingPilDocument(
  newUrl: string | undefined,
  item: Pick<MedicationItem, "existingFullUrl" | "originalUrl">,
): boolean {
  return (
    isSamePilUrl(newUrl, item.existingFullUrl) ||
    isSamePilUrl(newUrl, item.originalUrl)
  );
}

function parseTextFormat(text: string): Pick<MedicationItem, "raw" | "searchTerm" | "brand" | "existingFullUrl">[] {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const results: Pick<MedicationItem, "raw" | "searchTerm" | "brand" | "existingFullUrl">[] = [];

  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("//")) continue;
    const pipeIdx = line.indexOf(" | ");
    const namePart = pipeIdx !== -1 ? line.slice(0, pipeIdx).trim() : line;
    const existingFullUrl = pipeIdx !== -1 ? line.slice(pipeIdx + 3).trim() || undefined : undefined;
    const { searchTerm, brand } = parseNameAndBrand(namePart);
    results.push({ raw: namePart, searchTerm, brand, existingFullUrl });
  }

  return results;
}

interface JsonMedication {
  name?: string;
  medication?: string;
  brand?: string;
  type?: string;
  searchTerm?: string;
}

function parseJsonFormat(text: string): Pick<MedicationItem, "raw" | "searchTerm" | "brand">[] | null {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;

    return (parsed as JsonMedication[]).map((item) => {
      const name = item.name ?? item.medication ?? item.searchTerm ?? "";
      const brand = item.brand ?? item.type ?? "GENERIC";
      return {
        raw: JSON.stringify(item),
        searchTerm: name,
        brand,
      };
    });
  } catch {
    return null;
  }
}

interface JsParsedItem {
  jsKey: string;
  raw: string;
  searchTerm: string;
  brand: string;
  originalUrl: string;
  existingFullUrl?: string;
}

function parseJsFormat(text: string): JsParsedItem[] | null {
  if (!text.includes("EndPoint +") && !text.includes("EndPoint+")) return null;

  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " ")
  );

  const endPointMatch = text.match(/EndPoint\s*=\s*['"]([^'"]+)['"]/);
  const endPoint = endPointMatch ? endPointMatch[1].replace(/\/$/, "") : "";

  const entryPattern =
    /(\bmed\d+)\s*:\s*\{[^}]*?name\s*:\s*'([^']+)'[^}]*?url\s*:\s*EndPoint\s*\+?\s*'([^']+)'[^}]*?\}/gs;

  const items: JsParsedItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(stripped)) !== null) {
    const jsKey = match[1];
    const rawName = match[2];
    const originalUrl = match[3];

    const { searchTerm, brand } = parseNameAndBrand(rawName);
    const existingFullUrl = endPoint ? joinUrlParts(endPoint, originalUrl) : undefined;

    items.push({
      jsKey,
      raw: rawName,
      searchTerm,
      brand,
      originalUrl,
      existingFullUrl,
    });
  }

  return items.length > 0 ? items : null;
}

async function checkUrlAccessible(url: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/mhra/check-url?url=${encodeURIComponent(url)}`);
    if (!res.ok) return false;
    const data = await res.json() as { accessible: boolean };
    return data.accessible;
  } catch {
    return false;
  }
}

function detectFormat(text: string): InputFormat {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // fall through
    }
  }
  if (trimmed.includes("EndPoint +") || trimmed.includes("EndPoint+")) {
    return "js";
  }
  return "text";
}

function parseInput(
  text: string,
  format: InputFormat
): Pick<MedicationItem, "raw" | "searchTerm" | "brand" | "jsKey" | "originalUrl" | "existingFullUrl">[] {
  if (format === "js") {
    const jsItems = parseJsFormat(text);
    if (jsItems) return jsItems;
  }
  if (format === "json") {
    const jsonItems = parseJsonFormat(text);
    if (jsonItems) return jsonItems;
  }
  return parseTextFormat(text);
}

function reconstructJsOutput(originalText: string, items: MedicationItem[]): string {
  let result = originalText;
  for (const item of items) {
    if (item.originalUrl && item.documentUrl && item.status === "found") {
      result = result.split(item.originalUrl).join(item.documentUrl);
    }
  }
  return result;
}

async function fetchResults(query: string, pageSize = 10): Promise<SearchApiResult["results"]> {
  const params = new URLSearchParams({ q: query, pageSize: String(pageSize) });
  const res = await fetch(`/api/mhra/search?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as SearchApiResult;
  return data.results;
}

async function searchForPil(
  searchTerm: string,
  brand: string,
): Promise<{ best: SearchApiResult["results"][0] | undefined; all: SearchApiResult["results"]; defaultedToGeneric: boolean }> {
  if (brand === "GENERIC") {
    const results = await fetchResults(searchTerm, 15);
    const best = pickBestResult(results, brand, searchTerm);
    return { best, all: results, defaultedToGeneric: false };
  }

  const brandDoseQuery = buildSearchQuery(searchTerm, brand);
  const drugName = searchTerm.split(/\s+/)[0] ?? searchTerm;
  const drugBrandQuery = `${drugName} ${brand}`;
  // Also query the brand name on its own — catches products whose MHRA name
  // doesn't include the INN (e.g. "Stexerol-D3 1000 IU Tablets").
  const brandOnlyQuery = brand;

  const [doseResults, drugBrandResults, brandOnlyResults] = await Promise.all([
    fetchResults(brandDoseQuery, 10),
    fetchResults(drugBrandQuery, 10),
    fetchResults(brandOnlyQuery, 10),
  ]);

  const seen = new Set<string>();
  const combined: SearchApiResult["results"] = [];
  for (const r of [...drugBrandResults, ...doseResults, ...brandOnlyResults]) {
    if (!seen.has(r.documentUrl)) {
      seen.add(r.documentUrl);
      combined.push(r);
    }
  }

  const best = pickBestResult(combined, brand, searchTerm);
  if (best) return { best, all: combined, defaultedToGeneric: false };

  // Brand-specific PIL not found — fall back to a generic PIL for the same drug.
  const genericResults = await fetchResults(searchTerm, 15);
  const genericBest = pickBestResult(genericResults, "GENERIC", searchTerm);
  return { best: genericBest, all: genericResults, defaultedToGeneric: !!genericBest };
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded text-xs"
      title={label ?? "Copy"}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-600" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      {label && <span>{copied ? "Copied!" : label}</span>}
    </button>
  );
}

export default function UpdateTab() {
  const [inputText, setInputText] = useState("");
  const [items, setItems] = useState<MedicationItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [inputFormat, setInputFormat] = useState<InputFormat>("text");
  const [jsOriginalText, setJsOriginalText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [notFoundNavIdx, setNotFoundNavIdx] = useState(0);
  const [panelMinimized, setPanelMinimized] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setControlsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setInputText(text);
    };
    reader.readAsText(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const handleStart = async () => {
    if (!inputText.trim()) return;

    const fmt = detectFormat(inputText);
    setInputFormat(fmt);

    if (fmt === "js") {
      setJsOriginalText(inputText);
    } else {
      setJsOriginalText("");
    }

    const parsed = parseInput(inputText, fmt);
    if (parsed.length === 0) return;

    const initialItems: MedicationItem[] = parsed.map((p, i) => ({
      id: `${i}-${p.searchTerm}`,
      ...p,
      status: "pending",
    }));

    setItems(initialItems);
    setIsRunning(true);
    setProcessed(0);
    setNotFoundNavIdx(0);
    abortRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);

    const waitIfPaused = () =>
      new Promise<void>(resolve => {
        const check = () => {
          if (!isPausedRef.current) resolve();
          else setTimeout(check, 100);
        };
        check();
      });

    for (let i = 0; i < initialItems.length; i++) {
      await waitIfPaused();
      if (abortRef.current) break;

      const item = initialItems[i];

      setItems(prev =>
        prev.map((cur, idx) => (idx === i ? { ...cur, status: "searching" } : cur))
      );

      try {
        const { best, defaultedToGeneric } = await searchForPil(item.searchTerm, item.brand);

        if (best) {
          const isUnchanged = matchesExistingPilDocument(best.documentUrl, item);
          setItems(prev =>
            prev.map((cur, idx) =>
              idx === i
                ? {
                    ...cur,
                    status: isUnchanged ? "unchanged" : "found",
                    documentUrl: best.documentUrl,
                    productName: best.productName,
                    plNumber: best.plNumber,
                    title: best.title,
                    defaultedToGeneric,
                  }
                : cur
            )
          );
        } else {
          setItems(prev =>
            prev.map((cur, idx) => idx === i ? { ...cur, status: "not_found" } : cur)
          );
        }
      } catch {
        setItems(prev =>
          prev.map((cur, idx) => (idx === i ? { ...cur, status: "error" } : cur))
        );
      }

      setProcessed(i + 1);

      if (i < initialItems.length - 1) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    setIsRunning(false);
  };

  const handleStop = () => {
    abortRef.current = true;
    isPausedRef.current = false;
    setIsPaused(false);
  };

  const handlePause = () => {
    isPausedRef.current = true;
    setIsPaused(true);
  };

  const handleResume = () => {
    isPausedRef.current = false;
    setIsPaused(false);
  };

  const handleExportTxt = () => {
    const lines = items.map(item => {
      const brandTag = item.brand === "GENERIC" ? "[GENERIC]" : `[${item.brand}]`;
      const url = item.documentUrl ?? "NOT FOUND";
      return `${item.searchTerm} ${brandTag} | ${url}`;
    });
    downloadText(lines.join("\n"), "pil-links-updated.txt", "text/plain");
  };

  const handleExportJson = () => {
    const data = items.map(item => ({
      medication: item.searchTerm,
      brand: item.brand,
      status: item.status,
      documentUrl: item.documentUrl ?? null,
      productName: item.productName ?? null,
      plNumber: item.plNumber ?? [],
    }));
    downloadText(JSON.stringify(data, null, 2), "pil-links-updated.json", "application/json");
  };

  const handleExportJs = () => {
    const updated = reconstructJsOutput(jsOriginalText, items);
    downloadText(updated, "medicationNames-updated.js", "text/javascript");
  };

  function downloadText(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const found = items.filter(i => i.status === "found").length;
  const unchanged = items.filter(i => i.status === "unchanged").length;
  const notFound = items.filter(i => i.status === "not_found" || i.status === "error").length;
  const total = items.length;
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isDone = !isRunning && total > 0 && processed === total;

  const updatedJs = isDone && inputFormat === "js" ? reconstructJsOutput(jsOriginalText, items) : "";

  // Indices (row numbers) of not-found/error items for navigation
  const notFoundIndices = items
    .map((item, idx) => (item.status === "not_found" || item.status === "error") ? idx : -1)
    .filter(idx => idx !== -1);

  const navigateToNotFound = (navIdx: number) => {
    const rowIdx = notFoundIndices[navIdx];
    if (rowIdx === undefined) return;
    document.getElementById(`med-row-${rowIdx}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setNotFoundNavIdx(navIdx);
  };

  const hasPrevNotFound = notFoundNavIdx > 0;
  const hasNextNotFound = notFoundNavIdx < notFoundIndices.length - 1;

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const isStopped = !isRunning && items.length > 0 && !isDone;
  const showFloating = !controlsVisible && items.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight mb-1">Update PIL Links</h2>
        <p className="text-muted-foreground text-sm">
          Paste or upload your medication list to retrieve the latest Patient Information Leaflet links from MHRA.
          Accepts plain text (one per line), JSON arrays, or a <code className="bg-muted px-1 py-0.5 rounded font-mono text-xs">medicationNames.js</code> file.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ClipboardPaste className="w-4 h-4 text-primary" />
              Paste your list
            </CardTitle>
            <CardDescription className="text-xs">
              Accepts plain text (<code className="bg-muted px-1 font-mono">Medication Name [GENERIC]</code>),
              optionally with existing URLs (<code className="bg-muted px-1 font-mono">Medication Name [GENERIC] | https://...</code>) to detect unchanged links,
              or paste your full <code className="bg-muted px-1 font-mono">medicationNames.js</code> file — format is detected automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <Textarea
              className="min-h-[180px] font-mono text-xs resize-none border-border bg-background"
              placeholder={EXAMPLE_TEXT}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              data-testid="textarea-medication-list"
              disabled={isRunning}
            />
            <button
              className="text-xs text-muted-foreground hover:text-foreground mt-2 underline"
              onClick={() => setInputText(EXAMPLE_TEXT)}
              disabled={isRunning}
            >
              Load example
            </button>
          </CardContent>
        </Card>

        <Card
          className="border-border/80 shadow-sm border-dashed"
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              Upload file
            </CardTitle>
            <CardDescription className="text-xs">
              Accepts .txt, .js, or .json files. Drag and drop or click to browse.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="flex flex-col items-center justify-center gap-3 py-8 border-2 border-dashed border-border rounded-md bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText className="w-10 h-10 text-muted-foreground/50" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Drop file here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse (.txt, .js, .json)</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".txt,.js,.json,text/plain,text/javascript,application/javascript,application/json"
                onChange={handleFileChange}
                data-testid="input-file-upload"
                disabled={isRunning}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div ref={controlsRef} className="flex flex-wrap items-center gap-3">
        {!isRunning ? (
          <Button
            onClick={() => void handleStart()}
            disabled={!inputText.trim() || isRunning}
            className="gap-2 shadow-sm"
            data-testid="button-start-update"
          >
            <Play className="w-4 h-4" />
            Check &amp; Update Links
          </Button>
        ) : (
          <>
            <Button
              onClick={handleStop}
              variant="outline"
              className="gap-2"
              data-testid="button-stop-update"
            >
              <XCircle className="w-4 h-4" />
              Stop
            </Button>
            {!isPaused ? (
              <Button
                onClick={handlePause}
                variant="outline"
                className="gap-2"
                data-testid="button-pause-update"
              >
                <PauseCircle className="w-4 h-4" />
                Pause
              </Button>
            ) : (
              <Button
                onClick={handleResume}
                variant="outline"
                className="gap-2 border-primary/40 text-primary"
                data-testid="button-resume-update"
              >
                <PlayCircle className="w-4 h-4" />
                Resume
              </Button>
            )}
          </>
        )}

        {isDone && (
          <>
            <Button
              onClick={() => void handleStart()}
              variant="outline"
              className="gap-2"
              data-testid="button-rerun-update"
            >
              <RefreshCw className="w-4 h-4" />
              Re-run
            </Button>
            {inputFormat === "js" && (
              <Button
                onClick={handleExportJs}
                variant="outline"
                className="gap-2"
                data-testid="button-export-js"
              >
                <Download className="w-4 h-4" />
                Export .js
              </Button>
            )}
            <Button
              onClick={handleExportTxt}
              variant="outline"
              className="gap-2"
              data-testid="button-export-txt"
            >
              <Download className="w-4 h-4" />
              Export .txt
            </Button>
            <Button
              onClick={handleExportJson}
              variant="outline"
              className="gap-2"
              data-testid="button-export-json"
            >
              <Download className="w-4 h-4" />
              Export .json
            </Button>
          </>
        )}

      </div>

      {(isRunning || isDone) && notFoundIndices.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-destructive flex items-center gap-1.5">
              <XCircle className="w-4 h-4" />
              Medications not found: {notFoundIndices.length}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                onClick={() => navigateToNotFound(0)}
                variant="outline"
                size="sm"
                className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <ChevronRight className="w-3.5 h-3.5" />
                Jump to First
              </Button>
              <Button
                onClick={() => navigateToNotFound(hasPrevNotFound ? notFoundNavIdx - 1 : 0)}
                variant="outline"
                size="sm"
                className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                disabled={!hasPrevNotFound}
              >
                ← Previous
              </Button>
              <Button
                onClick={() => navigateToNotFound(hasNextNotFound ? notFoundNavIdx + 1 : notFoundNavIdx)}
                variant="outline"
                size="sm"
                className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                disabled={!hasNextNotFound}
              >
                Next →
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {notFoundNavIdx + 1} / {notFoundIndices.length}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {(isRunning || isDone) && total > 0 && (
        <Card className="border-border/80 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-medium">
                {isRunning ? (
                  isPaused ? (
                    <span className="flex items-center gap-2">
                      <PauseCircle className="w-4 h-4 text-amber-500" />
                      Paused at {processed + 1} of {total}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      Checking {processed + 1} of {total}...
                    </span>
                  )
                ) : (
                  "Complete"
                )}
              </span>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-green-700">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {found} updated
                </span>
                {unchanged > 0 && (
                  <span className="flex items-center gap-1 text-blue-600">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {unchanged} unchanged
                  </span>
                )}
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="w-3.5 h-3.5" />
                  {notFound} not found
                </span>
              </div>
            </div>
            <Progress value={progressPct} className="h-2" />
          </CardContent>
        </Card>
      )}

      {isDone && inputFormat === "js" && updatedJs && (
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Updated JS Output</CardTitle>
              <CopyButton text={updatedJs} label="Copy all" />
            </div>
            <CardDescription className="text-xs">
              Same format as your input — only the URLs have been updated. Commented-out entries are preserved unchanged.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <Textarea
              className="min-h-[240px] font-mono text-xs resize-y border-border bg-muted/30"
              value={updatedJs}
              readOnly
            />
          </CardContent>
        </Card>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">Results</h3>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-10" />
                  {inputFormat === "js" && <col className="w-20" />}
                  <col className="w-72" />
                  <col className="w-24" />
                  <col className="w-28" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-4 py-3 font-semibold text-foreground/80 text-xs uppercase tracking-wider">#</th>
                    {inputFormat === "js" && (
                      <th className="text-left px-4 py-3 font-semibold text-foreground/80 text-xs uppercase tracking-wider">Key</th>
                    )}
                    <th className="text-left px-4 py-3 font-semibold text-foreground/80 text-xs uppercase tracking-wider">Medication</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground/80 text-xs uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground/80 text-xs uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground/80 text-xs uppercase tracking-wider">PIL Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item, idx) => {
                    const isNotFound = item.status === "not_found" || item.status === "error";
                    return (
                    <tr
                      key={item.id}
                      id={`med-row-${idx}`}
                      className={`transition-colors ${isNotFound ? "bg-red-100 hover:bg-red-200" : item.defaultedToGeneric ? "bg-orange-200 hover:bg-orange-300" : "hover:bg-muted/20"}`}
                      data-testid={`row-medication-${idx}`}
                    >
                      <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                      {inputFormat === "js" && (
                        <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{item.jsKey}</td>
                      )}
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground leading-tight">{item.searchTerm}</div>
                        {item.productName && item.productName !== item.searchTerm.toUpperCase() && (
                          <div className="text-xs text-muted-foreground mt-0.5">{item.productName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${item.brand === "GENERIC" ? "border-blue-200 text-blue-700 bg-blue-50" : "border-purple-200 text-purple-700 bg-purple-50"}`}
                        >
                          {item.brand === "GENERIC" ? "Generic" : item.brand}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {item.status === "pending" && (
                          <span className="text-xs text-muted-foreground">Waiting</span>
                        )}
                        {item.status === "checking" && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Verifying
                          </span>
                        )}
                        {item.status === "unchanged" && (
                          <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                            <CheckCircle className="w-3.5 h-3.5" />
                            URL valid
                          </span>
                        )}
                        {item.status === "searching" && (
                          <span className="flex items-center gap-1 text-xs text-primary">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Searching
                          </span>
                        )}
                        {item.status === "found" && (
                          <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Updated
                          </span>
                        )}
                        {item.status === "not_found" && (
                          <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            Not found
                          </span>
                        )}
                        {item.status === "error" && (
                          <span className="flex items-center gap-1 text-xs text-destructive font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            Error
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.documentUrl ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <a
                                href={item.documentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80 underline text-xs font-mono truncate max-w-xs block"
                                title={item.documentUrl}
                                data-testid={`link-pil-${idx}`}
                              >
                                {item.documentUrl.split("/").pop()}
                              </a>
                              <CopyButton text={item.documentUrl} />
                            </div>
                            {item.defaultedToGeneric && (
                              <span className="text-xs text-muted-foreground italic">
                                (Defaulted to GENERIC Leaflet)
                              </span>
                            )}
                          </div>
                        ) : item.status !== "pending" && item.status !== "searching" ? (
                          <span className="text-xs text-muted-foreground italic">No PIL found</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showFloating && isMounted && createPortal(
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end">
          {panelMinimized ? (
            /* ── Minimised: small icon-only square ── */
            <button
              onClick={() => setPanelMinimized(false)}
              title="Expand panel"
              className="bg-background border border-border rounded-xl shadow-lg p-2.5 flex items-center justify-center hover:bg-muted transition-colors"
            >
              {isRunning && !isPaused ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : isPaused ? (
                <PauseCircle className="w-5 h-5 text-amber-500" />
              ) : isStopped ? (
                <XCircle className="w-5 h-5 text-destructive" />
              ) : (
                <CheckCircle className="w-5 h-5 text-green-600" />
              )}
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground ml-1" />
            </button>
          ) : (
            /* ── Expanded panel ── */
            <div className="bg-background border border-border rounded-xl shadow-lg p-3 flex flex-col gap-2 min-w-[190px]">

              {/* Header row with status + minimise button */}
              <div className="flex items-center justify-between gap-2 px-1 pb-2 border-b border-border mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  {isRunning ? (
                    isPaused ? (
                      <PauseCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    ) : (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                    )
                  ) : isStopped ? (
                    <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  ) : (
                    <CheckCircle className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-foreground truncate">
                    {isRunning
                      ? isPaused
                        ? `Paused ${processed + 1}/${total}`
                        : `Checking ${processed + 1}/${total}`
                      : isStopped
                        ? `Stopped ${processed}/${total}`
                        : "Complete"}
                  </span>
                </div>
                <button
                  onClick={() => setPanelMinimized(true)}
                  title="Minimise panel"
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* Stop / Pause / Resume / Re-run */}
              {isRunning && (
                <div className="flex gap-1.5 justify-center">
                  <Button
                    onClick={handleStop}
                    size="icon"
                    title="Stop"
                    className="border-0 bg-destructive hover:bg-destructive/90 text-white h-8 w-8 shrink-0"
                  >
                    <X className="w-5 h-5" strokeWidth={3.5} />
                  </Button>
                  {!isPaused ? (
                    <Button
                      onClick={handlePause}
                      size="icon"
                      title="Pause"
                      className="border-0 h-8 w-8 shrink-0"
                    >
                      <Pause className="w-4 h-4" fill="currentColor" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleResume}
                      size="icon"
                      title="Resume"
                      className="border-0 bg-green-600 hover:bg-green-700 text-white h-8 w-8 shrink-0"
                    >
                      <Play className="w-4 h-4" fill="currentColor" />
                    </Button>
                  )}
                  <Button
                    onClick={() => void handleStart()}
                    size="icon"
                    title="Re-run"
                    className="border-0 bg-slate-200 hover:bg-slate-300 text-slate-700 h-8 w-8 shrink-0"
                  >
                    <RefreshCw className="w-4 h-4" strokeWidth={2.5} />
                  </Button>
                </div>
              )}
              {(isDone || isStopped) && (
                <Button
                  onClick={() => void handleStart()}
                  size="sm"
                  className="border-0 gap-2 w-full justify-center bg-slate-200 hover:bg-slate-300 text-slate-700"
                >
                  <RefreshCw className="w-4 h-4" strokeWidth={2.5} />
                  Re-run
                </Button>
              )}

              {/* Not-found navigation */}
              {notFoundIndices.length > 0 && (
                <>
                  <div className="text-xs text-destructive font-semibold px-1 text-center">
                    {notFoundIndices.length} not found — {notFoundNavIdx + 1} / {notFoundIndices.length}
                  </div>
                  <Button
                    onClick={() => navigateToNotFound(hasPrevNotFound ? notFoundNavIdx - 1 : 0)}
                    size="sm"
                    className="border-0 gap-2 w-full justify-center"
                  >
                    <ChevronUp className="w-4 h-4" />
                    {hasPrevNotFound ? "Previous" : "Go To First"}
                  </Button>
                  <Button
                    onClick={() => navigateToNotFound(hasNextNotFound ? notFoundNavIdx + 1 : notFoundNavIdx)}
                    size="sm"
                    className="border-0 gap-2 w-full justify-center"
                    disabled={!hasNextNotFound}
                  >
                    <ChevronDown className="w-4 h-4" />
                    Next not found
                  </Button>
                </>
              )}

              {/* Back to top */}
              <Button
                onClick={scrollToTop}
                size="sm"
                className="border-0 gap-2 w-full justify-center bg-teal-600 hover:bg-teal-700 text-white"
              >
                <ArrowUp className="w-4 h-4" />
                Back to top
              </Button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
