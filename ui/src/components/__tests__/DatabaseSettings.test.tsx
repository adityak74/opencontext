import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import DatabaseSettings from '../DatabaseSettings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const adapters = [
  {
    scheme: 'json',
    label: 'JSON file',
    example: 'json:///path/to/contexts.json',
    packageName: null,
    remote: false,
    family: 'file',
    installed: true,
  },
  {
    scheme: 'postgres',
    label: 'PostgreSQL',
    example: 'postgres://USER:PASSWORD@HOST:5432/DATABASE',
    packageName: 'pg',
    remote: true,
    family: 'sql',
    installed: true,
  },
  {
    scheme: 'memory',
    label: 'In-memory',
    example: 'memory://',
    packageName: null,
    remote: false,
    family: 'document',
    installed: true,
  },
  {
    scheme: 'firestore',
    label: 'Google Firestore',
    example: 'firestore://PROJECT_ID',
    packageName: '@google-cloud/firestore',
    remote: true,
    family: 'document',
    installed: false,
  },
];

function statusFixture(overrides: Record<string, unknown> = {}) {
  return {
    connected: true,
    adapter: { scheme: 'json', label: 'JSON file', target: '/home/me/contexts.json', remote: false },
    source: 'default',
    locked: false,
    url: 'json:///home/me/contexts.json',
    counts: { contexts: 12, bubbles: 3 },
    ...overrides,
  };
}

/** Route each endpoint to a canned response; extra handlers override defaults. */
function mockFetch(handlers: Record<string, unknown> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const body =
      key in handlers
        ? handlers[key]
        : url === '/api/db/adapters'
          ? adapters
          : url === '/api/db/status'
            ? statusFixture()
            : {};
    return { ok: true, json: async () => body } as Response;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DatabaseSettings', () => {
  it('shows the current backend and its contents', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<DatabaseSettings />);

    // "JSON file" appears twice — as the current store and as a pickable
    // adapter — so assert on the values unique to the status card.
    expect(await screen.findByText('json:///home/me/contexts.json')).toBeInTheDocument();
    expect(screen.getAllByText('JSON file').length).toBeGreaterThan(0);
    expect(screen.getByText(/12 contexts/)).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('reports a backend it could not reach, with the error', async () => {
    global.fetch = mockFetch({
      'GET /api/db/status': statusFixture({
        connected: false,
        adapter: null,
        counts: null,
        error: 'connection refused',
      }),
    }) as unknown as typeof fetch;

    render(<DatabaseSettings />);

    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText('connection refused')).toBeInTheDocument();
  });

  it('lists every supported adapter grouped by family', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<DatabaseSettings />);

    expect(await screen.findByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('Google Firestore')).toBeInTheDocument();
    expect(screen.getByText('SQL')).toBeInTheDocument();
    expect(screen.getByText('Document & key-value')).toBeInTheDocument();
  });

  it('fills the connection field from the adapter template when one is picked', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<DatabaseSettings />);

    fireEvent.click(await screen.findByText('PostgreSQL'));

    expect(screen.getByLabelText(/connection string/i)).toHaveValue(
      'postgres://USER:PASSWORD@HOST:5432/DATABASE',
    );
  });

  it('tells the user what to install when a driver is missing', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<DatabaseSettings />);

    fireEvent.click(await screen.findByText('Google Firestore'));

    expect(await screen.findByText(/npm install @google-cloud\/firestore/)).toBeInTheDocument();
  });

  it('reports a successful connection test', async () => {
    global.fetch = mockFetch({
      'POST /api/db/test': { ok: true, adapter: { label: 'PostgreSQL' } },
    }) as unknown as typeof fetch;
    render(<DatabaseSettings />);

    fireEvent.click(await screen.findByText('PostgreSQL'));
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText('Connected to PostgreSQL')).toBeInTheDocument();
  });

  it('surfaces the driver error when a connection test fails', async () => {
    global.fetch = mockFetch({
      'POST /api/db/test': { ok: false, error: 'password authentication failed' },
    }) as unknown as typeof fetch;
    render(<DatabaseSettings />);

    fireEvent.click(await screen.findByText('PostgreSQL'));
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText('password authentication failed')).toBeInTheDocument();
  });

  it('saves a new connection and refreshes the status', async () => {
    const fetchMock = mockFetch({
      'PUT /api/db/config': { ok: true, adapter: { label: 'PostgreSQL' } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<DatabaseSettings />);

    fireEvent.click(await screen.findByText('PostgreSQL'));
    fireEvent.click(screen.getByRole('button', { name: /save & switch/i }));

    expect(await screen.findByText('Now using PostgreSQL')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/db/status');
    });
  });

  it('reports what a migration copied and that the source was untouched', async () => {
    global.fetch = mockFetch({
      'POST /api/db/migrate': { ok: true, contexts: 12, bubbles: 3 },
    }) as unknown as typeof fetch;
    render(<DatabaseSettings />);

    fireEvent.click(await screen.findByText('PostgreSQL'));
    fireEvent.click(screen.getByRole('button', { name: /copy my data here/i }));

    expect(
      await screen.findByText(/Copied 12 contexts and 3 bubbles/),
    ).toBeInTheDocument();
    expect(screen.getByText(/current store was not changed/)).toBeInTheDocument();
  });

  it('explains and disables saving when an environment variable pins the database', async () => {
    global.fetch = mockFetch({
      'GET /api/db/status': statusFixture({ source: 'env', locked: true }),
    }) as unknown as typeof fetch;
    render(<DatabaseSettings />);

    expect(await screen.findByText(/environment variable is setting the database/i))
      .toBeInTheDocument();

    fireEvent.click(screen.getByText('PostgreSQL'));
    expect(screen.getByRole('button', { name: /save & switch/i })).toBeDisabled();
  });

  it('shows the vendor mark for each backend that has one', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    const { container } = render(<DatabaseSettings />);

    await screen.findByText('PostgreSQL');
    expect(container.querySelector('img[src="/db-logos/postgres.svg"]')).toBeInTheDocument();
    expect(container.querySelector('img[src="/db-logos/firestore.svg"]')).toBeInTheDocument();
    // The status card names the current backend, so its mark appears there too.
    expect(container.querySelectorAll('img[src="/db-logos/json.svg"]').length).toBe(2);
  });

  it('renders no mark for a backend with no vendor behind it', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    const { container } = render(<DatabaseSettings />);

    expect(await screen.findByText('In-memory')).toBeInTheDocument();
    expect(container.querySelector('img[src="/db-logos/memory.svg"]')).toBeNull();
  });

  it('keeps the action buttons disabled until a connection string is entered', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<DatabaseSettings />);

    await screen.findByText('PostgreSQL');
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /copy my data here/i })).toBeDisabled();
  });
});
