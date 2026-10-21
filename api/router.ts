// すべての API（/api/...）の入口。URL の最初の区切りで、api/_routes/ の処理に振り分ける。
// Vercel では vercel.json の rewrites で /api/* をこの1つの関数に集め、関数の数を増やさない。
// ローカル開発では vite.config.ts の devApi が同じようにこの関数を呼ぶ。
import * as admin from './_routes/admin.js'
import * as auth from './_routes/auth.js'
import * as chat from './_routes/chat.js'
import * as demands from './_routes/demands.js'
import * as extract from './_routes/extract.js'
import * as favorites from './_routes/favorites.js'
import * as geo from './_routes/geo.js'
import * as listings from './_routes/listings.js'
import * as locations from './_routes/locations.js'
import * as market from './_routes/market.js'
import * as master from './_routes/master.js'
import * as notifications from './_routes/notifications.js'
import * as partners from './_routes/partners.js'
import * as proposals from './_routes/proposals.js'
import * as matches from './_routes/matches.js'
import * as me from './_routes/me.js'
import * as plan from './_routes/plan.js'
import * as recovery from './_routes/recovery.js'
import * as reports from './_routes/reports.js'
import * as reviews from './_routes/reviews.js'
import * as signup from './_routes/signup.js'

type Handler = (request: Request) => Promise<Response>
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Handler>>

const ROUTES: Record<string, RouteModule> = {
  admin,
  auth,
  chat,
  demands,
  extract,
  favorites,
  geo,
  listings,
  locations,
  market,
  master,
  matches,
  me,
  notifications,
  partners,
  plan,
  proposals,
  recovery,
  reports,
  reviews,
  signup,
}

const notFound = (status: number) =>
  new Response(JSON.stringify({ error: { code: status === 405 ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', message: 'この操作は利用できません。' } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

export async function route(request: Request): Promise<Response> {
  const name = new URL(request.url).pathname.replace(/^\/api\//, '').split('/')[0]
  const routeModule = Object.hasOwn(ROUTES, name) ? ROUTES[name] : undefined
  if (!routeModule) return notFound(404)
  // /api/auth/... 以外は、/api/<名前> そのものだけを受け付ける
  if (name !== 'auth' && new URL(request.url).pathname.replace(/\/$/, '') !== `/api/${name}`) return notFound(404)
  const handler = routeModule[request.method as keyof RouteModule]
  if (!handler) return notFound(405)
  return handler(request)
}

export const GET = route
export const POST = route
export const PUT = route
export const PATCH = route
export const DELETE = route
