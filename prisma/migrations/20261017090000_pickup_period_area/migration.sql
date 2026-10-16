-- AlterTable
ALTER TABLE "Demand" ADD COLUMN     "prefecture" TEXT;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "pickupEndMin" INTEGER,
ADD COLUMN     "pickupStartMin" INTEGER,
ADD COLUMN     "pickupWeekdays" INTEGER;

