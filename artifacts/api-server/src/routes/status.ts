import { Router, type IRouter } from "express";

const router: IRouter = Router();

const AZURE_SEARCH_BASE =
  "https://mhraproducts4853.search.windows.net/indexes/products-index/docs";
const AZURE_API_KEY = "17CCFC430C1A78A169B392A35A99C49D";
const AZURE_API_VERSION = "2017-11-11";
const MHRA_BLOB_BASE = "https://mhraproducts4853.blob.core.windows.net";

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

async function checkApiServer(): Promise<ServiceResult> {
  const start = Date.now();
  return {
    name: "PIL Finder API",
    description: "Internal API server that processes search requests",
    status: "operational",
    latencyMs: Date.now() - start,
    checkedAt: new Date().toISOString(),
    detail: "API server is responding normally",
  };
}

async function checkMhraSearch(): Promise<ServiceResult> {
  const start = Date.now();
  const name = "MHRA Search Index";
  const description = "MHRA Azure Search — indexes and retrieves PIL documents";

  try {
    const url = new URL(AZURE_SEARCH_BASE);
    url.searchParams.set("api-key", AZURE_API_KEY);
    url.searchParams.set("api-version", AZURE_API_VERSION);
    url.searchParams.set("search", "aspirin");
    url.searchParams.set("$filter", "doc_type eq 'Pil' and territory eq 'UK'");
    url.searchParams.set("$top", "1");
    url.searchParams.set("$count", "true");

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    const latencyMs = Date.now() - start;

    if (res.ok) {
      const data = (await res.json()) as { "@odata.count"?: number };
      const count = data["@odata.count"] ?? 0;
      return {
        name,
        description,
        status: "operational",
        latencyMs,
        checkedAt: new Date().toISOString(),
        detail: `Index reachable — ${count.toLocaleString()} PIL documents indexed`,
      };
    }

    return {
      name,
      description,
      status: "degraded",
      latencyMs,
      checkedAt: new Date().toISOString(),
      detail: `Search returned HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const isTimeout =
      err instanceof Error && err.name === "TimeoutError";
    return {
      name,
      description,
      status: "outage",
      latencyMs,
      checkedAt: new Date().toISOString(),
      detail: isTimeout
        ? "Request timed out after 8 seconds"
        : "Unable to reach MHRA Search",
    };
  }
}

async function checkMhraDocuments(): Promise<ServiceResult> {
  const start = Date.now();
  const name = "MHRA Document Store";
  const description = "MHRA Azure Blob Storage — hosts the PDF leaflet files";

  try {
    const res = await fetch(MHRA_BLOB_BASE, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
    });

    const latencyMs = Date.now() - start;
    const reachable = res.status < 500;

    return {
      name,
      description,
      status: reachable ? "operational" : "degraded",
      latencyMs,
      checkedAt: new Date().toISOString(),
      detail: reachable
        ? "Document store is reachable"
        : `Server returned HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const isTimeout =
      err instanceof Error && err.name === "TimeoutError";
    return {
      name,
      description,
      status: "outage",
      latencyMs,
      checkedAt: new Date().toISOString(),
      detail: isTimeout
        ? "Request timed out after 8 seconds"
        : "Unable to reach MHRA Document Store",
    };
  }
}

function overallStatus(services: StatusResponse["services"]): ServiceStatus {
  const statuses = Object.values(services).map((s) => s.status);
  if (statuses.every((s) => s === "operational")) return "operational";
  if (statuses.some((s) => s === "outage")) return "outage";
  return "degraded";
}

router.get("/status", async (req, res): Promise<void> => {
  const service = req.query["service"] as string | undefined;

  try {
    let apiServer: ServiceResult;
    let mhraSearch: ServiceResult;
    let mhraDocuments: ServiceResult;

    if (service === "api-server") {
      apiServer = await checkApiServer();
      mhraSearch = {
        name: "MHRA Search Index",
        description: "MHRA Azure Search — indexes and retrieves PIL documents",
        status: "operational",
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        detail: "Not checked in this request",
      };
      mhraDocuments = {
        name: "MHRA Document Store",
        description: "MHRA Azure Blob Storage — hosts the PDF leaflet files",
        status: "operational",
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        detail: "Not checked in this request",
      };
    } else if (service === "mhra-search") {
      mhraSearch = await checkMhraSearch();
      apiServer = await checkApiServer();
      mhraDocuments = {
        name: "MHRA Document Store",
        description: "MHRA Azure Blob Storage — hosts the PDF leaflet files",
        status: "operational",
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        detail: "Not checked in this request",
      };
    } else if (service === "mhra-documents") {
      mhraDocuments = await checkMhraDocuments();
      apiServer = await checkApiServer();
      mhraSearch = {
        name: "MHRA Search Index",
        description: "MHRA Azure Search — indexes and retrieves PIL documents",
        status: "operational",
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        detail: "Not checked in this request",
      };
    } else {
      [apiServer, mhraSearch, mhraDocuments] = await Promise.all([
        checkApiServer(),
        checkMhraSearch(),
        checkMhraDocuments(),
      ]);
    }

    const services = { apiServer, mhraSearch, mhraDocuments };
    const response: StatusResponse = {
      overallStatus: overallStatus(services),
      checkedAt: new Date().toISOString(),
      services,
    };

    res.json(response);
  } catch {
    res.status(500).json({ message: "Status check failed" });
  }
});

export default router;
