import { Router, type IRouter } from "express";
import { SearchMhraPilQueryParams, SearchMhraPilResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const AZURE_SEARCH_BASE = "https://mhraproducts4853.search.windows.net/indexes/products-index/docs";
const AZURE_API_KEY = "17CCFC430C1A78A169B392A35A99C49D";
const AZURE_API_VERSION = "2017-11-11";

const PL_NUMBER_REGEX = /^(?:PL\s*)?(\d{4,5})\s*\/\s*(\d{3,4})$/i;

function normalizePlNumber(q: string): string | null {
  const match = q.trim().match(PL_NUMBER_REGEX);
  if (match) {
    const part1 = match[1].padStart(5, "0");
    const part2 = match[2].padStart(4, "0");
    return `PL${part1}${part2}`;
  }
  return null;
}

async function queryAzureSearch(params: {
  search?: string;
  filter: string;
  top: number;
  skip: number;
  count: boolean;
  plNumber?: string;
}): Promise<Response> {
  const url = new URL(AZURE_SEARCH_BASE);
  url.searchParams.set("api-key", AZURE_API_KEY);
  url.searchParams.set("api-version", AZURE_API_VERSION);

  let filter = params.filter;

  if (params.plNumber) {
    filter += ` and pl_number/any(p: p eq '${params.plNumber}')`;
    url.searchParams.set("search", "*");
  } else {
    url.searchParams.set("search", params.search ?? "*");
  }

  url.searchParams.set("$filter", filter);
  url.searchParams.set("$top", String(params.top));
  url.searchParams.set("$skip", String(params.skip));
  if (params.count) {
    url.searchParams.set("$count", "true");
  }

  return fetch(url.toString(), {
    headers: { "Accept": "application/json" },
  });
}

type AzureSearchItem = {
  title: string;
  product_name: string;
  pl_number: string[] | null;
  substance_name: string[] | null;
  doc_type: string;
  territory: string | null;
  metadata_storage_path: string;
  file_name: string;
  metadata_storage_size: number;
  created: string | null;
};

function mapItem(item: AzureSearchItem) {
  return {
    title: item.title || "",
    productName: item.product_name || "",
    plNumber: item.pl_number || [],
    substanceName: item.substance_name || [],
    docType: item.doc_type || "",
    territory: item.territory,
    documentUrl: item.metadata_storage_path || "",
    fileName: item.file_name || "",
    fileSize: item.metadata_storage_size || 0,
    created: item.created || "",
  };
}

router.get("/mhra/check-url", async (req, res): Promise<void> => {
  const url = req.query.url as string;
  if (!url || typeof url !== "string" || !url.startsWith("https://mhraproducts4853.blob.core.windows.net/")) {
    res.status(400).json({ accessible: false, error: "Invalid or disallowed URL" });
    return;
  }
  try {
    const response = await fetch(url, { method: "HEAD" });
    res.json({ accessible: response.ok, status: response.status });
  } catch {
    res.json({ accessible: false, status: 0 });
  }
});

router.get("/mhra/search", async (req, res): Promise<void> => {
  const parsed = SearchMhraPilQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const { q, page = 1, pageSize = 10 } = parsed.data;
  const skip = (page - 1) * pageSize;
  const baseFilter = "doc_type eq 'Pil' and territory eq 'UK'";

  const plNumber = normalizePlNumber(q);

  const response = await queryAzureSearch({
    search: q,
    filter: baseFilter,
    top: pageSize,
    skip,
    count: true,
    plNumber: plNumber ?? undefined,
  });

  if (!response.ok) {
    req.log.error({ status: response.status }, "MHRA API error");
    res.status(502).json({ message: "Failed to fetch from MHRA API" });
    return;
  }

  const data = await response.json() as {
    "@odata.count"?: number;
    value: AzureSearchItem[];
  };

  const results = data.value.map(mapItem);
  const totalCount = data["@odata.count"] ?? results.length;

  const responseBody = SearchMhraPilResponse.parse({
    results,
    totalCount,
    page,
    pageSize,
    query: q,
  });

  res.json(responseBody);
});

export default router;
