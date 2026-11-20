let csrf = '';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, {
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
    ...(body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body),
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error ?? '清算服务暂不可用', response.status, data?.code);
  if (!data) throw new Error('服务响应无效，请稍后重试');
  if (data.csrf) csrf = data.csrf;
  return data;
}

export const money = (amount: number | null | undefined) => amount == null ? '—' : new Intl.NumberFormat('zh-CN').format(amount);
export const date = (time: number) => new Intl.DateTimeFormat('zh-CN', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
}).format(new Date(time * 1000));
export const message = (error: unknown) => error instanceof Error ? error.message : '暂时无法连接清算服务';
