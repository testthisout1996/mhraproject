import { useState, useCallback, useEffect } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Loader2, Clock, Server, Search, FileText, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ServiceStatus = "operational" | "degraded" | "outage";

interface ServiceResult {
  name: string;
  description: string;
  status: ServiceStatus;
  latencyMs: number;
  checkedAt: string;
  detail?: string;
}

interface StatusResponse {
  overallStatus: ServiceStatus;
  checkedAt: string;
  services: {
    apiServer: ServiceResult;
    mhraSearch: ServiceResult;
    mhraDocuments: ServiceResult;
  };
}

type ServiceKey = keyof StatusResponse["services"];

const SERVICE_ICONS: Record<ServiceKey, React.ReactNode> = {
  apiServer: <Server className="w-5 h-5" />,
  mhraSearch: <Search className="w-5 h-5" />,
  mhraDocuments: <FileText className="w-5 h-5" />,
};

const INITIAL_SERVICES: StatusResponse["services"] = {
  apiServer: {
    name: "PIL Finder API",
    description: "Internal API server that processes search requests",
    status: "operational",
    latencyMs: 0,
    checkedAt: "",
    detail: "Not yet checked",
  },
  mhraSearch: {
    name: "MHRA Search Index",
    description: "MHRA Azure Search — indexes and retrieves PIL documents",
    status: "operational",
    latencyMs: 0,
    checkedAt: "",
    detail: "Not yet checked",
  },
  mhraDocuments: {
    name: "MHRA Document Store",
    description: "MHRA Azure Blob Storage — hosts the PDF leaflet files",
    status: "operational",
    latencyMs: 0,
    checkedAt: "",
    detail: "Not yet checked",
  },
};

function statusConfig(status: ServiceStatus) {
  switch (status) {
    case "operational":
      return {
        label: "Operational",
        icon: <CheckCircle2 className="w-4 h-4" />,
        badgeClass: "border-green-200 bg-green-50 text-green-700",
        bannerClass: "border-green-200 bg-green-50",
        bannerText: "text-green-800",
        dot: "bg-green-500",
      };
    case "degraded":
      return {
        label: "Degraded",
        icon: <AlertTriangle className="w-4 h-4" />,
        badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
        bannerClass: "border-amber-200 bg-amber-50",
        bannerText: "text-amber-800",
        dot: "bg-amber-500",
      };
    case "outage":
      return {
        label: "Outage",
        icon: <XCircle className="w-4 h-4" />,
        badgeClass: "border-red-200 bg-red-50 text-red-700",
        bannerClass: "border-red-200 bg-red-50",
        bannerText: "text-red-800",
        dot: "bg-red-500 animate-pulse",
      };
  }
}

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function overallFromServices(services: StatusResponse["services"]): ServiceStatus {
  const statuses = Object.values(services).map(s => s.status);
  if (statuses.every(s => s === "operational")) return "operational";
  if (statuses.some(s => s === "outage")) return "outage";
  return "degraded";
}

