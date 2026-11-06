import type { ReactNode } from 'react';

export function ErrorBanner({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="banner error" role="alert">{error}</div>;
}

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head">
        <h1>{title}</h1>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const STATUS_TONE = { PENDING: 'warn', CONFIRMED: 'info', FULFILLED: 'good', CANCELLED: 'bad' } as const;
