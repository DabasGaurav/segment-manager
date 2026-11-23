-- CreateEnum
CREATE TYPE "Role" AS ENUM ('publisher_ops', 'reviewer', 'curator', 'admin');

-- CreateEnum
CREATE TYPE "ServiceRole" AS ENUM ('bidder_service', 'demo_readonly');

-- CreateEnum
CREATE TYPE "GrantLevel" AS ENUM ('G0', 'G1', 'G2', 'G3');

-- CreateEnum
CREATE TYPE "UnmappedHandling" AS ENUM ('drop', 'pass_raw');

-- CreateEnum
CREATE TYPE "SignalClass" AS ENUM ('CONTENT_TOPIC', 'AUDIENCE_INTEREST', 'PURCHASE_INTENT', 'DEMOGRAPHIC');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ABSTAINED', 'BLOCKED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publisher" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT true,
    "activeVersionNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Publisher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPublisher" (
    "userId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,

    CONSTRAINT "UserPublisher_pkey" PRIMARY KEY ("userId","publisherId")
);

-- CreateTable
CREATE TABLE "ServiceKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "ServiceRole" NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Import" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DictionaryEntry" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rawId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "declaredClass" "SignalClass" NOT NULL,
    "declaredSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DictionaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "dictionaryEntryId" TEXT NOT NULL,
    "rawId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "signalClass" "SignalClass" NOT NULL,
    "status" "ProposalStatus" NOT NULL,
    "method" TEXT NOT NULL,
    "targetSegtax" INTEGER,
    "targetId" TEXT,
    "matchType" TEXT,
    "matchScore" DOUBLE PRECISION,
    "candidates" JSONB NOT NULL,
    "reasonCodes" TEXT[],
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grant" (
    "publisherId" TEXT NOT NULL,
    "level" "GrantLevel" NOT NULL DEFAULT 'G0',
    "dspAllowlist" TEXT[],
    "curatorAllowlist" TEXT[],
    "unmappedHandling" "UnmappedHandling" NOT NULL DEFAULT 'pass_raw',
    "consentBasisNote" TEXT,
    "attestedBy" TEXT,
    "attestedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grant_pkey" PRIMARY KEY ("publisherId")
);

-- CreateTable
CREATE TABLE "MappingVersion" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MappingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "publisherId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "mappingVersion" INTEGER,
    "requestIdHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Publisher_tenantId_idx" ON "Publisher"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_persona_key" ON "User"("persona");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceKey_keyHash_key" ON "ServiceKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Import_publisherId_idempotencyKey_key" ON "Import"("publisherId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DictionaryEntry_publisherId_field_rawId_idx" ON "DictionaryEntry"("publisherId", "field", "rawId");

-- CreateIndex
CREATE INDEX "Proposal_publisherId_status_idx" ON "Proposal"("publisherId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MappingVersion_publisherId_number_key" ON "MappingVersion"("publisherId", "number");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_publisherId_createdAt_idx" ON "AuditEvent"("tenantId", "publisherId", "createdAt");

-- AddForeignKey
ALTER TABLE "Publisher" ADD CONSTRAINT "Publisher_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPublisher" ADD CONSTRAINT "UserPublisher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPublisher" ADD CONSTRAINT "UserPublisher_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceKey" ADD CONSTRAINT "ServiceKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Import" ADD CONSTRAINT "Import_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DictionaryEntry" ADD CONSTRAINT "DictionaryEntry_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DictionaryEntry" ADD CONSTRAINT "DictionaryEntry_importId_fkey" FOREIGN KEY ("importId") REFERENCES "Import"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_dictionaryEntryId_fkey" FOREIGN KEY ("dictionaryEntryId") REFERENCES "DictionaryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingVersion" ADD CONSTRAINT "MappingVersion_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only enforcement (Phase 3 §4.6: published versions and audit events are immutable).
-- UPDATE is always rejected. DELETE is rejected unless the transaction sets app.allow_reset = 'on',
-- which only the demo-tenant reset does.
CREATE OR REPLACE FUNCTION sm_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only table %: UPDATE is not allowed', TG_TABLE_NAME;
  END IF;
  IF coalesce(current_setting('app.allow_reset', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'append-only table %: DELETE is not allowed', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION sm_append_only();
CREATE TRIGGER "MappingVersion_append_only" BEFORE UPDATE OR DELETE ON "MappingVersion"
  FOR EACH ROW EXECUTE FUNCTION sm_append_only();