export default function ServiceStatusTab() {
  const [services, setServices] = useState<StatusResponse["services"]>(INITIAL_SERVICES);
  const [overallCheckedAt, setOverallCheckedAt] = useState<string>("");
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadingService, setLoadingService] = useState<Partial<Record<ServiceKey, boolean>>>({});
  const [hasChecked, setHasChecked] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoadingAll(true);
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StatusResponse;
      setServices(data.services);
      setOverallCheckedAt(data.checkedAt);
      setHasChecked(true);
    } catch {
      const now = new Date().toISOString();
      setServices(prev => {
        const updated = { ...prev };
        (Object.keys(updated) as ServiceKey[]).forEach(k => {
          updated[k] = { ...updated[k], status: "outage", checkedAt: now, detail: "Failed to reach status endpoint" };
        });
        return updated;
      });
      setOverallCheckedAt(now);
      setHasChecked(true);
    } finally {
      setLoadingAll(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const fetchService = useCallback(async (key: ServiceKey) => {
    const serviceParam =
      key === "apiServer" ? "api-server" :
      key === "mhraSearch" ? "mhra-search" :
      "mhra-documents";

    setLoadingService(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(`/api/status?service=${serviceParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StatusResponse;
      setServices(prev => ({ ...prev, [key]: data.services[key] }));
      if (!overallCheckedAt) setOverallCheckedAt(data.checkedAt);
      setHasChecked(true);
    } catch {
      const now = new Date().toISOString();
      setServices(prev => ({
        ...prev,
        [key]: { ...prev[key], status: "outage", checkedAt: now, detail: "Failed to reach status endpoint" },
      }));
      setHasChecked(true);
    } finally {
      setLoadingService(prev => ({ ...prev, [key]: false }));
    }
  }, [overallCheckedAt]);

  const overallStatus = hasChecked ? overallFromServices(services) : null;
  const overallCfg = overallStatus ? statusConfig(overallStatus) : null;

  const overallLabel =
    !hasChecked ? "Not yet checked" :
    overallStatus === "operational" ? "All Systems Operational" :
    overallStatus === "degraded" ? "Partial Service Disruption" :
    "Service Outage Detected";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight mb-1">Service Status</h2>
        <p className="text-muted-foreground text-sm">
          Real-time connectivity checks for each component of the PIL Finder service.
        </p>
      </div>

      {/* Overall Status Banner */}
      <Card className={`border shadow-sm ${overallCfg ? overallCfg.bannerClass : "border-border bg-muted/20"}`}>
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {loadingAll ? (
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              ) : overallCfg ? (
                <div className={`w-3 h-3 rounded-full ${overallCfg.dot}`} />
              ) : (
                <Activity className="w-5 h-5 text-muted-foreground" />
              )}
              <div>
                <h3 className={`text-base font-semibold ${overallCfg ? overallCfg.bannerText : "text-foreground"}`}>
                  {loadingAll ? "Checking all services..." : overallLabel}
                </h3>
                {overallCheckedAt && !loadingAll && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    Last checked: {formatTimestamp(overallCheckedAt)}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchAll()}
              disabled={loadingAll}
              className="gap-2 shrink-0 bg-white/60"
            >
              {loadingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {hasChecked ? "Refresh All" : "Check All Services"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Individual Service Cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Component Checks</h3>
        {(Object.entries(services) as [ServiceKey, ServiceResult][]).map(([key, svc]) => {
          const isLoading = !!loadingService[key];
          const cfg = hasChecked && !isLoading ? statusConfig(svc.status) : null;

          return (
            <Card key={key} className="border-border/80 shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <div className="flex flex-col sm:flex-row">
                  <div className="p-5 flex-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className={`${cfg ? cfg.bannerText : "text-muted-foreground"}`}>
                        {SERVICE_ICONS[key]}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground">{svc.name}</span>
                          {cfg && (
                            <Badge variant="outline" className={`text-xs gap-1 ${cfg.badgeClass}`}>
                              {cfg.icon}
                              {cfg.label}
                            </Badge>
                          )}
                          {isLoading && (
                            <Badge variant="outline" className="text-xs gap-1 border-blue-200 bg-blue-50 text-blue-700">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Checking...
                            </Badge>
                          )}
                          {!hasChecked && !isLoading && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              Not checked
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs mt-0.5">{svc.description}</CardDescription>
                      </div>
                    </div>

                    {hasChecked && !isLoading && svc.checkedAt && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground pl-7">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 shrink-0" />
                          Checked: {formatTimestamp(svc.checkedAt)}
                        </span>
                        {svc.latencyMs > 0 && (
                          <span className="flex items-center gap-1">
                            <Activity className="w-3 h-3 shrink-0" />
                            Response time: {svc.latencyMs} ms
                          </span>
                        )}
                        {svc.detail && (
                          <span className="sm:col-span-2 text-foreground/70 italic">{svc.detail}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border-t sm:border-t-0 sm:border-l border-border bg-muted/10 px-5 py-4 sm:w-36 flex items-center justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void fetchService(key)}
                      disabled={isLoading || loadingAll}
                      className="gap-1.5 text-xs w-full"
                    >
                      {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      {isLoading ? "Checking..." : "Refresh"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!hasChecked && (
        <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
          <Activity className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">Click <strong>Check All Services</strong> to run a connectivity check,<br />or use the <strong>Refresh</strong> button on any component to check it individually.</p>
        </div>
      )}

      {/* Status Key */}
      <Card className="border-border/60 bg-muted/20 shadow-sm">
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-semibold text-foreground/80 uppercase tracking-wider">Status Key</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-green-700">Operational</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The service is fully available and responding as expected. All checks passed.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-700">Degraded</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The service is reachable but experiencing issues — such as slow responses or partial failures.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <XCircle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-red-700">Outage</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The service is unreachable or returning errors. PIL search or document access may be unavailable.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
