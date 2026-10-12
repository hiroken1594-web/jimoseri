import type { ApiErrorBody } from '../shared/dto.js'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message)
  }
}

/** サーバーの API を呼ぶ。失敗時は、画面にそのまま出せる日本語メッセージ付きの ApiError を投げる。 */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'NETWORK', '通信できませんでした。電波の状況を確認して、もう一度お試しください。')
  }
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // JSON でない応答は下で一般的なエラーとして扱う
  }
  if (!response.ok) {
    const error = (data as ApiErrorBody | null)?.error
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'サーバーでエラーが発生しました。少し待ってからもう一度お試しください。',
      error?.fields,
    )
  }
  return data as T
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '予期しないエラーが発生しました。画面を読み込み直してください。'
}
