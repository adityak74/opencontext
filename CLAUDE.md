# CLAUDE.md — AI Assistant Guide for opencontext

## Project Overview

**opencontext** is a tool that lets users migrate their full chat history from AI providers (ChatGPT, Google Gemini, etc.) into Claude-compatible formats. It ships as both a **CLI** and a **web UI**, and includes an **MCP server** so Claude itself can save and recall context across conversations.

### The Problem

When users switch to Claude, they lose all prior conversation context from other AI platforms. Chat exports from providers like ChatGPT come in provider-specific JSON formats that Claude can't read directly.

### The Solution

opencontext reads exported conversation archives, normalizes them, and outputs Claude-compatible conversation data — so users can hit the ground running on a new Claude account with their full history.

### Supported Sources

- **ChatGPT** — `conversations.json` from the ChatGPT data export (Settings → Export data) ✅ Implemented
- **Google Gemini** — Gemini activity export via Google Takeout (planned)
- **Other providers** — Extensible parser system for adding new sources

### Components

1. **CLI** (`src/`) — Node.js/TypeScript CLI for batch converting chat exports
2. **HTTP server** (`src/server.ts`) — Express REST API that serves the built UI and exposes the conversion pipeline + context store over HTTP
3. **Web UI** (`ui/`) — React + Vite dashboard for managing preferences, importing conversations, and exporting to multiple vendors
4. **MCP server** (`src/mcp/`) — Model Context Protocol server that lets Claude save/recall persistent context

### Docker Hub

