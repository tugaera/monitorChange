export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

const messages: Record<string, string> = {
  'Invalid installation token.': 'O token de instalação não é válido.',
  'Invalid password.': 'A palavra-passe não é válida.',
  'Authentication required.': 'A sua sessão expirou. Entre novamente.',
  'The operation could not be completed. Check server logs.': 'Não foi possível concluir a operação. Consulte os registos do servidor.',
  'Too many authentication attempts. Try again later.': 'Demasiadas tentativas de acesso. Tente novamente mais tarde.',
  'Failed to fetch': 'Não foi possível contactar o servidor. Verifique a ligação e tente novamente.',
};

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options, credentials: 'same-origin',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !['/session', '/setup', '/password'].includes(path)) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status === 409
      ? 'Esta configuração foi alterada noutra janela. Feche o editor, atualize a página e volte a editar.'
      : messages[data?.message] || data?.message || 'Não foi possível concluir o pedido. Tente novamente.', response.status, data?.error || 'request_failed');
  }
  return data as T;
}

export const send = <T>(path: string, method = 'POST', body?: unknown) => api<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const errorText = (error: unknown) => error instanceof Error ? messages[error.message] || error.message : 'Ocorreu um erro inesperado.';
