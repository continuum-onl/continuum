/**
 * EXEMPLO PRÁTICO COMPLETO: Login + Requisições Autenticadas
 * 
 * Este arquivo demonstra como usar todo o sistema de Refresh Token
 * em um caso real de uma aplicação React.
 * 
 * Copy & paste para seu projeto e adapte conforme necessário.
 */

import React, { useState, useEffect } from 'react';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContextNew';
import { toast } from '@/hooks/use-toast';

// ====================================================================
// 1. PÁGINA DE LOGIN
// ====================================================================

interface LoginPageProps {
  onLoginSuccess?: () => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const { login, error, isLoading, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    return () => clearError();
  }, [clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    // Validação básica
    if (!email || !password) {
      setLocalError('Email e senha são obrigatórios');
      return;
    }

    try {
      await login(email, password);
      onLoginSuccess?.();
    } catch (err) {
      // Erro já está em 'error' do context
      setLocalError(error || 'Erro ao fazer login');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 20, border: '1px solid #ccc' }}>
      <h1>Login</h1>

      {(localError || error) && (
        <div style={{ color: 'red', marginBottom: 10, padding: 10, background: '#ffe0e0' }}>
          {localError || error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 10 }}>
          <label>
            Email:
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              disabled={isLoading}
              style={{ width: '100%', padding: 8, marginTop: 5 }}
            />
          </label>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label>
            Senha:
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="sua senha"
              disabled={isLoading}
              style={{ width: '100%', padding: 8, marginTop: 5 }}
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          style={{
            width: '100%',
            padding: 10,
            background: isLoading ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            cursor: isLoading ? 'not-allowed' : 'pointer'
          }}
        >
          {isLoading ? 'Carregando...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

// ====================================================================
// 2. COMPONENTE COM REQUISIÇÃO AUTENTICADA - EXEMPLO SIMPLES
// ====================================================================

interface Note {
  id: string;
  title: string;
  content: string;
}

export function NotesListSimple() {
  const { user } = useAuth();
  const { request, post } = useApi({
    onError: (error) => console.error('Erro ao buscar notas:', error)
  });

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNoteTitle, setNewNoteTitle] = useState('');

  // Carrega notas ao montar o componente
  useEffect(() => {
    loadNotes();
  }, []);

  const loadNotes = async () => {
    setLoading(true);
    try {
      // O token é adicionado automaticamente pelo interceptor
      const data = await request<Note[]>('/api/notes');
      if (data) {
        setNotes(data);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNote = async () => {
    if (!newNoteTitle.trim()) return;

    try {
      // Se o access token expirou durante esta operação,
      // o interceptor fará refresh automaticamente
      const newNote = await post<Note>('/api/notes', {
        title: newNoteTitle,
        content: ''
      });

      if (newNote) {
        setNotes([...notes, newNote]);
        setNewNoteTitle('');
      }
    } catch (error) {
      console.error('Erro ao criar nota:', error);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Minhas Notas</h1>
      <p>Olá, {user?.username}!</p>

      {loading ? (
        <p>Carregando notas...</p>
      ) : (
        <>
          <div style={{ marginBottom: 20, padding: 10, background: '#f5f5f5' }}>
            <h3>Criar Nova Nota</h3>
            <input
              type="text"
              value={newNoteTitle}
              onChange={(e) => setNewNoteTitle(e.target.value)}
              placeholder="Título da nota"
              style={{ width: '100%', padding: 8, marginBottom: 10 }}
            />
            <button
              onClick={handleCreateNote}
              style={{
                padding: 8,
                background: '#28a745',
                color: 'white',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Criar
            </button>
          </div>

          <div>
            <h3>Notas ({notes.length})</h3>
            {notes.length === 0 ? (
              <p>Você não tem notas ainda</p>
            ) : (
              <ul>
                {notes.map((note) => (
                  <li key={note.id}>
                    <strong>{note.title}</strong>: {note.content}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ====================================================================
// 3. COMPONENTE COM TRATAMENTO AVANÇADO DE ERROS
// ====================================================================

interface UserProfile {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export function ProfilePageAdvanced() {
  const { user, logout } = useAuth();
  const { request, patch } = useApi({
    onSuccess: () => {
      console.log('✓ Perfil atualizado com sucesso');
      toast({ title: 'Perfil atualizado!' });
    },
    onError: (error) => {
      console.error('✗ Erro ao atualizar perfil:', error);
    }
  });

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newUsername, setNewUsername] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setLoading(true);
    try {
      // Carrega com retry automático em caso de 401
      const data = await request<UserProfile>('/api/account/me');
      if (data) {
        setProfile(data);
        setNewUsername(data.username);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!newUsername.trim()) {
      toast({ title: 'Username não pode estar vazio', variant: 'destructive' });
      return;
    }

    try {
      const updated = await patch<UserProfile>('/api/account/me', {
        username: newUsername
      });

      if (updated) {
        setProfile(updated);
        setEditing(false);
      }
    } catch (error) {
      // Erro já foi tratado em onError
      console.error('Erro:', error);
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Tem certeza que deseja sair?')) {
      await logout();
      // Redireciona automaticamente para /login se usar React Router
    }
  };

  if (loading) return <p>Carregando perfil...</p>;
  if (!profile) return <p>Erro ao carregar perfil</p>;

  return (
    <div style={{ maxWidth: 500, margin: '20px auto', padding: 20 }}>
      <h1>Meu Perfil</h1>

      {!editing ? (
        <div>
          <p>
            <strong>Username:</strong> {profile.username}
          </p>
          <p>
            <strong>Email:</strong> {profile.email}
          </p>
          <p>
            <strong>Membro desde:</strong> {new Date(profile.createdAt).toLocaleDateString('pt-BR')}
          </p>

          <button
            onClick={() => setEditing(true)}
            style={{ marginRight: 10, padding: 10, background: '#007bff', color: 'white', border: 'none' }}
          >
            Editar
          </button>

          <button
            onClick={handleLogout}
            style={{ padding: 10, background: '#dc3545', color: 'white', border: 'none' }}
          >
            Logout
          </button>
        </div>
      ) : (
        <div>
          <label>
            Novo Username:
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              style={{ width: '100%', padding: 8, marginTop: 5 }}
            />
          </label>

          <div style={{ marginTop: 20 }}>
            <button
              onClick={handleUpdateProfile}
              style={{ marginRight: 10, padding: 10, background: '#28a745', color: 'white', border: 'none' }}
            >
              Salvar
            </button>

            <button
              onClick={() => {
                setEditing(false);
                setNewUsername(profile.username);
              }}
              style={{ padding: 10, background: '#6c757d', color: 'white', border: 'none' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ====================================================================
// 4. COMPONENTE PRINCIPAL QUE ORQUESTRA TUDO
// ====================================================================

export function AppExample() {
  const { isAuthenticated, isLoading } = useAuth();
  const [currentPage, setCurrentPage] = useState<'login' | 'notes' | 'profile'>('notes');

  if (isLoading) {
    return <div style={{ padding: 20 }}>Carregando...</div>;
  }

  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={() => setCurrentPage('notes')} />;
  }

  return (
    <div>
      {/* Navegação */}
      <nav style={{ background: '#333', color: 'white', padding: 10 }}>
        <button
          onClick={() => setCurrentPage('notes')}
          style={{
            marginRight: 10,
            padding: 10,
            background: currentPage === 'notes' ? '#007bff' : 'transparent',
            color: 'white',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          Notas
        </button>
        <button
          onClick={() => setCurrentPage('profile')}
          style={{
            padding: 10,
            background: currentPage === 'profile' ? '#007bff' : 'transparent',
            color: 'white',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          Perfil
        </button>
      </nav>

      {/* Conteúdo */}
      {currentPage === 'notes' && <NotesListSimple />}
      {currentPage === 'profile' && <ProfilePageAdvanced />}
    </div>
  );
}

// ====================================================================
// 5. COMO USAR NO SEU MAIN.TSX/APP.TSX
// ====================================================================

/*
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/contexts/AuthContextNew';
import { AppExample } from '@/components/examples/AxiosExample';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AppExample />
    </AuthProvider>
  </StrictMode>
);
*/
