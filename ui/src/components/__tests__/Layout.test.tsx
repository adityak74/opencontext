import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Layout from '../Layout';
import { AuthProvider } from '../../store/auth';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  const renderWithProviders = (ui: React.ReactElement, { initialEntries = ['/'] } = {}) => {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <AuthProvider>
          {ui}
        </AuthProvider>
      </MemoryRouter>
    );
  };

  it('should render layout with navigation', () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Dashboard Content</div>} />
        </Route>
      </Routes>
    );

    expect(screen.getByText('open-context')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Preferences')).toBeInTheDocument();
    expect(screen.getByText('Conversations')).toBeInTheDocument();
    expect(screen.getByText('Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('should render child content via Outlet', () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div data-testid="child-content">Child Content</div>} />
        </Route>
      </Routes>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('should highlight active navigation item', () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<div>Home</div>} />
        </Route>
      </Routes>,
      { initialEntries: ['/dashboard'] }
    );

    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).toHaveClass('bg-accent');
  });

  it('should not highlight inactive navigation items', () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<div>Home</div>} />
        </Route>
      </Routes>,
      { initialEntries: ['/dashboard'] }
    );

    const preferencesLink = screen.getByText('Preferences').closest('a');
    expect(preferencesLink).not.toHaveClass('bg-accent');
  });

  it('should call logout and navigate when sign out is clicked', () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Home</div>} />
        </Route>
      </Routes>
    );

    const signOutButton = screen.getByText('Sign out');
    fireEvent.click(signOutButton);

    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('should display logo image', () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Home</div>} />
        </Route>
      </Routes>
    );

    const logo = screen.getByAltText('open-context');
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', '/opencontext-logo.png');
  });

  it('should have correct navigation structure', () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/preferences" element={<div>Preferences</div>} />
          <Route path="/conversations" element={<div>Conversations</div>} />
          <Route path="/pipeline" element={<div>Pipeline</div>} />
          <Route path="/export" element={<div>Export</div>} />
        </Route>
      </Routes>
    );

    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
  });
});
