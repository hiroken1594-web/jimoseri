import type { ZodType } from 'zod'
import type { ApiErrorBody } from '../../shared/dto.js'

const MAX_BODY_BYTES = 10_000

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

/** 他サイトからの書き込みリクエストを拒否する（Cookie の SameSite=Lax に加えた二重の対策）。 */
function assertSameOrigin(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD') return
  const origin = request.headers.get('origin')
  if (!origin) return
  const hosts = [request.headers.get('host'), request.headers.get('x-forwarded-host')]
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw new HttpError(403, 'FORBIDDEN', 'このリクエストは受け付けられません。')
  }
  if (!hosts.includes(originHost)) throw new HttpError(403, 'FORBIDDEN', 'このリクエストは受け付けられません。')
}

/** 本文を読み、形を検証する。検証エラーは項目ごとのメッセージにして返す。 */
export async function readBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'TOO_LARGE', '入力が長すぎます。')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', '入力の形式が正しくありません。')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_'
      fields[key] ??= issue.message
    }
    throw new HttpError(400, 'VALIDATION', Object.values(fields)[0] ?? '入力内容を確認してください。', fields)
  }
  return parsed.data
}

/** 各 API の共通処理：オリジン確認とエラーの整形。 */
export function handle(fn: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      assertSameOrigin(request)
      return await fn(request)
    } catch (error) {
      if (error instanceof HttpError) {
        const body: ApiErrorBody = { error: { code: error.code, message: error.message, fields: error.fields } }
        return json(body, error.status)
      }
      console.error('[api]', request.method, new URL(request.url).pathname, error)
      const body: ApiErrorBody = {
        error: { code: 'INTERNAL', message: 'サーバーでエラーが発生しました。少し待ってからもう一度お試しください。' },
      }
      return json(body, 500)
    }
  }
}
