import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => <Outlet />,
  errorComponent: ({ error }) => (
    <div
      style={{
        padding: 32,
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 600,
        margin: '40px auto',
      }}
    >
      <h2 style={{ color: '#dc2626' }}>Something went wrong</h2>
      <p style={{ color: '#4b5563' }}>
        {error instanceof Error ? error.message : 'An unexpected error occurred.'}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: '8px 16px',
          backgroundColor: '#2563eb',
          color: '#ffffff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Reload Page
      </button>
    </div>
  ),
})
