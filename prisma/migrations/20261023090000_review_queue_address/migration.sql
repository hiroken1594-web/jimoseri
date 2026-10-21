-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'APPLICATION_APPROVED';
ALTER TYPE "NotificationKind" ADD VALUE 'APPLICATION_REJECTED';

-- AlterEnum
ALTER TYPE "ReviewStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "deliveryAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "shippingFeeYen" INTEGER;

-- AlterTable
ALTER TABLE "PickupLocation" ADD COLUMN     "building" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Producer" ADD COLUMN     "building" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "building" TEXT;

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "decision" "ReviewStatus" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "adminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewDecision_targetType_targetId_idx" ON "ReviewDecision"("targetType", "targetId");

