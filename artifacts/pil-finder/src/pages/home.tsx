import { useState } from "react";
import { Search, FileText, Download, Building2, Activity, Info, ChevronLeft, ChevronRight, CheckCircle2, ShieldCheck, AlertCircle, RefreshCw, ServerCog, Tag } from "lucide-react";
import { useSearchMhraPil, getSearchMhraPilQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import UpdateTab from "@/components/UpdateTab";
import ServiceStatusTab from "@/components/ServiceStatusTab";
import { parseNameAndBrand, buildSearchQuery, classifyPilResult } from "@/lib/pilUtils";

const PAGE_SIZE = 10;

function formatBytes(bytes?: number) {
  if (!bytes) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let l = 0, n = bytes;
  while (n >= 1024 && ++l) n = n / 1024;
  return (n.toFixed(n < 10 && l > 0 ? 1 : 0) + " " + units[l]);
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function SearchTab() {
  const [searchInput, setSearchInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [submittedBrand, setSubmittedBrand] = useState("GENERIC");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useSearchMhraPil(
    { q: submittedQuery, page, pageSize: PAGE_SIZE },
    {
      query: {
        enabled: !!submittedQuery,
        queryKey: getSearchMhraPilQueryKey({ q: submittedQuery, page, pageSize: PAGE_SIZE }),
      },
    }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = searchInput.trim();
    if (!raw) return;
    const { searchTerm, brand } = parseNameAndBrand(raw);
    const query = buildSearchQuery(searchTerm, brand);
    setSubmittedQuery(query);
    setSubmittedBrand(brand);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Search Section */}
      <section className="space-y-4">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold text-foreground tracking-tight mb-1.5">
            Patient Information Leaflets
          </h2>
          <p className="text-muted-foreground text-sm">
            Search the official MHRA database for verified Patient Information Leaflets (PILs) for medications licensed in the UK.
            Accepts medication names, active substances, or PL numbers (e.g. <code className="bg-muted px-1 py-0.5 rounded font-mono text-xs">17509/0024</code>).
          </p>
        </div>

        <Card className="shadow-sm border-border/60 overflow-hidden">
          <div className="bg-muted/30 px-5 py-3 border-b border-border/60 flex items-center gap-2">
            <Info className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground">Search by medication name, active substance or PL number</span>
          </div>
          <CardContent className="p-5">
            <form onSubmit={handleSearch} className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="e.g. Aspirin 75mg Tablets, Paracetamol, 17509/0024..."
                  className="pl-10 h-11 text-sm border-border bg-background"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  data-testid="input-search"
                />
              </div>
              <Button
                type="submit"
                className="h-11 px-6 font-medium shadow-sm"
                disabled={!searchInput.trim() || isLoading}
                data-testid="button-submit-search"
              >
                {isLoading ? "Searching..." : "Search"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      {/* Results */}
      <section className="flex-1 flex flex-col gap-4">
        {!submittedQuery && !isLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Search className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1.5">Ready to search</h3>
            <p className="text-muted-foreground text-sm max-w-md">
              Enter a medication name, active substance, or PL number to find official Patient Information Leaflets.
            </p>
          </div>
        )}

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-5 w-44" />
            {[1, 2, 3].map(i => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="p-5 flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-56" />
                      <Skeleton className="h-4 w-80" />
                    </div>
                    <Skeleton className="h-9 w-24" />
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-28" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {isError && (
          <Card className="border-destructive/20 bg-destructive/5 shadow-sm">
            <CardContent className="p-5 flex items-start gap-4">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-destructive mb-0.5">Error retrieving results</h3>
                <p className="text-sm text-foreground/80">There was a problem connecting to the MHRA database. Please try again.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {data && !isLoading && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">Results</h3>
                <Badge variant="secondary" className="bg-primary/10 text-primary rounded-full px-2.5 text-xs">
                  {data.totalCount.toLocaleString()} found
                </Badge>
                {submittedBrand !== "GENERIC" && (
                  <Badge variant="outline" className="border-purple-200 text-purple-700 bg-purple-50 text-xs gap-1">
                    <Tag className="w-3 h-3" />
                    Brand: {submittedBrand}
                  </Badge>
                )}
                {submittedBrand === "GENERIC" && submittedQuery && (
                  <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50 text-xs gap-1">
                    <Tag className="w-3 h-3" />
                    Generic
                  </Badge>
                )}
              </div>
              {data.query && (
                <span className="text-sm text-muted-foreground">
                  for <span className="font-medium text-foreground">"{data.query}"</span>
                </span>
              )}
            </div>

            {data.results.length === 0 ? (
              <Card className="border-dashed bg-muted/20">
                <CardContent className="flex flex-col items-center justify-center py-14 text-center px-4">
                  <AlertCircle className="w-10 h-10 text-muted-foreground/40 mb-3" />
                  <h3 className="text-base font-medium text-foreground mb-1.5">No documents found</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    No Patient Information Leaflets matched your search. Try a different name, active substance, or PL number.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {data.results.map((doc, index) => {
                  const classification = classifyPilResult(
                    { documentUrl: doc.documentUrl, productName: doc.productName, plNumber: doc.plNumber ?? [], title: doc.title, fileName: doc.fileName },
                    submittedBrand !== "GENERIC" ? submittedBrand : undefined,
                  );
                  return (
                  <Card
                    key={`${doc.documentUrl}-${index}`}
                    className="group hover:shadow-md transition-shadow duration-200 border-border/80 overflow-hidden"
                    data-testid={`card-result-${index}`}
                  >
                    <CardContent className="p-0">
                      <div className="flex flex-col sm:flex-row">
                        <div className="p-5 flex-1 flex flex-col gap-3">
                          <div>
                            <div className="flex items-start justify-between gap-3 mb-0.5">
                              <h4 className="text-base font-semibold text-primary leading-tight">
                                {doc.productName}
                              </h4>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {classification === "branded" && (
                                  <Badge variant="outline" className="text-xs border-purple-200 text-purple-700 bg-purple-50">Brand</Badge>
                                )}
                                {classification === "generic" && (
                                  <Badge variant="outline" className="text-xs border-blue-200 text-blue-700 bg-blue-50">Generic</Badge>
                                )}
                                {doc.territory && (
                                  <Badge variant="outline" className="text-xs">
                                    {doc.territory}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <p className="text-foreground/75 text-sm">{doc.title}</p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2.5 gap-x-6 text-sm">
                            {doc.substanceName && doc.substanceName.length > 0 && (
                              <div className="flex items-start gap-2">
                                <Activity className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                <div>
                                  <span className="text-muted-foreground block text-xs">Active Substances</span>
                                  <span className="font-medium text-sm">{doc.substanceName.join(", ")}</span>
                                </div>
                              </div>
                            )}
                            {doc.plNumber && doc.plNumber.length > 0 && (
                              <div className="flex items-start gap-2">
                                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                <div>
                                  <span className="text-muted-foreground block text-xs">PL Number(s)</span>
                                  <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">
                                    {doc.plNumber.join(", ")}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="border-t sm:border-t-0 sm:border-l border-border bg-muted/10 p-5 sm:w-48 flex flex-col justify-center items-center text-center gap-3">
                          <div className="space-y-1">
                            <FileText className="w-7 h-7 text-primary mx-auto opacity-80 group-hover:opacity-100 transition-opacity" />
                            <div className="text-xs font-semibold text-foreground uppercase tracking-wider">{doc.docType}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatBytes(doc.fileSize)}
                              {doc.created && <span> · {formatDate(doc.created)}</span>}
                            </div>
                          </div>
                          <Button asChild className="w-full shadow-sm" variant="default" size="sm">
                            <a
                              href={doc.documentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid={`link-document-${index}`}
                            >
                              <Download className="w-3.5 h-3.5 mr-1.5" />
                              View PDF
                            </a>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}

                {data.totalCount > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-4 border-t mt-4">
                    <div className="text-sm text-muted-foreground">
                      Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}</span>–
                      <span className="font-medium text-foreground">{Math.min(page * PAGE_SIZE, data.totalCount)}</span> of{" "}
                      <span className="font-medium text-foreground">{data.totalCount.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Previous
                      </Button>
                      <span className="text-sm font-medium px-3 py-1 bg-muted rounded-md border text-foreground">
                        {page} / {Math.ceil(data.totalCount / PAGE_SIZE)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={page >= Math.ceil(data.totalCount / PAGE_SIZE)}
                        data-testid="button-next-page"
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

type Tab = "search" | "update" | "status";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("search");

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Sticky Navbar */}
      <header className="sticky top-0 z-40 bg-primary text-primary-foreground shadow-sm">
        <div className="container max-w-5xl mx-auto px-4">
          {/* Brand row */}
          <div className="flex items-center gap-3 pt-3 pb-2">
            <div className="bg-white/10 p-1.5 rounded-md">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-sm leading-tight tracking-tight">MHRA PIL Finder</h1>
              <p className="text-primary-foreground/70 text-xs leading-tight">UK Medicines &amp; Healthcare products Regulatory Agency</p>
            </div>
          </div>
          {/* Tab row */}
          <nav className="flex gap-0 -mb-px" aria-label="Tabs">
            <button
              onClick={() => setActiveTab("search")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "search"
                  ? "border-white text-white"
                  : "border-transparent text-primary-foreground/60 hover:text-primary-foreground hover:border-white/40"
              }`}
              data-testid="tab-search"
            >
              <span className="flex items-center gap-2">
                <Search className="w-4 h-4" />
                Search
              </span>
            </button>
            <button
              onClick={() => setActiveTab("update")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "update"
                  ? "border-white text-white"
                  : "border-transparent text-primary-foreground/60 hover:text-primary-foreground hover:border-white/40"
              }`}
              data-testid="tab-update"
            >
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Update
              </span>
            </button>
            <button
              onClick={() => setActiveTab("status")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "status"
                  ? "border-white text-white"
                  : "border-transparent text-primary-foreground/60 hover:text-primary-foreground hover:border-white/40"
              }`}
              data-testid="tab-status"
            >
              <span className="flex items-center gap-2">
                <ServerCog className="w-4 h-4" />
                Service Status
              </span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container max-w-5xl mx-auto px-4 py-8">
        <div className={activeTab === "search" ? undefined : "hidden"}><SearchTab /></div>
        <div className={activeTab === "update" ? undefined : "hidden"}><UpdateTab /></div>
        <div className={activeTab === "status" ? undefined : "hidden"}><ServiceStatusTab /></div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30 py-6">
        <div className="container max-w-5xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
            <span>Information retrieved from official MHRA sources. Document type: PIL. Territory: UK only.</span>
          </div>
          <span>For informational purposes only.</span>
        </div>
      </footer>
    </div>
  );
}