**Image:** [`adityakarnam/opencontext:latest`](https://hub.docker.com/r/adityakarnam/opencontext)

Single image containing UI + API server + MCP server. Default CMD runs the HTTP server on port 3000. Override CMD to `node dist/mcp/index.js` for MCP stdio mode.

---

## Repository Structure

```
opencontext/
├── CLAUDE.md                   # This file
├── README.md                   # User-facing docs
├── package.json                # CLI/MCP dependencies and scripts
│
├── src/                        # CLI + HTTP server + MCP server
│   ├── index.ts                # CLI entry point (Commander.js)
│   ├── server.ts               # Express HTTP server (UI + REST API, port 3000)
│   ├── extractor.ts            # ZIP extraction & temp file management
│   ├── parsers/
│   │   ├── types.ts            # TypeScript interfaces for parser output
│   │   ├── chatgpt.ts          # ChatGPT conversations.json parser
│   │   └── normalizer.ts       # Normalize parsed data to common schema
│   ├── formatters/
│   │   └── markdown.ts         # Markdown output formatter
│   ├── analyzers/
│   │   └── ollama-preferences.ts  # AI-powered preference analysis via Ollama
│   ├── utils/
│   │   └── file.ts             # File I/O utilities
│   └── mcp/                    # MCP server
│       ├── index.ts            # MCP entry point (stdio transport)
│       ├── server.ts           # Tool definitions (save/recall/list/search/update/delete)
│       ├── store.ts            # JSON file-based context store (~/.opencontext/contexts.json)
│       └── types.ts            # ContextEntry, ContextStore types
│
├── ui/                         # Web UI (React + Vite)
│   ├── package.json            # UI dependencies (React 19, React Router 7, Lucide)
│   ├── vite.config.ts          # Vite build config
│   ├── src/
│   │   ├── main.tsx            # React app entry
│   │   ├── App.tsx             # Router and route definitions
│   │   ├── App.css             # App-level styles
│   │   ├── index.css           # Global reset, Tailwind directives, shadcn CSS variables
│   │   ├── components/
│   │   │   ├── Layout.tsx          # App shell with sidebar nav
│   │   │   ├── Dashboard.tsx       # Home page: context overview + privacy toggle + MCP setup
│   │   │   ├── PreferencesEditor.tsx  # Full preferences form (6 sections)
│   │   │   ├── ContextViewer.tsx   # Conversation import and management
│   │   │   ├── ConversionPipeline.tsx # Pipeline progress visualization
│   │   │   └── VendorExport.tsx    # Export to Claude/ChatGPT/Gemini
│   │   ├── store/
│   │   │   └── context.tsx         # React Context + useReducer state management
│   │   ├── types/
│   │   │   └── preferences.ts      # Shared TypeScript types
│   │   └── exporters/
│   │       ├── index.ts            # Exporter registry
│   │       ├── base.ts             # VendorExporter interface
│   │       ├── claude.ts           # Claude preferences/memory exporter
│   │       ├── chatgpt.ts          # ChatGPT custom instructions exporter
│   │       └── gemini.ts           # Gemini instructions exporter
│
└── tests/                      # CLI test suite (vitest)
    └── ...
```

---

## Tech Stack

### CLI / MCP Server (`src/`)
- **Runtime**: Node.js 25+ / TypeScript 5.9
- **CLI framework**: Commander.js
- **MCP**: `@modelcontextprotocol/sdk`
- **AI analysis**: Ollama (local LLM, optional)
- **ZIP handling**: adm-zip
- **Build**: `tsc`, run with `tsx` in dev

### Web UI (`ui/`)
- **Framework**: React 19 with TypeScript
- **Build tool**: Vite 7 (requires Node 25+)
- **Routing**: React Router DOM 7
- **Icons**: Lucide React
- **Styling**: Tailwind CSS v4 + shadcn/ui (new-york style, zinc base, pitch black theme)
- **shadcn/ui components**: button, badge, card, input, textarea, select, checkbox, label, separator, scroll-area, tooltip
- **State**: React Context + useReducer (no Redux/Zustand)

---

## UI Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | Dashboard | Context snapshot, stats, privacy toggle, MCP setup guide |
| `/preferences` | PreferencesEditor | Full 6-section preference form |
| `/conversations` | ContextViewer | Import and manage conversations |
| `/pipeline` | ConversionPipeline | Pipeline progress view |
| `/export` | VendorExport | Export to Claude/ChatGPT/Gemini |

---

## MCP Server

The MCP server (`src/mcp/`) provides 6 tools:

| Tool | Description |
|------|-------------|
| `save_context` | Save a memory/note with optional tags and source |
| `recall_context` | Full-text search across saved contexts |
| `list_contexts` | List all contexts, optionally filtered by tag |
| `search_contexts` | Multi-keyword AND search across all contexts |
| `update_context` | Update content/tags of an existing context |
| `delete_context` | Remove a context by ID |

**Storage**: pluggable (BYODB). Defaults to `~/.opencontext/contexts.json`; set
`OPENCONTEXT_DB_URL` to use any of the 15 supported backends. `OPENCONTEXT_STORE_PATH` still
works and maps onto the JSON adapter.

**Running**:
```bash
# Dev mode
npm run mcp:server

# Production (after build)
node dist/mcp/index.js
```

**Claude Code / Claude Desktop — Docker (recommended):**
```json
{
  "mcpServers": {
    "opencontext": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "opencontext-data:/root/.opencontext",
               "adityakarnam/opencontext:latest", "node", "dist/mcp/index.js"]
    }
  }
}
```

**Claude Code — local Node.js build** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "opencontext": {
      "command": "node",
      "args": ["PATH_TO_PROJECT/dist/mcp/index.js"]
    }
  }
}
```

---

## BYODB — Pluggable Databases

The context store is an **async adapter interface** (`src/store/types.ts`), not a JSON file.
Fifteen backends implement it. When touching this area, the important things to know:

### Three adapter families

| Family | Shared implementation | Backends |
|---|---|---|
| File | `adapters/json.ts` | json |
| SQL | `adapters/sql.ts` + a `Dialect` per engine | sqlite, libsql, d1, duckdb, postgres, cloudsql, mysql, mssql |
| Document / KV | `adapters/document.ts` + a `DocumentDriver` per engine | memory, mongodb, redis, firestore, dynamodb |
| Multi-model | `adapters/surreal.ts` (bespoke) | surrealdb |

**CRUD is written once per family.** Adding a SQL engine means supplying a `Dialect`
(placeholder style, DDL, concat) and a ~50-line driver. Adding a NoSQL engine means
implementing six `DocumentDriver` methods. Do not reimplement the storage contract per backend.

### The conformance suite is the contract

`tests/store/conformance.ts` holds ~50 tests that every adapter must pass. It is the only
definition of correct behaviour, and **it must never be weakened to make a backend pass** —
if a backend cannot satisfy it, that is a finding to document, not a test to relax.

It runs with no external services against **json**, **sqlite** and **memory** (covering all
three families), and against the rest when their connection strings are in the environment:

```bash
docker compose -f docker-compose.test.yml up -d
OPENCONTEXT_TEST_POSTGRES_URL="postgres://opencontext:opencontext@127.0.0.1:55432/opencontext" \
  npm run test:backends
docker compose -f docker-compose.test.yml down -v
```

### Invariants to preserve

- **Ordering**: every list method returns `createdAt ASC, id ASC`. Identical across backends.
- **Search semantics**: case-insensitive substring over content/tags/source; `searchContexts`
  requires all terms.
- **Absent vs null**: an unset `bubbleId`/`description` must come back `undefined`, never
  `null`. Several drivers need explicit configuration to honour this.
- **Read-your-writes**: a write must be visible to the next read. DynamoDB needs
  `ConsistentRead: true` for this.
- **Credentials never leak**: everything user-visible goes through `redactDsn()`.
- **Drivers pass `dsn.canonical`, never `dsn.raw`** — client libraries reject the aliases we
  advertise, and `rediss://` / `mongodb+srv://` carry meaning that must survive.

### Adding a backend

1. Add the scheme to `DbScheme` (`types.ts`) and `SUPPORTED_SCHEMES` (`dsn.ts`)
2. Parse any backend-specific fields in `dsn.ts`
3. Write a driver in `src/store/drivers/` — a `Dialect` + `SqlDriver`, or a `DocumentDriver`
4. Register it in `ADAPTERS` and the `build()` switch in `src/store/index.ts`
5. Load it with `importOptional()` so a missing package produces an install instruction
6. Add it to `peerDependencies` + `peerDependenciesMeta` as optional
7. Add a service to `docker-compose.test.yml` and a line to `tests/store/backends.test.ts`
8. Run the conformance suite against it until all tests pass

