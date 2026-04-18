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
