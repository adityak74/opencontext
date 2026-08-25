<div align="center">

> **🔌 MCP Server available** — Give Claude persistent memory across every conversation. Install the open-context MCP server and Claude can save, recall, and search your context automatically. [Jump to setup →](#-mcp-server)

<img src="opencontext-logo.png" alt="open-context logo" width="120" />

# open-context

### Your AI memory, portable and private

**Import** chat history from any AI platform · **Manage** context with MCP · **Export** to Claude, ChatGPT, or Gemini

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D25.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/adityakarnam/open-context)
[![Docker Pulls](https://img.shields.io/docker/pulls/adityakarnam/open-context)](https://hub.docker.com/r/adityakarnam/open-context)
[![Version](https://img.shields.io/badge/version-0.0.1-blue)](https://hub.docker.com/r/adityakarnam/open-context/tags)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)

[Features](#-features) • [BYODB](#byodb) • [Quick Start](#-quick-start) • [Usage](#-usage) • [Documentation](#-documentation) • [Contributing](#-contributing)

<br/>

![open-context UI preview](docs/dashboard.png)

</div>

---

## 📖 Overview

**open-context** is a tool for keeping your AI context portable and persistent. It lets you bring your full conversation history when switching AI assistants, and gives Claude a persistent memory through an MCP server.

- **🎯 Preferences** - AI-analyzed communication style ready for Claude's settings
- **🧠 Memory** - Factual context about you, extracted from your chat history
- **💬 Conversations** - All chats as readable markdown files
- **🔌 MCP Server** - Persistent memory across every Claude conversation

### Why Use This?

Switching AI assistants means losing all prior context — your communication style, background, and conversation history. open-context solves that by:

1. Importing your chat history from ChatGPT (Gemini support planned)
2. Analyzing your patterns with local AI (Ollama) to generate preferences and memory
3. Exporting to Claude, ChatGPT, or Gemini formats
4. Providing an MCP server so Claude can save and recall context automatically

**Result**: Claude knows who you are, how you communicate, and can persist new context across every conversation.

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🤖 AI-Powered Analysis
- Generates communication preferences
- Extracts work context and expertise
- Identifies current topics and focus
- Supports multiple LLM models

</td>
<td width="50%">

### 🔒 Privacy First
- 100% local processing
- No external API calls
- Your data never leaves your machine
- Dashboard privacy toggle blurs PII

</td>
</tr>
<tr>
<td width="50%">

### 📦 Complete Migration
- Parses complex conversation trees
- Handles images and attachments
- Preserves all metadata
- Export to Claude, ChatGPT, or Gemini

</td>
<td width="50%">

### 🔌 MCP Server
- Persistent context across Claude chats
- Save, recall, search, and tag memories
- Works with Claude Code & Claude Desktop
- Store it in **any database you like** (BYODB)

</td>
</tr>
</table>


---

<a id="byodb"></a>

## 🗄️ Bring Your Own Database (BYODB)

By default opencontext keeps everything in a JSON file at `~/.opencontext/contexts.json` — zero
configuration, nothing to install. When you outgrow that, point it at any of **15 backends**
without changing how the CLI, the web UI, or the MCP tools behave.

<p align="center">
<img src="ui/public/db-logos/json.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/sqlite.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/d1.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/duckdb.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/libsql.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/postgres.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/cloudsql.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/mysql.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/mssql.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/mongodb.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/redis.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/firestore.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/dynamodb.svg" width="30" height="30" alt=""> <img src="ui/public/db-logos/surrealdb.svg" width="30" height="30" alt="">
</p>

```bash
# See what is available and what is installed
opencontext db adapters

# Try a connection without committing to it
opencontext db test "postgres://user:pass@localhost:5432/opencontext"

# Switch to it, and bring your existing history along
opencontext db use "postgres://user:pass@localhost:5432/opencontext"
opencontext db migrate --to "postgres://user:pass@localhost:5432/opencontext"
```

Or use the **Database** page in the web UI: pick a backend, test the connection, save it, and
copy your data across — no terminal required.

### Supported backends

| Backend | Connection string | Install |
|---|---|---|
| <img src="ui/public/db-logos/json.svg" width="16" height="16" alt=""> **JSON file** *(default)* | `json:///path/to/contexts.json` | — built in |
| **In-memory** | `memory://` | — built in |
| <img src="ui/public/db-logos/sqlite.svg" width="16" height="16" alt=""> **SQLite** | `sqlite:///path/to/opencontext.db` | — built in (`node:sqlite`) |
| <img src="ui/public/db-logos/d1.svg" width="16" height="16" alt=""> **Cloudflare D1** | `d1://ACCOUNT_ID/DATABASE_ID?apiToken=TOKEN` | — built in (HTTP) |
| <img src="ui/public/db-logos/duckdb.svg" width="16" height="16" alt=""> **DuckDB** | `duckdb:///path/to/opencontext.duckdb` | `npm i @duckdb/node-api` |
| <img src="ui/public/db-logos/libsql.svg" width="16" height="16" alt=""> **libSQL / Turso** | `libsql://DB.turso.io?authToken=TOKEN` | `npm i @libsql/client` |
| <img src="ui/public/db-logos/postgres.svg" width="16" height="16" alt=""> **PostgreSQL** | `postgres://user:pass@host:5432/db` | `npm i pg` |
| <img src="ui/public/db-logos/cloudsql.svg" width="16" height="16" alt=""> **Google Cloud SQL** | `cloudsql://user:pass@PROJECT:REGION:INSTANCE/db` | `npm i @google-cloud/cloud-sql-connector pg` |
| <img src="ui/public/db-logos/mysql.svg" width="16" height="16" alt=""> **MySQL / MariaDB** | `mysql://user:pass@host:3306/db` | `npm i mysql2` |
| <img src="ui/public/db-logos/mssql.svg" width="16" height="16" alt=""> **SQL Server / Azure SQL** | `mssql://user:pass@host:1433/db` | `npm i mssql` |
| <img src="ui/public/db-logos/mongodb.svg" width="16" height="16" alt=""> **MongoDB** | `mongodb://user:pass@host:27017/db` | `npm i mongodb` |
| <img src="ui/public/db-logos/redis.svg" width="16" height="16" alt=""> **Redis / Valkey** | `redis://host:6379` | `npm i redis` |
| <img src="ui/public/db-logos/firestore.svg" width="16" height="16" alt=""> **Google Firestore** | `firestore://PROJECT_ID` | `npm i @google-cloud/firestore` |
| <img src="ui/public/db-logos/dynamodb.svg" width="16" height="16" alt=""> **Amazon DynamoDB** | `dynamodb://REGION/TABLE` | `npm i @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb` |
| <img src="ui/public/db-logos/surrealdb.svg" width="16" height="16" alt=""> **SurrealDB** | `surrealdb://user:pass@host:8000/ns/db` | `npm i surrealdb` |

Drivers are **optional peer dependencies** — nothing is installed until you ask for a backend
that needs it, so the default install and the Docker image stay small. Pick a backend whose
driver is missing and opencontext tells you exactly what to run.

> **SQL Server and IP addresses.** The driver encrypts by default, and TLS forbids an IP
> address as the SNI server name, so `mssql://…@10.0.0.5:1433/db` fails with a `servername`
> error. Address the server by hostname, or add `?encrypt=false` for a local instance on a
> trusted network.

### Managed services

Most managed databases speak a protocol already listed above, so they need no special support:

| Service | Use |
|---|---|
| Neon, Supabase, Amazon RDS/Aurora, Azure Database for PostgreSQL, CockroachDB, Timescale | `postgres://…` (add `?sslmode=require`) |
| PlanetScale, Azure Database for MySQL, Cloud SQL for MySQL, Aurora MySQL | `mysql://…?ssl=true` |
| Azure Cosmos DB (MongoDB API), MongoDB Atlas | `mongodb://…` / `mongodb+srv://…` |
| Upstash, ElastiCache, Valkey | `redis://…` or `rediss://…` for TLS |
| Turso | `libsql://…` |

### Configuration

The store is resolved in this order — the first one that is set wins:

1. `OPENCONTEXT_DB_URL` environment variable
2. `database.url` in `~/.opencontext/config.json` (what the UI and `db use` write)
3. `OPENCONTEXT_STORE_PATH` — the legacy setting, still honoured
4. Default: `~/.opencontext/contexts.json`

Because the environment wins, a container can pin the database regardless of what is saved
locally. **Existing installs need to do nothing** — with no configuration at all, opencontext
reads the same JSON file it always has.

```bash
# Docker with Postgres
docker run -p 3000:3000 \
  -e OPENCONTEXT_DB_URL="postgres://user:pass@db.internal:5432/opencontext" \
  adityakarnam/opencontext:latest
```

### Choosing a backend

- **Staying on one machine?** The default JSON file is fine. Move to **SQLite** when you have
  thousands of contexts or run the HTTP and MCP servers at once — it needs no install and
  writes only what changed instead of rewriting the whole store.
- **Sharing context across machines?** Any of the remote backends. **PostgreSQL** is the
  best-supported, and every predicate runs in the database.
- **Already run a database?** Use it. That is the point.

A note on how search behaves: the SQL backends push filtering down into the database. The
document and key-value backends (MongoDB, Redis, Firestore, DynamoDB) have no portable
case-insensitive substring predicate, so opencontext reads the context collection and filters
in memory. Results are identical — every backend passes the same conformance suite — but on a
very large store a SQL backend will be faster.

### Security

Connection strings carry passwords, so `~/.opencontext/config.json` is written with owner-only
(`0600`) permissions and credentials are redacted from every API response, log line, and UI
field. Nothing is sent anywhere: your process connects directly to your database.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 25+** - [Download](https://nodejs.org/)
- **ChatGPT Export** - [How to export](#-getting-your-chatgpt-export)
- **Ollama** (optional) - [Install](https://ollama.ai/) for AI analysis

### Installation

```bash
# Clone the repository
git clone https://github.com/adityak74/opencontext.git
cd opencontext

# Install CLI/MCP dependencies
npm install

# Build the project
npm run build
```

### Option A: Docker (Recommended)

The official image bundles the UI, REST API server, and MCP server into one container. Preferences and context are stored in the mounted volume — no browser storage used.

```bash
# Pull and run — UI at http://localhost:3000
docker run -p 3000:3000 \
  -v opencontext-data:/root/.opencontext \
  adityakarnam/open-context:latest
```

Ollama on your host machine is automatically reachable via `host.docker.internal:11434`. To use a different host:

```bash
docker run -p 3000:3000 \
  -e OLLAMA_HOST=http://my-ollama-host:11434 \
  -v opencontext-data:/root/.opencontext \
  adityakarnam/open-context:latest
```

Or build locally:

```bash
docker build -t adityakarnam/open-context:latest .
docker run -p 3000:3000 -v opencontext-data:/root/.opencontext adityakarnam/open-context:latest
```

**What gets stored in the volume (`/root/.opencontext/`):**

| File | Contents |
|------|----------|
| `preferences.json` | Your structured preferences (form data) |
| `preferences.md` | Generated Claude preferences doc (ready to paste) |
| `memory.md` | Generated Claude memory doc (ready to paste) |
| `contexts.json` | MCP context store (saved memories) |

### Option B: Local Development (UI + Server)

The UI talks to the backend server for all data — no localStorage. Start both:

```bash
# Terminal 1 — API server (port 3000)
npm install
npm run server

# Terminal 2 — UI dev server (port 5173, proxies /api → 3000)
cd ui && npm install && npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Preferences are saved server-side to `~/.opencontext/`.

### Option C: CLI

```bash
# Convert your ChatGPT export
npm start -- convert path/to/chatgpt-export.zip

# Output will be in ./claude-export/
```

That's it! 🎉 You now have files ready to paste into Claude.

---

## 📂 What Gets Generated

```
claude-export/
├── 📋 preferences.md       # Paste into Claude Settings → Preferences
├── 🧠 memory.md            # Paste into Claude → Manage Memory
├── 👤 user-profile.md      # Your ChatGPT account info
├── 📑 index.md             # Searchable conversation list
└── 💬 conversations/       # Individual markdown files
    ├── 001-first-chat.md
    ├── 002-another-topic.md
    └── ...
```

### preferences.md - Communication Style

**What it contains:**
- How you prefer explanations (detailed, concise, step-by-step)
- Technical depth preferences
- Tone preferences (casual/formal)
- Code formatting preferences

**Example:**
```
I prefer clear and direct explanations that get straight to the point,
especially when the topic is technical. I'd like step-by-step instructions
and concrete code snippets. I'm comfortable with technical language and
enjoy seeing code formatted in Markdown blocks...
```

**Usage:** Copy → Paste into Claude Settings → Preferences field

### memory.md - About You

**What it contains:**
- **Work context** - Your job, technologies, projects
- **Personal context** - Education, expertise, skills
- **Top of mind** - Current focus, recent topics

**Example:**
```
Work context:
User is a senior software engineer working with cloud infrastructure,
Docker, Kubernetes, and VPN solutions. Currently developing AI/ML
deployment systems...

Personal context:
Demonstrates expertise in networking, containerization, Python,
TypeScript, and CI/CD automation...

Top of mind:
Finalizing VPN architecture decisions and exploring AI service
deployment strategies...
```

**Usage:** Copy → Paste into Claude → Manage Memory

---

## 💻 Usage

### CLI Commands

```bash
npm start -- convert <zip-file> [options]
```

### Database commands

```bash
opencontext db status                # which backend is active, and where that came from
opencontext db adapters              # every backend, and whether its driver is installed
opencontext db test "<url>"          # try a connection without saving it
opencontext db use "<url>"           # switch to it
opencontext db migrate --to "<url>"  # copy contexts and bubbles across
opencontext db reset                 # go back to the default JSON file
```

`db migrate` only ever reads the source, so it cannot damage the store you already have. Add
`--replace` to empty the target first, or `--from <url>` to copy between two backends without
switching to either.

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <dir>` | Output directory | `./claude-export` |
| `--model <name>` | Ollama model to use | `gpt-oss:20b` |
| `--ollama-host <url>` | Ollama server URL | `http://localhost:11434` |
| `--skip-preferences` | Skip AI analysis (faster) | `false` |
| `--verbose` | Detailed logging | `false` |
| `-h, --help` | Show help | - |

### Examples

#### Remote Ollama Server
```bash
npm start -- convert export.zip --ollama-host http://192.168.1.100:11434
```

#### Different AI Model
```bash
npm start -- convert export.zip --model qwen2.5:32b
```

#### Fast Mode (No AI)
```bash
npm start -- convert export.zip --skip-preferences
```

#### Custom Output Directory
```bash
npm start -- convert export.zip -o ~/Documents/claude-import
```

#### All Options Combined
```bash
npm start -- convert export.zip \
  -o ~/output \
  --ollama-host http://gpu-server:11434 \
  --model llama3:70b \
  --verbose
```

---

## 📚 Documentation

### Getting Your ChatGPT Export

1. Go to [ChatGPT Settings](https://chat.openai.com/)
2. Click profile → **Settings** → **Data Controls**
3. Click **Export data**
4. Wait for email (usually 1-4 hours)
5. Download the zip file
6. Use with open-context

### Migrating to Claude

#### Step 1: Set Preferences

1. Open `preferences.md`
2. Copy all text
3. Go to [Claude Settings](https://claude.ai/settings) → Preferences
4. Paste into "What personal preferences should Claude consider?"
5. Save changes

#### Step 2: Add Memory

1. Open `memory.md`
2. Copy all text
3. Click profile → **Manage Memory**
4. Paste content
5. Verify and save

#### Step 3: Use Conversations (Optional)

Browse `conversations/` folder and copy relevant chats into Claude for context.

**Alternative:** Create a Claude project and upload files as project knowledge.

### Supported Ollama Models

| Model | Size | Speed | Quality | Recommended For |
|-------|------|-------|---------|-----------------|
| `gpt-oss:20b` | 13GB | Medium | High | Best overall results |
| `qwen2.5:32b` | 20GB | Medium | High | Technical content |
| `llama3:70b` | 40GB | Slow | Highest | Maximum accuracy |
| `llama3:8b` | 5GB | Fast | Good | Quick conversions |

### How It Works

```mermaid
graph LR
    A[ChatGPT ZIP] --> B[Extract]
    B --> C[Parse conversations.json]
    C --> D[Normalize Format]
    D --> E[Generate Markdown]
    E --> F{AI Analysis?}
    F -->|Yes| G[Ollama]
    F -->|No| H[Basic Stats]
    G --> I[preferences.md]
    G --> J[memory.md]
    H --> I
    H --> J
    E --> K[conversations/]
```

**Two AI calls:**
1. **Preferences** - Analyzes communication patterns (HOW you talk)
2. **Memory** - Extracts facts about you (WHO you are)

---

## 🛠️ Development

### Setup Development Environment

```bash
# Clone the repo
git clone https://github.com/adityak74/opencontext.git
cd opencontext

# Install dependencies
npm install
cd ui && npm install && cd ..

# Build TypeScript (CLI + server + MCP)
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run the store conformance suite against real databases
docker compose -f docker-compose.test.yml up -d
npm run test:backends
docker compose -f docker-compose.test.yml down -v
```

`docker-compose.test.yml` lists the connection string to export for each service. A backend
whose connection string is not in the environment is skipped, so the suite is useful with any
subset of them running.

Every backend must pass the same conformance suite (`tests/store/conformance.ts`) unmodified —
it is the only definition of correct storage behaviour. It runs against JSON, SQLite and
in-memory with no external services, covering all three shared implementations.

### Running the full stack locally

The UI talks to the backend server for all data — start both:

```bash
# Terminal 1 — API + MCP server (port 3000)
npm run server

# Terminal 2 — UI dev server (port 5173, proxies /api → 3000)
cd ui && npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Preferences are saved server-side to `~/.opencontext/`.

### Project Structure

```
opencontext/
├── src/                        # CLI + HTTP server + MCP server
│   ├── index.ts                # CLI entry point (Commander.js)
│   ├── server.ts               # Express HTTP server (UI + REST API)
│   ├── extractor.ts            # ZIP extraction & temp management
│   ├── parsers/
│   │   ├── types.ts            # TypeScript interfaces
│   │   ├── chatgpt.ts          # Parse ChatGPT format
│   │   └── normalizer.ts       # Normalize to common schema
│   ├── formatters/
│   │   └── markdown.ts         # Markdown generation
│   ├── analyzers/
│   │   └── ollama-preferences.ts  # AI-powered analysis (Ollama)
│   ├── utils/
│   │   └── file.ts             # File I/O utilities
│   ├── store/                  # BYODB — the pluggable context store
│   │   ├── index.ts            # Adapter registry + factory
│   │   ├── types.ts            # ContextStoreAdapter interface
│   │   ├── dsn.ts              # Connection string parsing + redaction
│   │   ├── config.ts           # Resolution order and saved settings
│   │   ├── manager.ts          # Live connection, reconnect, swap
│   │   ├── migrate.ts          # Copy one store into another
│   │   ├── adapters/           # One CRUD implementation per family
│   │   │   ├── json.ts         #   file
│   │   │   ├── sql.ts          #   all 8 SQL engines, via a Dialect
│   │   │   ├── document.ts     #   document/KV stores, via a DocumentDriver
│   │   │   └── surreal.ts      #   SurrealDB (multi-model)
│   │   └── drivers/            # Per-engine connection code
│   └── mcp/                    # MCP server
│       ├── index.ts            # Entry point (stdio transport)
│       ├── server.ts           # Tool definitions
│       ├── store.ts            # Deprecated re-export of ../store
│       └── types.ts            # Type definitions
│
└── ui/                         # Web dashboard (React + Vite)
    └── src/
        ├── components/
        │   ├── Dashboard.tsx       # Context overview + privacy toggle
        │   ├── PreferencesEditor.tsx
        │   ├── ContextViewer.tsx
        │   ├── ConversionPipeline.tsx
        │   ├── VendorExport.tsx
        │   └── DatabaseSettings.tsx # Pick, test, and migrate backends
        ├── store/context.tsx       # React Context state
        ├── types/preferences.ts   # Shared types
        └── exporters/             # Claude, ChatGPT, Gemini exporters
```

### Tech Stack

**CLI / HTTP Server / MCP Server**
- **TypeScript 5.9** - Type-safe development
- **Express 5** - HTTP server (REST API + static UI)
- **Multer** - Multipart file upload handling
- **Commander.js** - CLI framework
- **@modelcontextprotocol/sdk** - MCP server
- **Ollama** - Local LLM inference (optional)
- **adm-zip** - ZIP file handling
- **chalk** - Terminal colors
- **Database drivers** - optional peer dependencies (`pg`, `mysql2`, `mssql`, `mongodb`, `redis`, `surrealdb`, …); SQLite uses the built-in `node:sqlite`

**Web UI**
- **React 19 + Vite 7** - UI framework and build tool
- **React Router 7** - Client-side routing
- **Tailwind CSS v4** - Utility-first styling
- **shadcn/ui** - Component library (new-york style)
- **Lucide React** - Icons

---

## 🔌 MCP Server

The **open-context MCP server** lets Claude remember things across conversations using a persistent local store.

### Available Tools

| Tool | Trigger phrase |
|------|---------------|
| `save_context` | "remember this", "save this", "keep this in mind" |
| `recall_context` | "what did I say about...", "do you remember..." |
| `list_contexts` | "show my saved contexts" |
| `search_contexts` | Multi-keyword AND search |
| `update_context` | Update a context by ID |
| `delete_context` | Delete a context by ID |

Context is stored at `~/.opencontext/contexts.json` by default. Set `OPENCONTEXT_DB_URL` to keep it in [any of the 15 supported databases](#byodb) instead — the tools behave identically either way. `OPENCONTEXT_STORE_PATH` still works and simply points the JSON store somewhere else.

### Connect to Claude Code

```bash
# Build first
npm run build
```

Add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "open-context": {
      "command": "node",
      "args": ["/path/to/opencontext/dist/mcp/index.js"]
    }
  }
}
```

### Dev Mode (no build required)

```json
{
  "mcpServers": {
    "open-context": {
      "command": "npx",
      "args": ["tsx", "/path/to/opencontext/src/mcp/index.ts"]
    }
  }
}
```

The Dashboard page in the web UI shows this setup guide with copy buttons.

---

## 🐳 Docker

**Docker Hub:** [hub.docker.com/r/adityakarnam/open-context](https://hub.docker.com/r/adityakarnam/open-context)
The official image (adityakarnam/open-context:latest) has been scanned and contains no critical vulnerabilities.

The official image is a single container that bundles the **React UI**, the **REST API server**, and the **MCP server** — all based on `node:25-slim`.

### Quick start

```bash
docker pull adityakarnam/open-context:latest

docker run -p 3000:3000 \
  -v opencontext-data:/root/.opencontext \
  adityakarnam/open-context:latest
```

Open [http://localhost:3000](http://localhost:3000).

### With docker compose

```bash
docker compose up app
```

### Persistent storage

All data is stored in the mounted volume — no browser localStorage is used. The UI reads and writes directly to the server.

| File in `/root/.opencontext/` | Description |
|-------------------------------|-------------|
| `preferences.json` | Your structured preferences (used by the UI form) |
| `preferences.md` | Claude preferences doc — paste into Claude Settings → Preferences |
| `memory.md` | Claude memory doc — paste into Claude → Manage Memory |
| `contexts.json` | MCP context entries saved by Claude — the default store, unused once you configure another database |
| `config.json` | Saved database connection string, written with owner-only (`0600`) permissions |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Ollama endpoint — automatically reaches Ollama running on your host machine |
| `OLLAMA_MODEL` | `gpt-oss:20b` | Default model for preference analysis |
| `OPENCONTEXT_DB_URL` | — | Database for the context store — any [supported backend](#byodb). Takes precedence over anything saved locally |
| `OPENCONTEXT_STORE_PATH` | `/root/.opencontext/contexts.json` | Legacy JSON store path (preferences files live in the same directory). Ignored when `OPENCONTEXT_DB_URL` is set |

`host.docker.internal` is a special DNS name that resolves to your host machine's IP from inside a Docker container. On Linux you may need `--add-host=host.docker.internal:host-gateway`.

### REST API

The server exposes a REST API alongside the UI:

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check + active config |
| `GET /api/ollama/models` | List available Ollama models on the host |
| `POST /api/convert` | Upload a ChatGPT ZIP, run full conversion pipeline |
| `GET /api/preferences` | Load saved preferences (used by the UI on mount) |
| `PUT /api/preferences` | Save preferences — writes `preferences.json`, `preferences.md`, `memory.md` |
| `GET /api/contexts` | List saved MCP contexts (optional `?tag=` filter) |
| `POST /api/contexts` | Save a new context |
| `GET /api/contexts/search?q=` | Search contexts |
| `GET /api/contexts/:id` | Get a context by ID |
| `PUT /api/contexts/:id` | Update a context |
| `DELETE /api/contexts/:id` | Delete a context |
| `GET /api/db/status` | Active backend, where it was configured, and what it holds |
| `GET /api/db/adapters` | Every supported backend and whether its driver is installed |
| `POST /api/db/test` | Test a connection string without saving it |
| `PUT /api/db/config` | Save a connection string and switch to it |
| `DELETE /api/db/config` | Clear it and fall back to the default |
| `POST /api/db/migrate` | Copy contexts and bubbles into another backend |

### MCP stdio mode

The same image can be used as an MCP server by overriding the command:

```bash
docker run -i --rm \
  -v opencontext-data:/root/.opencontext \
  adityakarnam/open-context:latest \
  node dist/mcp/index.js
```

#### Connect to Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "open-context": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "opencontext-data:/root/.opencontext",
               "adityakarnam/open-context:latest", "node", "dist/mcp/index.js"]
    }
  }
}
```

#### Connect to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "open-context": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "opencontext-data:/root/.opencontext",
               "adityakarnam/open-context:latest", "node", "dist/mcp/index.js"]
    }
  }
}
```

### Usage in Claude

Once connected, Claude can save and recall context automatically. Just ask naturally:

**Saving context** — Claude uses `save_context` to store a summary with tags:

![Save context via open-context MCP in Claude Desktop](docs/save_context_mcp.png)

**Searching context** — Claude uses `search_contexts` to find previously saved entries:

![Search context via open-context MCP in Claude Desktop](docs/get_context_mcp.png)

---

## 🐛 Troubleshooting

<details>
<summary><b>Docker Issues</b></summary>

**Container exits immediately with `ERR_MODULE_NOT_FOUND`**

Make sure you're using the latest image — an older build may have missing `.js` extensions in ESM imports:
```bash
docker pull adityakarnam/open-context:latest
docker run -p 3000:3000 -v opencontext-data:/root/.opencontext adityakarnam/open-context:latest
```

**UI can't reach Ollama**

Ollama must be running on your host machine. The container uses `host.docker.internal:11434` by default. On Linux, add:
```bash
docker run -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -v opencontext-data:/root/.opencontext \
  adityakarnam/open-context:latest
```

</details>

<details>
<summary><b>Ollama Issues</b></summary>

**"Ollama is not running"**
```bash
ollama serve
```

**"Model not found"**
```bash
ollama list
ollama pull gpt-oss:20b
```

**Connection refused**
```bash
# Check Ollama
curl http://localhost:11434/api/tags

# Or use remote server
npm start -- convert export.zip --ollama-host http://your-server:11434
```

</details>

<details>
<summary><b>Export Issues</b></summary>

**"conversations.json not found"**
- Verify zip file is correct ChatGPT export
- Re-download if corrupted

**"No valid conversations"**
- Check you have conversations in ChatGPT
- Try exporting again

</details>

<details>
<summary><b>Performance Issues</b></summary>

**Analysis is slow**
- Use `--skip-preferences` for instant conversion
- Try faster model: `--model llama3:8b`
- Use remote GPU: `--ollama-host http://gpu-server:11434`

**Out of memory**
- Normal for 100+ conversations
- Tool handles gracefully with truncation

</details>

---

## 🤝 Contributing

We welcome contributions! Here's how to get involved:

### Ways to Contribute

- 🐛 **Report bugs** - Open an [issue](https://github.com/adityak74/opencontext/issues)
- 💡 **Suggest features** - Start a [discussion](https://github.com/adityak74/opencontext/discussions)
- 📖 **Improve docs** - Fix typos, add examples
- 🔧 **Submit code** - Fix bugs, add features

### Development Workflow

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/adityak74/opencontext.git`
3. **Create** a branch: `git checkout -b feature/amazing-feature`
4. **Make** changes and test thoroughly
5. **Commit** with clear message: `git commit -m 'Add amazing feature'`
6. **Push** to your fork: `git push origin feature/amazing-feature`
7. **Open** a Pull Request

### Guidelines

- Follow existing code style and conventions
- Add comments for complex logic
- Test with real ChatGPT exports
- Update documentation for new features
- Keep PRs focused (one feature/fix per PR)

### Code of Conduct

Be respectful, inclusive, and collaborative. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.

---

## 📊 Performance

Typical conversion times:

| Export Size | Conversations | With AI Analysis | Without AI |
|-------------|---------------|------------------|------------|
| Small | 1-20 | ~1 minute | ~5 seconds |
| Medium | 20-100 | ~5 minutes | ~10 seconds |
| Large | 100+ | ~15 minutes | ~30 seconds |

**Factors affecting speed:**
- Model size (gpt-oss:20b slower than llama3:8b)
- Hardware (GPU vs CPU)
- Ollama location (local vs remote)
- Number of conversations

---

## 🔒 Privacy & Security

### Local Processing

✅ **All data stays on your machine**
- No external API calls (except your Ollama server)
- No telemetry or analytics
- No data collection
- Safe for sensitive conversations

### What Gets Sent to Ollama

Only when AI analysis is enabled:
- Conversation text → Ollama (your infrastructure)
- You control the data and infrastructure

**Want pure local processing?**
```bash
npm start -- convert export.zip --skip-preferences
```

---

## ⚠️ Limitations

- **ChatGPT only** - Currently supports only ChatGPT exports (Gemini planned)
- **Manual Claude import** - No direct API (paste manually)
- **Image references** - Images copied but not embedded
- **Token limits** - Very large exports may be truncated
- **Search on document backends** - MongoDB, Redis, Firestore and DynamoDB filter in memory rather than in the database ([details](#byodb))

---

## 🗺️ Roadmap

Open Context is evolving into an open, storage-agnostic, distributed context data plane for AI agents (Open Context 2.0).

👉 **[View the Complete Strategic Roadmap (v2.0-alpha → v2.2+)](ROADMAP.md)**

---

## ❓ FAQ

<details>
<summary><b>Is this officially supported by Anthropic or OpenAI?</b></summary>
No, this is a community-built tool. Not affiliated with either company.
</details>

<details>
<summary><b>Do I need Ollama?</b></summary>
No, but AI analysis produces much better preferences and memory. Use <code>--skip-preferences</code> to skip it.
</details>

<details>
<summary><b>Can I use Claude API instead of Ollama?</b></summary>
Not yet. Ollama is free and runs locally. We may add Claude API support later.
</details>

<details>
<summary><b>Will this work with 1000+ conversations?</b></summary>
Yes! Markdown conversion works regardless of size. AI analysis may truncate input but still produces useful results.
</details>

<details>
<summary><b>Can I edit the generated files?</b></summary>
Absolutely! They're just text files. Edit before pasting into Claude.
</details>

<details>
<summary><b>Does this modify my ChatGPT account?</b></summary>
No, it only reads the export. Your ChatGPT data is unchanged.
</details>

<details>
<summary><b>Can I run this multiple times?</b></summary>
Yes, it will overwrite previous output. Use different <code>-o</code> directories to keep versions.
</details>

<details>
<summary><b>Is my data safe?</b></summary>
Yes! Everything runs locally. No external APIs except your own Ollama server.
</details>

---

## 📜 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2026 open-context contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software...
```

---

## 🙏 Acknowledgments

- **Anthropic** - For building Claude, the AI that inspired this tool
- **OpenAI** - For ChatGPT and conversation export functionality
- **Ollama** - For making local LLM inference accessible
- **Contributors** - Everyone who has contributed code, ideas, and feedback
- **Community** - Users who test and provide valuable feedback

### Built With

- [Node.js](https://nodejs.org/) - JavaScript runtime
- [TypeScript](https://www.typescriptlang.org/) - Type-safe development
- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [Ollama](https://ollama.ai/) - Local LLM inference
- [adm-zip](https://github.com/cthackers/adm-zip) - ZIP file handling
- [chalk](https://github.com/chalk/chalk) - Terminal styling

---

## 💬 Support & Community

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/adityak74/opencontext/issues)
- 💡 **Feature Requests**: [GitHub Discussions](https://github.com/adityak74/opencontext/discussions)
- ❓ **Questions**: Open an issue with `question` label
- 📧 **Contact**: Open an issue for direct contact

### Useful Links

- [ChatGPT Export Guide](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data)
- [Claude Documentation](https://claude.ai/)
- [Ollama Documentation](https://ollama.ai/)
- [Ollama Model Library](https://ollama.ai/library)

---

<div align="center">

### ⭐ Star us on GitHub — it motivates us to keep improving!

**Made with ❤️ by the AI community**

*Save your context, your way — portable AI history across every platform*

[Report Bug](https://github.com/adityak74/opencontext/issues) • [Request Feature](https://github.com/adityak74/opencontext/discussions) • [View Roadmap](ROADMAP.md)

</div>
