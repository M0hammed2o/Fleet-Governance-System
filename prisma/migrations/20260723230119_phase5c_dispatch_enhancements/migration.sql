-- AlterEnum
ALTER TYPE "MediaAssetOwnerType" ADD VALUE 'MOVEMENT_DOCUMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE 'SALES_VISIT';
ALTER TYPE "MovementType" ADD VALUE 'SERVICE';
ALTER TYPE "MovementType" ADD VALUE 'AUTHORISED_PRIVATE_USE';

-- AlterTable
ALTER TABLE "movement_authorisations" ADD COLUMN     "recipientContact" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "senderContact" TEXT,
ADD COLUMN     "senderName" TEXT,
ADD COLUMN     "vehicleUsePolicyId" TEXT;
