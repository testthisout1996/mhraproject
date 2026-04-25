export interface PilResult {
  documentUrl: string;
  productName: string;
  plNumber: string[];
  title: string;
  fileName?: string;
}

export type PilClassification = "branded" | "generic" | "unknown";

function normalizeText(s: string): string {
  return s.toUpperCase()
    // Protect decimal points between digits so 16.1 / 1.5 / 0.5 stay intact
    .replace(/(\d)\.(\d)/g, "$1\u0001$2")
    // Treat punctuation and slashes as separators
    .replace(/[.\-',()/]/g, " ")
    .replace(/\u0001/g, ".")
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * Collapse digit-grouping separators that MHRA frequently uses inside numbers
 * (European-style thin space or comma between thousands), e.g.
 *   "1 000"     -> "1000"
 *   "25 000"    -> "25000"
 *   "1,000,000" -> "1000000"
 */
function normalizeNumberFormatting(s: string): string {
  let prev: string;
  let curr = s;
  do {
    prev = curr;
    curr = curr.replace(/(\d)[\s,](\d{3})(?!\d)/g, "$1$2");
  } while (curr !== prev);
  return curr;
}

function extractNumberTokens(s: string): string[] {
  const normalized = normalizeNumberFormatting(s);
  const matches = normalized.match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(matches)];
}

/**
 * Strict numeric match: every search number must appear as an exact token
 * (after digit-grouping normalisation) in the product name. Prevents
 * "1" from matching "1.5" or "10".
 */
function numbersMatchProduct(searchNumbers: string[], productName: string): boolean {
  if (searchNumbers.length === 0) return true;
  const productNumbers = new Set(extractNumberTokens(productName));
  return searchNumbers.every(n => productNumbers.has(n));
}

/**
 * More-specific formulation groups must come BEFORE the generic ones so that
 * "Orodispersible Tablets" is classified differently from plain "Tablets",
 * and "Modified-Release Tablets" differently from immediate-release "Tablets".
 */
const FORMULATION_GROUPS: { group: string; keywords: string[] }[] = [
  { group: "orodispersible-tablet",    keywords: ["ORODISPERSIBLE"] },
  { group: "effervescent-tablet",      keywords: ["EFFERVESCENT"] },
  { group: "chewable-tablet",          keywords: ["CHEWABLE"] },
  { group: "dispersible-tablet",       keywords: ["DISPERSIBLE TABLET", "DISPERSIBLE TABLETS"] },
  { group: "modified-release-tablet",  keywords: ["MODIFIED-RELEASE", "MODIFIED RELEASE", "PROLONGED-RELEASE", "PROLONGED RELEASE", "EXTENDED-RELEASE", "EXTENDED RELEASE"] },
  { group: "tablet",        keywords: ["TABLETS", "TABLET", "CAPLETS", "CAPLET"] },
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
    const matched = keywords.some(kw => {
      const kwNorm = normalizeText(kw);
      if (kwNorm.includes(" ")) return norm.includes(kwNorm);
      return new RegExp(`\\b${kwNorm}\\b`).test(norm);
    });
    if (matched) return group;
  }
  return null;
}

/**
 * Words that are acceptable "extras" / noise — pharmaceutical salt forms,
 * unit abbreviations, and formulation qualifiers that MHRA may add to a
 * product name but that users typically omit (or vice-versa). These words
 * should not count towards drug-name matching for generics.
 */
const PHARMACEUTICAL_TOLERATED_EXTRAS = new Set([
  // Connectors
  "AS", "AND", "WITH", "FOR",
  // Salt / counterion forms
  "SODIUM", "POTASSIUM", "CALCIUM", "MAGNESIUM", "ZINC", "IRON",
  "FERROUS", "FERRIC", "ALUMINIUM", "ALUMINUM",
  "HYDROCHLORIDE", "HCL", "HYDROBROMIDE",
  "PHOSPHATE", "DIHYDROGEN", "MONOHYDROGEN",
  "SULFATE", "SULPHATE", "BISULFATE", "BISULPHATE",
  "ACETATE", "DIACETATE", "TRIACETATE",
  "MALEATE", "FUMARATE", "SUCCINATE", "TARTRATE", "CITRATE",
  "GLUCONATE", "LACTATE", "NITRATE",
  // NOTE: CARBONATE and BICARBONATE are intentionally NOT here — when paired
  // with a metal cation (e.g. "Sodium Bicarbonate", "Calcium Carbonate") they
  // are the discriminating drug component, not just a salt counterion.
  "BROMIDE", "CHLORIDE", "IODIDE", "FLUORIDE", "OXIDE", "HYDROXIDE",
  "MESYLATE", "BESYLATE", "TOSYLATE", "EMBONATE", "PAMOATE",
  "BESILATE", "MESILATE",
  // Hydration states
  "MONOHYDRATE", "DIHYDRATE", "TRIHYDRATE", "TETRAHYDRATE",
  "ANHYDROUS", "HEMIHYDRATE", "SESQUIHYDRATE", "HYDRATE",
  // Dose units
  "MICROGRAMS", "MICROGRAM", "MCG",
  "MILLIGRAMS", "MILLIGRAM", "MG",
  "MILLILITRES", "MILLILITRE", "MILLILITERS", "MILLILITER", "ML",
  "GRAMS", "GRAM", "G", "KG",
  "IU", "UNITS", "UNIT", "NANOGRAMS", "NANOGRAM", "NG",
  "MMOL", "NMOL", "MOL", "MEQ",
  "PERCENT", "%", "W", "V",
  // Release modifiers
  "MODIFIED", "RELEASE", "MR",
  "PROLONGED", "EXTENDED", "XL", "XR",
  "SUSTAINED", "SR",
  "CONTROLLED", "CR",
  "IMMEDIATE", "IR",
  "DELAYED", "LA", "ER", "PR",
  // Coating / presentation
  "GASTRO", "RESISTANT", "ENTERIC", "COATED", "FILM", "HARD",
  "SOFT", "SUGAR", "DISPERSIBLE", "EFFERVESCENT", "CHEWABLE",
  "ORODISPERSIBLE", "SUBLINGUAL", "BUCCAL", "SOLUBLE",
  // Common qualifiers MHRA adds
  "ORAL", "INFUSION", "CONCENTRATE",
  "INHALATION", "NEBULISER", "NEBULIZER", "INTRAVENOUS",
  "INTRAMUSCULAR", "SUBCUTANEOUS", "TOPICAL", "TRANSDERMAL",
  "BP", "BPC", "USP", "EP",
]);

/**
 * Single-word formulation nouns. Excluded from "core drug words" because the
 * formulation is matched separately via FORMULATION_GROUPS.
 */
const FORMULATION_NOUNS = new Set([
  "TABLET", "TABLETS",
  "CAPSULE", "CAPSULES",
  "CAPLET", "CAPLETS",
  "SOLUTION", "SOLUTIONS",
  "SUSPENSION", "SUSPENSIONS",
  "INJECTION", "INJECTIONS",
  "INFUSION", "INFUSIONS",
  "CREAM", "CREAMS",
  "GEL", "GELS",
  "OINTMENT", "OINTMENTS",
  "DROPS", "DROP",
  "SPRAY", "SPRAYS",
  "GRANULES", "GRANULE",
  "POWDER", "POWDERS",
  "SUPPOSITORY", "SUPPOSITORIES",
  "PATCH", "PATCHES",
  "LOZENGE", "LOZENGES",
  "PESSARY", "PESSARIES",
  "EMULSION", "EMULSIONS",
  "LOTION", "LOTIONS",
  "FOAM", "FOAMS",
  "PASTE", "PASTES",
  "ENEMA", "ENEMAS",
  "INHALER", "INHALERS",
  "SACHET", "SACHETS",
  "PASTILLE", "PASTILLES",
  "SYRUP", "SYRUPS",
  "LIQUID", "LIQUIDS",
  "ELIXIR", "ELIXIRS",
]);

function isPureNumberToken(w: string): boolean {
  return /^\d+(\.\d+)?$/.test(w);
}

/**
 * If the token is a number followed by a unit (e.g. "500MG", "1.5G",
 * "12MMOL"), return the unit; otherwise null.
 */
function unitOfNumberWithUnit(w: string): string | null {
  const m = w.match(/^\d+(?:\.\d+)?([A-Z]+)$/);
  return m ? m[1] : null;
}

/**
 * A "core" search word is something that meaningfully identifies the drug —
 * i.e. NOT a number, dose-with-unit, salt/counterion, formulation noun, or
 * other pharmaceutical noise.
 */
function isCoreSearchWord(w: string): boolean {
  if (w.length <= 2) return false;
  if (isPureNumberToken(w)) return false;
  if (PHARMACEUTICAL_TOLERATED_EXTRAS.has(w)) return false;
  if (FORMULATION_NOUNS.has(w)) return false;
  const unit = unitOfNumberWithUnit(w);
  if (unit && (PHARMACEUTICAL_TOLERATED_EXTRAS.has(unit) || FORMULATION_NOUNS.has(unit))) return false;
  return true;
}

function getCoreSearchWords(searchTerm: string): string[] {
  return [...new Set(splitWords(searchTerm).filter(isCoreSearchWord))];
}

/**
 * Every core word from the search term must appear in the product name
 * (allowing prefix-tolerant matching, e.g. "BICARBONATE" matches
 * "BICARBONATES").
 */
function productContainsAllCoreWords(coreWords: string[], productName: string): boolean {
  if (coreWords.length === 0) return true;
  const productWords = splitWords(productName);
  return coreWords.every(cw =>
    productWords.some(pw => pw === cw || pw.startsWith(cw) || cw.startsWith(pw))
  );
}

function countBrandWords(productWords: string[], searchWords: string[]): number {
  return productWords.filter(pw => {
    if (/^\d+(\.\d+)?$/.test(pw)) return false;
    if (PHARMACEUTICAL_TOLERATED_EXTRAS.has(pw)) return false;
    if (FORMULATION_NOUNS.has(pw)) return false;
    if (searchWords.some(sw => pw.startsWith(sw) || sw.startsWith(pw))) return false;
    return true;
  }).length;
}

export interface PickBestOptions {
  /**
   * If provided, core drug words are extracted from this string instead of
   * from `searchTerm`. Used by the parenthetical-fallback path to recover
   * from typos in the user-provided drug/brand name.
   */
  coreWordsOverride?: string;
  /**
   * If true, dose-number filtering is treated as a soft preference rather
   * than a hard requirement — used in fallback paths where the brand name
   * uniquely identifies the product even if the dose isn't part of the
   * MHRA product title.
   */
  softNumbers?: boolean;
}

export function pickBestResult(
  results: PilResult[],
  brand: string,
  searchTerm?: string,
  options?: PickBestOptions,
): PilResult | undefined {
  if (results.length === 0) return undefined;

  const brandUpper = brand.toUpperCase();
  const coreSource = options?.coreWordsOverride ?? searchTerm ?? "";
  const coreWords = getCoreSearchWords(coreSource);
  const searchNumbers = searchTerm ? extractNumberTokens(searchTerm) : [];
  const formulationGroup = searchTerm ? detectFormulationGroup(searchTerm) : null;
  const softNumbers = options?.softNumbers ?? false;

  /** HARD formulation filter: if the search specifies a formulation, require it. */
  function applyFormulationFilter(pool: PilResult[]): PilResult[] {
    if (!formulationGroup || pool.length === 0) return pool;
    return pool.filter(r => detectFormulationGroup(r.productName) === formulationGroup);
  }

  if (brandUpper === "GENERIC") {
    // 1. Drug-name match: ALL core search words must appear in the product
    const withCore = coreWords.length > 0
      ? results.filter(r => productContainsAllCoreWords(coreWords, r.productName))
      : results;
    if (withCore.length === 0) return undefined;

    // 2. Strict dose-number match
    const withNumbers = withCore.filter(r => numbersMatchProduct(searchNumbers, r.productName));
    const numberPool = withNumbers.length > 0
      ? withNumbers
      : (softNumbers ? withCore : []);
    if (numberPool.length === 0) return undefined;

    // 3. HARD formulation filter
    const candidates = applyFormulationFilter(numberPool);
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    // 4. Score: prefer truly-generic products with fewest extra/brand-like words
    const searchWords = splitWords(coreSource).filter(w => w.length > 1);
    const scored = candidates.map(r => {
      const productWords = splitWords(r.productName);
      const brandWordCount = countBrandWords(productWords, searchWords);
      const missing = searchWords.filter(
        sw => !productWords.some(pw => pw.startsWith(sw) || sw.startsWith(pw))
      ).length;
      const extra = productWords.filter(
        pw => !searchWords.some(sw => pw.startsWith(sw) || sw.startsWith(pw))
      ).length;
      return { result: r, brandWordCount, missing, extra };
    });

    scored.sort((a, b) =>
      a.brandWordCount - b.brandWordCount ||
      a.missing - b.missing ||
      a.extra - b.extra
    );

    return scored[0].result;

  } else {
    // BRANDED
    // 1. Brand-name match (mandatory)
    const withBrand = results.filter(r => brandWordsMatch(brand, r.productName));
    if (withBrand.length === 0) return undefined;

    // 2. Dose-number match — SOFT for branded: many brands omit the dose
    //    from the product name (e.g. "ADCAL-D3 CHEWABLE TABLETS"), so fall
    //    back to the brand-only pool when number filtering yields nothing.
    const withNumbers = searchNumbers.length > 0
      ? withBrand.filter(r => numbersMatchProduct(searchNumbers, r.productName))
      : withBrand;
    const numberPool = withNumbers.length > 0 ? withNumbers : withBrand;

    // 3. HARD formulation filter (when specified)
    const candidates = applyFormulationFilter(numberPool);
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    // 4. Score: prefer fewest "extra" words (e.g. avoid LEMON / DISSOLVE
    //    variants when the user didn't mention them).
    const searchWords = searchTerm ? splitWords(searchTerm).filter(w => w.length > 1) : [];
    const scored = candidates.map(r => {
      const productWords = splitWords(r.productName);
      const extra = productWords.filter(
        pw =>
          !searchWords.some(sw => pw.startsWith(sw) || sw.startsWith(pw)) &&
          !PHARMACEUTICAL_TOLERATED_EXTRAS.has(pw) &&
          !FORMULATION_NOUNS.has(pw) &&
          !/^\d+(\.\d+)?$/.test(pw)
      ).length;
      return { result: r, extra };
    });
    scored.sort((a, b) => a.extra - b.extra);
    return scored[0].result;
  }
}

export function buildSearchQuery(searchTerm: string, brand: string): string {
  if (brand === "GENERIC") return searchTerm;
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

/** Return the contents of the first parenthetical, e.g. "(Sodium Acid Phosphate)" -> "Sodium Acid Phosphate". */
export function extractParenthetical(s: string): string | null {
  const match = s.match(/\(([^()]+)\)/);
  return match ? match[1].trim() : null;
}
