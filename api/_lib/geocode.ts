// 外部の無料サービスへの問い合わせ（郵便番号 → 住所、地名 → 位置）。
// どちらもサーバーから呼び、結果を DB に一時保存して問い合わせ回数を減らす。失敗しても手入力で続けられる。
//  - 郵便番号：zipcloud（https://zipcloud.ibsnet.co.jp/）。無料・継続の保証なし。
//  - 地名検索：Nominatim（OpenStreetMap）。1秒に1回まで・自動補完は禁止・出典の表示が必要。
import type { Prisma } from '../../generated/prisma/client.js'
import { isInJapan, type PlaceResult, type ZipAddress } from '../../shared/geo.js'
import { getPrisma } from './prisma.js'
import { allow } from './throttle.js'

const TIMEOUT_MS = 6000
const CACHE_DAYS = 30
const USER_AGENT = 'AI-Chiiki-Shosha/0.2 (university team project; https://jimoseri.vercel.app)'

export class GeoUnavailableError extends Error {}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': USER_AGENT, ...headers } })
    if (!res.ok) throw new GeoUnavailableError(`status ${res.status}`)
    return await res.json()
  } catch (error) {
    if (error instanceof GeoUnavailableError) throw error
    throw new GeoUnavailableError(error instanceof Error ? error.message : 'unknown')
  } finally {
    clearTimeout(timer)
  }
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const prisma = getPrisma()
  const hit = await prisma.geoCache.findUnique({ where: { key } })
  if (hit && Date.now() - hit.createdAt.getTime() < CACHE_DAYS * 86400_000) return hit.value as T
  const value = await load()
  await prisma.geoCache.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue, createdAt: new Date() },
    create: { key, value: value as Prisma.InputJsonValue },
  })
  return value
}

interface ZipcloudResponse {
  status?: number
  message?: string | null
  results?: { zipcode: string; address1: string; address2: string; address3: string }[] | null
}

/** zipcloud の応答を、住所の候補の一覧にする（見つからなければ空の配列） */
export function parseZipcloud(data: unknown): ZipAddress[] {
  const body = data as ZipcloudResponse
  if (!body || typeof body !== 'object' || body.status !== 200) throw new GeoUnavailableError(`zipcloud status ${body?.status}`)
  return (body.results ?? []).map((r) => ({ zipcode: r.zipcode, prefecture: r.address1, city: r.address2, town: r.address3 }))
}

export async function lookupZip(zip7: string): Promise<ZipAddress[]> {
  return cached(`zip:${zip7}`, async () => parseZipcloud(await fetchJson(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip7}&limit=20`)))
}

interface NominatimItem {
  display_name?: string
  name?: string
  lat?: string
  lon?: string
}

/** Nominatim の応答を、日本国内の候補だけの一覧にする */
export function parseNominatim(data: unknown): PlaceResult[] {
  if (!Array.isArray(data)) throw new GeoUnavailableError('unexpected response')
  return (data as NominatimItem[])
    .map((d) => ({
      // 「梅田, 北区, 大阪市, 大阪府, 530-0001, 日本」→ 末尾の国名と郵便番号を省いて短くする
      label: (d.display_name ?? d.name ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && s !== '日本' && !/^\d{3}-?\d{4}$/.test(s))
        .slice(0, 4)
        .join('、'),
      lat: Number(d.lat),
      lng: Number(d.lon),
    }))
    .filter((p) => p.label && Number.isFinite(p.lat) && Number.isFinite(p.lng) && isInJapan(p))
}

export async function searchPlace(query: string): Promise<PlaceResult[]> {
  const normalized = query.trim().replace(/\s+/g, ' ')
  return cached(`place:${normalized}`, async () => {
    // Nominatim の利用条件：サービス全体で1秒に1回まで
    if (!(await allow('nominatim-global', 'all', 1, 1))) throw new GeoUnavailableError('busy')
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=jp&accept-language=ja&limit=5&q=${encodeURIComponent(normalized)}`
    return parseNominatim(await fetchJson(url, { referer: 'https://jimoseri.vercel.app/' }))
  })
}
