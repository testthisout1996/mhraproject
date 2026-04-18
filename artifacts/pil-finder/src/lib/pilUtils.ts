export interface PilResult {
  documentUrl: string;
  productName: string;
  plNumber: string[];
  title: string;
  fileName?: string;
}

export type PilClassification = "branded" | "generic" | "unknown";

function normalizeText(s: string): string {
  return s.toUpperCase().replace(/[.\-',()]/g, " ").replace(/\s+/g, " ").trim();
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

/**
 * Words that are acceptable "extras" in a generic product name — pharmaceutical
 * salt forms, unit abbreviations, and formulation qualifiers that MHRA may add
 * to an INN-based product name but that users typically omit in a search term.
 * These words do NOT indicate a branded product.
 */
const PHARMACEUTICAL_TOLERATED_EXTRAS = new Set([
  // Salt / counterion forms
  "SODIUM", "POTASSIUM", "CALCIUM", "MAGNESIUM", "ZINC", "IRON",
  "FERROUS", "FERRIC", "ALUMINIUM", "ALUMINUM",
  "HYDROCHLORIDE", "HCL", "HYDROBROMIDE",
  "PHOSPHATE", "DIHYDROGEN", "MONOHYDROGEN",
  "SULFATE", "SULPHATE", "BISULFATE", "BISULPHATE",
  "ACETATE", "DIACETATE", "TRIACETATE",
  "MALEATE", "FUMARATE", "SUCCINATE", "TARTRATE", "CITRATE",
  "GLUCONATE", "LACTATE", "NITRATE", "CARBONATE", "BICARBONATE",
  "BROMIDE", "CHLORIDE", "IODIDE", "FLUORIDE", "OXIDE", "HYDROXIDE",
  "MESYLATE", "BESYLATE", "TOSYLATE", "EMBONATE", "PAMOATE",
  // Hydration states
  "MONOHYDRATE", "DIHYDRATE", "TRIHYDRATE", "TETRAHYDRATE",
  "ANHYDROUS", "HEMIHYDRATE", "SESQUIHYDRATE", "HYDRATE",
  // Dose units
  "MICROGRAMS", "MICROGRAM", "MCG",
  "MILLIGRAMS", "MILLIGRAM", "MG",
  "MILLILITRES", "MILLILITRE", "MILLILITERS", "MILLILITER", "ML",
  "GRAMS", "GRAM", "G",
  "IU", "UNITS", "UNIT", "NANOGRAMS", "NANOGRAM", "NG",
  "PERCENT", "%",
  // Release modifiers
  "MODIFIED", "RELEASE", "MR",
  "PROLONGED", "EXTENDED", "XL", "XR",
  "SUSTAINED", "SR",
  "CONTROLLED", "CR",
  "IMMEDIATE", "IR",
  "DELAYED", "LA", "ER", "PR",
  // Coating / presentation
  "GASTRO", "RESISTANT", "ENTERIC", "COATED", "FILM", "HARD",
  "SOFT", "SUGAR", "DISPERSIBLE",
  // Common qualifiers MHRA adds
  "ORAL", "SOLUTION", "FOR", "INFUSION", "CONCENTRATE",
]);

/**
 * Count words in the product name that are:
 *   - not present (even partially) in the search term words
 *   - not a pure number
 *   - not a tolerated pharmaceutical modifier
 *
 * A high count strongly suggests the result is a branded product rather than
 * a truly generic one.
 */
function countBrandWords(productWords: string[], searchWords: string[]): number {
  return productWords.filter(pw => {
    if (/^\d+(\.\d+)?$/.test(pw)) return false;
    if (PHARMACEUTICAL_TOLERATED_EXTRAS.has(pw)) return false;
    if (searchWords.some(sw => pw.startsWith(sw) || sw.startsWith(pw))) return false;
    return true;
  }).length;
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
    // For generic: the drug name (first word) must appear in the product name
    const withDrug = drugFirstWord
      ? results.filter(r => {
          const productWords = splitWords(r.productName);
          // Require the drug name word to appear as a whole-word match (not merely a substring)
          return productWords.some(pw => pw === drugFirstWord || pw.startsWith(drugFirstWord) || drugFirstWord.startsWith(pw));
        })
      : results;
    if (withDrug.length === 0) return undefined;

    // All numbers from the search term must appear in the product name
    const withNumbers = searchNumbers.length > 0
      ? withDrug.filter(r => allNumbersMatchProduct(searchNumbers, r.productName))
      : withDrug;
    if (withNumbers.length === 0) return undefined;

    // Prefer results with matching formulation (soft: fall back if none match)
    const candidates = applyFormulationFilter(withNumbers);

    if (candidates.length === 1) return candidates[0];

    // Score each candidate
    const searchWords = searchTerm ? splitWords(searchTerm).filter(w => w.length > 1) : [];

    const scored = candidates.map(r => {
      const productWords = splitWords(r.productName);

      // Primary: words in product name that look like brand/trade names
      // (not in search, not a tolerated pharmaceutical extra, not a number)
      const brandWordCount = countBrandWords(productWords, searchWords);

      // Secondary: search words not found anywhere in product name
      const missing = searchWords.filter(
        sw => !productWords.some(pw => pw.startsWith(sw) || sw.startsWith(pw))
      ).length;

      // Tertiary: total extra words in product (includes tolerated ones — lower is closer match)
      const extra = productWords.filter(
        pw => !searchWords.some(sw => pw.startsWith(sw) || sw.startsWith(pw))
      ).length;

      return { result: r, brandWordCount, missing, extra };
    });

    // Sort: fewest brand-like words first, then fewest missing search words, then fewest extra words
    scored.sort((a, b) =>
      a.brandWordCount - b.brandWordCount ||
      a.missing - b.missing ||
      a.extra - b.extra
    );

    return scored[0].result;

  } else {
    // For branded: BOTH the brand AND the drug name must appear in the product name.
    // Requiring the drug name is a hard filter — it prevents returning an entirely
    // different drug that happens to share the brand name (e.g. "Imatinib Accord"
    // when searching for "Levothyroxine [ACCORD]").
    const withBrand = results.filter(r => brandWordsMatch(brand, r.productName));
    if (withBrand.length === 0) return undefined;

    const withDrugAndBrand = drugFirstWord
      ? withBrand.filter(r => {
          const productWords = splitWords(r.productName);
          return productWords.some(
            pw => pw === drugFirstWord || pw.startsWith(drugFirstWord) || drugFirstWord.startsWith(pw)
          );
        })
      : withBrand;
    if (withDrugAndBrand.length === 0) return undefined;

    // All numbers from search term must appear in product name
    const withNumbers = searchNumbers.length > 0
      ? withDrugAndBrand.filter(r => allNumbersMatchProduct(searchNumbers, r.productName))
      : withDrugAndBrand;
    if (withNumbers.length === 0) return undefined;

    // Prefer results with matching formulation (soft: fall back if none match)
    const candidates = applyFormulationFilter(withNumbers);

    return candidates[0];
  }
}

export function buildSearchQuery(searchTerm: string, brand: string): string {
  if (brand === "GENERIC") return searchTerm;
  // Include the full drug name AND the brand so Azure Search finds the right drug,
  // not just any product bearing that brand name.
  return `${searchTerm} ${brand}`;
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
