import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  Layers,
  RefreshCw,
  Brain,
  Terminal,
  GitBranch,
  Zap,
  Package,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const GITHUB_URL = 'https://github.com/adityak74/open-context';

const FEATURES = [
  {
    icon: RefreshCw,
    title: 'Import from any platform',
    desc: 'ChatGPT, Gemini — export your data and import it in seconds. Your full history, normalized.',
  },
  {
    icon: Layers,
    title: 'Export anywhere',
    desc: 'Output to Claude, ChatGPT custom instructions, or Gemini. Carry your preferences across every AI.',
  },
  {
    icon: Brain,
    title: 'MCP persistent memory',
    desc: 'Connect the MCP server to Claude Code or Claude Desktop. Save and recall context across every conversation.',
  },
  {
    icon: GitBranch,
    title: 'Bubbles — project workspaces',
    desc: 'Organise contexts into projects. Group notes, decisions, and preferences by what they belong to.',
  },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Export your data',
    desc: 'Request a data export from ChatGPT or Gemini. Takes about 30 seconds.',
  },
  {
    step: '02',
    title: 'Import into open-context',
    desc: 'Drop your conversations.json into the UI. open-context normalises everything automatically.',
  },
  {
    step: '03',
    title: 'Use it everywhere',
    desc: 'Export to your preferred AI, or connect the MCP server so Claude remembers you across every session.',
  },
];

/**
 * Every backend the context store supports, in the order they scroll past.
 *
 * `scheme` is both the DSN scheme it is selected with and the filename of its
 * vendor mark in `public/db-logos`. The in-memory backend is deliberately absent
 * — there is no vendor behind it and so no logo to show.
 */
const BACKENDS = [
  { scheme: 'postgres', label: 'PostgreSQL' },
  { scheme: 'sqlite', label: 'SQLite' },
  { scheme: 'mongodb', label: 'MongoDB' },
  { scheme: 'mysql', label: 'MySQL' },
  { scheme: 'redis', label: 'Redis' },
  { scheme: 'duckdb', label: 'DuckDB' },
  { scheme: 'surrealdb', label: 'SurrealDB' },
  { scheme: 'd1', label: 'Cloudflare D1' },
  { scheme: 'mssql', label: 'SQL Server' },
  { scheme: 'dynamodb', label: 'DynamoDB' },
  { scheme: 'firestore', label: 'Firestore' },
  { scheme: 'libsql', label: 'libSQL / Turso' },
  { scheme: 'cloudsql', label: 'Cloud SQL' },
  { scheme: 'json', label: 'JSON file' },
];

const DOCKER_CMD = 'docker run -p 3000:3000 -v opencontext-data:/root/.opencontext adityakarnam/opencontext:latest';

const MCP_SNIPPET = `{
  "mcpServers": {
    "open-context": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "opencontext-data:/root/.opencontext",
        "adityakarnam/opencontext:latest",
        "node", "dist/mcp/index.js"
      ]
    }
  }
}`;

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

