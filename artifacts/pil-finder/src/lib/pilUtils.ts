export interface PilResult {
  documentUrl: string;
  productName: string;
  plNumber: string[];
  title: string;
  fileName?: string;
}

export type PilClassification = "branded" | "generic" | "unknown";

function normalizeText(s: string): string {
  return s.toUpperCase().replace(/[.\-',]/g, " ").replace(/\s+/g, " ").trim();
}

function splitWords(s: string): string[] {
  return normalizeText(s).split(" ").filter(Boolean);
}

function compressAlpha(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function brandWordsMatch(brand: string, productName: string): boolean {
  const brandWords = splitWords(brand);
  const productWords = splitWords(productName);

  const wordMatch = brandWords.every(bw =>
    productWords.some(pw => pw.startsWith(bw) || bw.startsWith(pw))
  );
  if (wordMatch) return true;

  const brandCompressed = compressAlpha(brand);
  const productCompressed = compressAlpha(productName);
  if (brandCompressed.length > 0 && productCompressed.includes(brandCompressed)) return true;

  return false;
}

export function classifyPilResult(result: PilResult, brand?: string): PilClassification {
  if (brand && brand !== "GENERIC") {
    if (brandWordsMatch(brand, result.productName)) return "branded";
    return "unknown";
  }
  return "unknown";
}

function extractSearchNumbers(searchTerm: string): string[] {
  const matches = searchTerm.match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(matches)];
}

function numberMatchesProduct(num: string, productName: string): boolean {
  const escaped = num.replace(".", "\\.");
  const regex = new RegExp(`(?<![0-9])${escaped}(?![0-9])`);
  return regex.test(productName);
}

function allNumbersMatchProduct(numbers: string[], productName: string): boolean {
  return numbers.every(n => numberMatchesProduct(n, productName));
}

const FORMULATION_GROUPS: { group: string; keywords: string[] }[] = [
  { group: "tablet",        keywords: ["TABLETS", "TABLET"] },
  { group: "capsule",       keywords: ["CAPSULES", "CAPSULE"] },
  { group: "solution",      keywords: ["ORAL SOLUTION", "SOLUTION"] },
  { group: "injection",     keywords: ["INJECTION", "INFUSION"] },
  { group: "cream",         keywords: ["CREAM"] },
  { group: "gel",           keywords: ["GEL"] },
  { group: "ointment",      keywords: ["OINTMENT"] },
  { group: "drops",         keywords: ["DROPS"] },
  { group: "spray",         keywords: ["SPRAY"] },
  { group: "suspension",    keywords: ["SUSPENSION"] },
  { group: "granules",      keywords: ["GRANULES"] },
  { group: "powder",        keywords: ["POWDER"] },
  { group: "suppositories", keywords: ["SUPPOSITORIES", "SUPPOSITORY"] },
  { group: "patch",         keywords: ["PATCHES", "PATCH"] },
];

function detectFormulationGroup(text: string): string | null {
  const norm = normalizeText(text);
  for (const { group, keywords } of FORMULATION_GROUPS) {
    if (keywords.some(kw => new RegExp(`\\b${kw}\\b`).test(norm))) return group;
  }
  return null;
}

export function pickBestResult(
  results: PilResult[],
  brand: string,
  searchTerm?: string,
): PilResult | undefined {
  if (results.length === 0) return undefined;

  const brandUpper = brand.toUpperCase();
  const drugFirstWord = searchTerm ? splitWords(searchTerm)[0] : "";
  const searchNumbers = searchTerm ? extractSearchNumbers(searchTerm) : [];

  const formulationGroup = searchTerm ? detectFormulationGroup(searchTerm) : null;

  function applyFormulationFilter(pool: PilResult[]): PilResult[] {
    if (!formulationGroup || pool.length <= 1) return pool;
    const matching = pool.filter(r => detectFormulationGroup(r.productName) === formulationGroup);
    return matching.length > 0 ? matching : pool;
  }

  if (brandUpper === "GENERIC") {
    // For generic: drug name must be present in product name
    const withDrug = drugFirstWord
      ? results.filter(r => normalizeText(r.productName).includes(drugFirstWord))
      : results;
    if (withDrug.length === 0) return undefined;

    // All numbers from search term must appear in product name
    const withNumbers = searchNumbers.length > 0
      ? withDrug.filter(r => allNumbersMatchProduct(searchNumbers, r.productName))
      : withDrug;
    if (withNumbers.length === 0) return undefined;

    // Prefer results with matching formulation (soft: fall back if none match)
    const candidates = applyFormulationFilter(withNumbers);
    if (candidates.length === 1) return candidates[0];

    // Score by: fewest missing search words (primary), then fewest extra product words (secondary)
    const searchWords = searchTerm ? splitWords(searchTerm).filter(w => w.length > 1) : [];
    const scored = candidates.map(r => {
      const productWords = splitWords(r.productName);
      const missing = searchWords.filter(
        sw => !productWords.some(pw => pw.startsWith(sw) || sw.startsWith(pw))
      ).length;
      const extra = productWords.filter(
        pw => !searchWords.some(sw => pw.startsWith(sw) || sw.startsWith(pw))
      ).length;
      return { result: r, missing, extra };
    });
    scored.sort((a, b) => a.missing - b.missing || a.extra - b.extra);
    return scored[0].result;

  } else {
    // For branded: brand must be present in product name (brand IS the identifier)
    const withBrand = results.filter(r => brandWordsMatch(brand, r.productName));
    if (withBrand.length === 0) return undefined;

    // All numbers from search term must appear in product name
    const withNumbers = searchNumbers.length > 0
      ? withBrand.filter(r => allNumbersMatchProduct(searchNumbers, r.productName))
      : withBrand;
    if (withNumbers.length === 0) return undefined;

    // Prefer results with matching formulation (soft: fall back if none match)
    const candidates = applyFormulationFilter(withNumbers);

    // Among candidates, prefer one that also contains the drug name
    const withDrug = drugFirstWord
      ? candidates.find(r => normalizeText(r.productName).includes(drugFirstWord))
      : undefined;
    if (withDrug) return withDrug;

    return candidates[0];
  }
}

export function buildSearchQuery(searchTerm: string, brand: string): string {
  if (brand === "GENERIC") return searchTerm;
  const withoutFirstWord = searchTerm.replace(/^[^\s]+/, "").trim();
  return (`${brand} ${withoutFirstWord}`).trim() || searchTerm;
}

export function parseNameAndBrand(raw: string): { searchTerm: string; brand: string } {
  const bracketMatch = raw.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (bracketMatch) {
    const searchTerm = bracketMatch[1].trim();
    const tag = bracketMatch[2].trim();
    return {
      searchTerm,
      brand: tag.toUpperCase() === "GENERIC" ? "GENERIC" : tag,
    };
  }
  return { searchTerm: raw.trim(), brand: "GENERIC" };
}
