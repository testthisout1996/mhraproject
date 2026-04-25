# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (not currently used)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### MHRA PIL Finder (`artifacts/pil-finder`)
- React + Vite frontend app served at `/`
- Searches the MHRA products database for Patient Information Leaflets (PILs)
- Filters results by: document type = PIL, territory = UK
- Results include product name, active substances, PL numbers, file size, date, and direct PDF link

#### PIL Selection Logic (`src/lib/pilUtils.ts`)
- **Strict number-token matching**: search numbers must appear as exact tokens in the product (so "1" doesn't match "1.5"; digit-grouping like "1 000"/"25 000" is normalized first).
- **Generic drug match**: ALL "core" search words (non-number, non-unit, non-formulation, non-extras) must appear in the product name. CARBONATE and BICARBONATE are intentionally treated as core words (not extras), since they are the discriminating drug component when paired with a metal cation.
- **Branded drug match**: brand-name match is mandatory; dose-number match is soft (falls back to brand pool when the brand omits the dose, e.g. "ADCAL-D3 CHEWABLE TABLETS"). Branded results are scored by fewest "extra" words to avoid e.g. "LEMON" / "DISSOLVE" variants.
- **Hard formulation filter**: when the search specifies a formulation (Tablets, Capsules, etc.), products with a different formulation are rejected (so "Sodium Bicarbonate 500mg Tablets" returns NOT FOUND rather than the matching CAPSULES product).
- **Parenthetical typo fallback**: when both branded and generic searches fail, an active-ingredient name in parentheses (e.g. "Phoshate Sandoz (Sodium Acid Phosphate) ...") is used as a typo-tolerant secondary search.

### API Server (`artifacts/api-server`)
- Express 5 API server at `/api`
- Route: `GET /api/mhra/search?q=...&page=...&pageSize=...`
  - Proxies to Azure Search: `https://mhraproducts4853.search.windows.net/indexes/products-index/docs`
  - Filters by `doc_type eq 'Pil' and territory eq 'UK'`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