---

## Key Concepts

### Conversion Pipeline

```
[ChatGPT export JSON]  →  Parser  →  [Normalized Schema]  →  Formatter  →  [Claude format]
[Gemini export]        →  Parser  ↗                        ↘
```

All source formats are parsed into a single **normalized conversation schema**, then a Claude formatter outputs the final result.

### Normalized Conversation Schema

- **Conversation** — `id`, `title`, `created`, `updated`, `messages[]`, `selected`
- **Message** — `role` (`user` | `assistant` | `system`), `content`, `timestamp`, optional `images`, `metadata`

### UI State Shape

```typescript
{
  preferences: UserPreferences,       // Full preference tree
  conversations: NormalizedConversation[],
  pipeline: PipelineState
}
```

### Privacy Toggle (Dashboard)

The Dashboard has an eye icon toggle that blurs personally-identifiable fields (role, industry, background, interests, focus, conversation titles) using CSS `filter: blur(5px)`. Useful for screensharing or when others are nearby. Tech profile (languages, frameworks, tools) and communication style are not considered PII and stay visible.

### Exporter Pattern

```typescript
interface VendorExporter {
  info: VendorInfo
  exportPreferences(preferences: UserPreferences): ExportResult
  exportConversations(conversations, preferences): ExportResult
}
```

Register new exporters in `ui/src/exporters/index.ts`.

---

## Development Workflow

### CLI Development

```bash
npm install
npm run dev convert path/to/chatgpt-export.zip
npm run build
npm test
npm run test:coverage
```

### HTTP Server Development

```bash
npm run server        # Start Express server in dev mode (tsx, port 3000)
npm run server:prod   # Start from compiled dist/ (after npm run build)
```

The server serves `public/` as the UI. To get a full local stack:
```bash
cd ui && npm run build && cd ..   # Build UI into ui/dist/
cp -r ui/dist public/              # (or let Docker do it)
npm run server                     # Server picks up public/
```

### MCP Server Development

```bash
npm run mcp:server    # Start MCP server in dev mode
npm run build         # Build for production use
```

### UI Development

```bash
cd ui
npm install
npm run dev           # Start Vite dev server
npm run build         # Production build (requires Node 25+)
npm run lint          # ESLint check
```

### Docker (single image)

```bash
docker build -t adityakarnam/opencontext:latest .
docker run -p 3000:3000 -v opencontext-data:/root/.opencontext adityakarnam/opencontext:latest
# or
docker compose up app
```

Push to Docker Hub:
```bash
docker push adityakarnam/opencontext:latest
```

### Common Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run CLI test suite (vitest) |
| `npm run build` | Compile TypeScript (CLI + server + MCP) |
| `npm run server` | Run HTTP server in dev mode |
| `npm run mcp:server` | Run MCP server in dev mode |
| `npm run test:backends` | Run store conformance against configured databases |
| `npm run db -- status` | Show the current database backend |
| `npm run db -- adapters` | List every backend and whether its driver is installed |
| `cd ui && npm run dev` | Start UI dev server |
| `cd ui && npm run build` | Build UI |

---

## Conventions for AI Assistants

### Code Style

- Keep functions small and focused
- Use descriptive variable names — no abbreviations
- Prefer explicit error handling over silent failures
- Type all function parameters and return values
- Handle malformed export data gracefully — users may have partial or corrupted exports
- UI components: use Tailwind CSS v4 utility classes and shadcn/ui components — do not introduce CSS-in-JS or CSS modules
- No unnecessary abstractions — three similar lines beat a premature abstraction

### Adding a New Source Provider

1. Study the provider's export format (request a data export, inspect the JSON/files)
2. Create a parser in `src/parsers/<provider>.ts` implementing the base parser interface
3. Map the provider's roles, content types, and metadata to the normalized schema
4. Add sample fixture data in `tests/fixtures/<provider>/`
5. Write parser tests covering normal conversations, edge cases (empty messages, multimedia, long threads)
6. Register the parser in the CLI argument handling

### Adding a New Vendor Exporter (UI)

1. Create `ui/src/exporters/<vendor>.ts` implementing `VendorExporter`
2. Register in `ui/src/exporters/index.ts`
3. Add vendor card in `VendorExport.tsx`

### Commit Messages

- Use conventional commit format: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Keep the subject line under 72 characters
- Reference issue numbers when applicable

### What NOT to Do

- Do not add unnecessary abstractions or over-engineer
- Do not add dependencies without clear justification
- Do not modify CI/CD configs without being asked
- Do not introduce breaking changes to the CLI interface without discussion
- Do not commit generated files, build artifacts, or secrets
- Do not include real user conversation data in tests — use anonymized fixtures only
- Do not introduce CSS-in-JS or CSS modules — use Tailwind CSS v4 utilities and shadcn/ui components

### Privacy Considerations

- Conversation exports contain personal data — never log, upload, or persist user content beyond the conversion output
- Test fixtures must use synthetic/anonymized data
- The tool runs entirely locally — no network calls
- The UI dashboard privacy toggle blurs PII fields; keep this working when editing Dashboard.tsx
