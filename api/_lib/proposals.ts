// 取引条件の提案（マッチング成立後に、どちらからでも出せる）の画面に返す形
import { toMilli } from '../../shared/allocate.js'
import type { TermsProposalDto } from '../../shared/dto.js'
import type { Prisma } from '../../generated/prisma/client.js'

type ProposalRow = Prisma.TermsProposalGetPayload<object>

export function toProposalDto(p: ProposalRow): TermsProposalDto {
  return {
    id: p.id,
    proposerRole: p.proposerRole === 'PRODUCER' ? 'PRODUCER' : 'RESTAURANT',
    quantityMilli: toMilli(Number(p.quantity)),
    unitPriceYen: p.unitPriceTaxIncl,
    deliveryMethod: p.deliveryMethod,
    deliveryPlace: p.deliveryPlace,
    pickupStartMs: p.pickupStart.getTime(),
    pickupEndMs: p.pickupEnd.getTime(),
    shippingFeeYen: p.shippingFeeYen,
    shippingPayer: p.shippingPayer,
    note: p.note,
    status: p.status,
    createdAtMs: p.createdAt.getTime(),
  }
}

