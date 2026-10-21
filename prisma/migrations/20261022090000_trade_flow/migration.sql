-- CreateEnum
CREATE TYPE "PhoneShare" AS ENUM ('NONE', 'MATCHED', 'ANYTIME');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('PICKUP', 'DELIVERY', 'DISCUSS');

-- CreateEnum
CREATE TYPE "ShippingPayer" AS ENUM ('UNDECIDED', 'RESTAURANT', 'PRODUCER');

-- CreateEnum
CREATE TYPE "ChatKind" AS ENUM ('TEXT', 'SYSTEM', 'PROPOSAL');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('PROPOSAL_RECEIVED', 'PROPOSAL_ACCEPTED', 'PROPOSAL_DECLINED', 'NEW_MESSAGE', 'TERMS_PROPOSED', 'TERMS_AGREED', 'COMPLETION_REQUESTED', 'COMPLETED', 'REVIEW_REQUESTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MatchStatus" ADD VALUE 'AGREED';
ALTER TYPE "MatchStatus" ADD VALUE 'COMPLETED';

-- AlterEnum
ALTER TYPE "ReportTarget" ADD VALUE 'REVIEW';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "kind" "ChatKind" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "proposalId" TEXT;

-- AlterTable
ALTER TABLE "MatchRequest" ADD COLUMN     "deliveryMethod" "DeliveryMethod" NOT NULL DEFAULT 'PICKUP',
ADD COLUMN     "deliveryPlace" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "initiator" "Role" NOT NULL DEFAULT 'RESTAURANT',
ADD COLUMN     "producerAgreedAt" TIMESTAMP(3),
ADD COLUMN     "producerCompletedAt" TIMESTAMP(3),
ADD COLUMN     "restaurantAgreedAt" TIMESTAMP(3),
ADD COLUMN     "restaurantCompletedAt" TIMESTAMP(3),
ADD COLUMN     "shippingFeeYen" INTEGER,
ADD COLUMN     "shippingPayer" "ShippingPayer" NOT NULL DEFAULT 'UNDECIDED',
ADD COLUMN     "termsNote" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "acceptProposals" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneShare" "PhoneShare" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TermsProposal" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "proposerRole" "Role" NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unitPriceTaxIncl" INTEGER NOT NULL,
    "deliveryMethod" "DeliveryMethod" NOT NULL,
    "deliveryPlace" TEXT NOT NULL DEFAULT '',
    "pickupStart" TIMESTAMP(3) NOT NULL,
    "pickupEnd" TIMESTAMP(3) NOT NULL,
    "shippingFeeYen" INTEGER,
    "shippingPayer" "ShippingPayer" NOT NULL DEFAULT 'UNDECIDED',
    "note" TEXT NOT NULL DEFAULT '',
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TermsProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalBlock" (
    "restaurantId" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalBlock_pkey" PRIMARY KEY ("restaurantId","producerId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL,
    "matchId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "reviewerRole" "Role" NOT NULL,
    "reviewerUserId" TEXT,
    "targetRole" "Role" NOT NULL,
    "targetId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "satisfaction" INTEGER NOT NULL,
    "politeness" INTEGER NOT NULL,
    "smoothness" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TermsProposal_matchId_createdAt_idx" ON "TermsProposal"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_targetRole_targetId_idx" ON "Review"("targetRole", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_matchId_reviewerRole_key" ON "Review"("matchId", "reviewerRole");

-- AddForeignKey
ALTER TABLE "TermsProposal" ADD CONSTRAINT "TermsProposal_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "MatchRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalBlock" ADD CONSTRAINT "ProposalBlock_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalBlock" ADD CONSTRAINT "ProposalBlock_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "MatchRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "MatchRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 既存の依頼は「生産者の指定場所で受け取る」として、受渡場所に依頼時の受渡場所を写す（既存のデータは消さない）
UPDATE "MatchRequest" SET "deliveryPlace" = "locationName" WHERE "deliveryPlace" = '';
