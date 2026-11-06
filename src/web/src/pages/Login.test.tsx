import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '../auth';
import { getToken, setToken } from '../api/client';
import { Login } from './Login';
import { mockApi } from '../test/setup';

const user = { id: 'u1', email: 'a@b.c', name: 'Ann', role: 'admin', createdAt: '2026-01-01T00:00:00Z' };

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<p>Home page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('Login', () => {
  it('signs in, stores the token and redirects', async () => {
    setToken(null);
    const calls = mockApi({ 'POST /auth/login': { token: 'jwt-123', user } });
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Home page');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/login', body: { email: 'a@b.c', password: 'secret123' } });
    expect(getToken()).toBe('jwt-123');
  });

  it('shows the API error on bad credentials', async () => {
    setToken(null);
    mockApi({ 'POST /auth/login': new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }), { status: 401 }) });
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password'));
    expect(getToken()).toBeNull();
  });
});
