-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProposalStatus" ADD VALUE 'SUPERSEDED';
ALTER TYPE "ProposalStatus" ADD VALUE 'REVOKED';

-- DropForeignKey
ALTER TABLE "Proposal" DROP CONSTRAINT "Proposal_dictionaryEntryId_fkey";

-- AlterTable
ALTER TABLE "DictionaryEntry" ADD COLUMN     "declaredStandard" JSONB;

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "importId" TEXT,
ADD COLUMN     "label" TEXT,
ALTER COLUMN "dictionaryEntryId" DROP NOT NULL,
ALTER COLUMN "signalClass" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Proposal_publisherId_field_rawId_idx" ON "Proposal"("publisherId", "field", "rawId");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_dictionaryEntryId_fkey" FOREIGN KEY ("dictionaryEntryId") REFERENCES "DictionaryEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