export default function Landing() {
  const [copiedDocker, setCopiedDocker] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);

  function copyDocker() {
    navigator.clipboard.writeText(DOCKER_CMD).then(() => {
      setCopiedDocker(true);
      setTimeout(() => setCopiedDocker(false), 1800);
    });
  }

  function copyMcp() {
    navigator.clipboard.writeText(MCP_SNIPPET).then(() => {
      setCopiedMcp(true);
      setTimeout(() => setCopiedMcp(false), 1800);
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">

      {/* ------------------------------------------------------------------ */}
      {/* Navbar                                                              */}
      {/* ------------------------------------------------------------------ */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-sm px-6 md:px-12 py-3.5 flex items-center gap-6">
        <div className="flex items-center gap-2 mr-auto">
          <img src="/opencontext-logo.png" alt="open-context" className="w-14 h-14 rounded-sm" />
          <span className="text-sm font-semibold tracking-tight text-foreground">open-context</span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="#databases" className="hover:text-foreground transition-colors">Databases</a>
          <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
          <a href="#deploy" className="hover:text-foreground transition-colors">Deploy</a>
          <a href="/blog/" className="hover:text-foreground transition-colors">Blog</a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </nav>

        <Button size="sm" className="text-sm gap-1.5" asChild>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            Get started
            <ArrowRight size={13} />
          </a>
        </Button>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col items-center text-center px-6 pt-24 pb-20 md:pt-32 md:pb-28">
        <div className="inline-flex items-center gap-2 border border-border rounded-full px-3 py-1 text-xs text-muted-foreground mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
          Open source · self-hosted · runs locally
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-tight max-w-3xl mb-6">
          Your AI context,{' '}
          <span className="text-muted-foreground">
            everywhere you go.
          </span>
        </h1>

        <p className="text-base sm:text-lg text-muted-foreground max-w-xl leading-relaxed mb-10">
          Save your context, your way — import chat history from any AI platform, manage it locally, and export to Claude, ChatGPT, or Gemini
        </p>

        <div className="flex items-center gap-3 flex-wrap justify-center">
          <Button size="lg" className="gap-2 text-base px-6" asChild>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              Get started free
              <ArrowRight size={16} />
            </a>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="gap-2 text-base px-6 border-border text-muted-foreground hover:text-foreground"
            asChild
          >
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              View on GitHub
            </a>
          </Button>
        </div>

        {/* Terminal snippet */}
        <div className="mt-14 w-full max-w-2xl bg-card border border-border rounded-lg overflow-hidden text-left">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-muted/40">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            <span className="ml-2 text-xs text-muted-foreground font-mono">terminal</span>
          </div>
          <div className="px-5 py-4 font-mono text-sm flex items-center justify-between gap-4">
            <code className="text-muted-foreground break-all">
              <span className="text-green-400 select-none">$ </span>
              {DOCKER_CMD}
            </code>
            <button
              onClick={copyDocker}
              className="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
            >
              {copiedDocker ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Features                                                            */}
      {/* ------------------------------------------------------------------ */}
      <section id="features" className="px-6 md:px-12 py-20 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Features</p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              Everything context needs to be portable
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-card border border-border rounded-lg p-6 flex flex-col gap-4"
              >
                <div className="w-9 h-9 rounded-md bg-muted border border-border flex items-center justify-center flex-shrink-0">
                  <Icon size={16} className="text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Databases                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section id="databases" className="py-20 border-t border-border overflow-hidden">
        <div className="max-w-5xl mx-auto px-6 md:px-12 text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Bring your own database
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Supports all of these
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mt-4 max-w-2xl mx-auto">
            Start on the zero-config JSON file. Outgrow it and point open-context at whatever you
            already run — the CLI, the web UI, and the MCP tools all behave exactly the same.
          </p>
        </div>

        {/* Two identical copies scroll as one track; see `animate-marquee` in index.css. */}
        <div
          className="relative flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]"
          aria-label={`Supported databases: ${BACKENDS.map((b) => b.label).join(', ')}`}
        >
          <div className="flex w-max gap-3 pr-3 animate-marquee hover:[animation-play-state:paused]">
            {[...BACKENDS, ...BACKENDS].map(({ scheme, label }, index) => (
              <div
                key={`${scheme}-${index}`}
                // The screen reader gets the list once, from the label above.
                aria-hidden="true"
                className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3"
              >
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-white/95">
                  <img src={`/db-logos/${scheme}.svg`} alt="" width={18} height={18} />
                </span>
                <span className="text-sm text-muted-foreground whitespace-nowrap">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-12 px-6">
          Fifteen backends in all, and your data never leaves infrastructure you control.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* How it works                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section id="how-it-works" className="px-6 md:px-12 py-20 border-t border-border bg-muted/10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">How it works</p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              From ChatGPT to Claude in three steps
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(({ step, title, desc }) => (
              <div key={step} className="flex flex-col gap-4">
                <span className="text-4xl font-semibold text-muted-foreground/20 font-mono">{step}</span>
                <h3 className="text-base font-semibold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Deploy / MCP snippet                                                */}
      {/* ------------------------------------------------------------------ */}
      <section id="deploy" className="px-6 md:px-12 py-20 border-t border-border">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-6">
            <div className="w-10 h-10 rounded-md bg-muted border border-border flex items-center justify-center">
              <Package size={18} className="text-muted-foreground" />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight">
              Self-hosted, zero lock-in
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Run open-context on your own machine with one Docker command. Your data never leaves your infrastructure — not one byte.
            </p>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              {[
                'Single Docker image — UI + API + MCP server',
                'Persistent storage via named volume',
                'MCP server works in stdio mode for Claude Code & Desktop',
                'Override with OPENCONTEXT_STORE_PATH for custom paths',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Zap size={13} className="text-foreground mt-0.5 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            {/* MCP config snippet */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
                <div className="flex items-center gap-2">
                  <Terminal size={12} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-mono">~/.claude/settings.json</span>
                </div>
                <button
                  onClick={copyMcp}
                  className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5 transition-colors"
                >
                  {copiedMcp ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="px-5 py-4 font-mono text-xs text-muted-foreground overflow-x-auto leading-relaxed">
                {MCP_SNIPPET}
              </pre>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Add this to Claude Code or Claude Desktop to enable persistent memory.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* CTA                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="px-6 md:px-12 py-24 border-t border-border text-center">
        <div className="max-w-2xl mx-auto flex flex-col items-center gap-6">
          <div className="w-56 h-56 rounded-xl bg-card border border-border flex items-center justify-center">
            <img src="/opencontext-logo.png" alt="open-context" className="w-52 h-52 rounded-sm" />
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Start with your context today
          </h2>
          <p className="text-muted-foreground text-base leading-relaxed">
            open-context is free, open source, and runs entirely on your machine. No accounts, no cloud, no tracking.
          </p>
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <Button size="lg" className="gap-2 px-8 text-base" asChild>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                View on GitHub
                <ArrowRight size={16} />
              </a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="gap-2 text-base px-8 border-border text-muted-foreground hover:text-foreground"
              asChild
            >
              <a href="https://hub.docker.com/r/adityakarnam/opencontext" target="_blank" rel="noopener noreferrer">
                Docker Hub
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Aviskaar - Applied AI Research Lab                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section className="px-6 md:px-12 py-16 border-t border-border bg-muted/5">
        <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-4">
          <a
            href="http://aviskaar.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80 transition-opacity"
          >
            <img src="/dark-logo-aviskaar.png" alt="Aviskaar - Applied AI Research Lab" className="h-24 md:h-32" />
          </a>
          <p className="text-sm text-muted-foreground">Made with ❤️ by <a href="http://aviskaar.com/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors underline underline-offset-2">Aviskaar - Applied AI Research Lab</a></p>
          <p className="text-sm text-muted-foreground">
            Building the future of AI context management
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Footer                                                              */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-border px-6 md:px-12 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <img src="/opencontext-logo.png" alt="open-context" className="w-4 h-4 rounded-sm opacity-60" />
          <span className="text-xs text-muted-foreground">
            open-context.dev — open source, self-hosted
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <a href="/blog/" className="hover:text-foreground transition-colors">
            Blog
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://hub.docker.com/r/adityakarnam/opencontext"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Docker Hub
          </a>
          <span>No data leaves your machine</span>
        </div>
      </footer>
    </div>
  );
}
