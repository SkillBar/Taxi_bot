-- CreateTable
CREATE TABLE "FleetPark" (
    "id" SERIAL NOT NULL,
    "parkId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetPark_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add phone (if missing) and fleetParkId to Manager
ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Manager" ADD COLUMN "fleetParkId" INTEGER;

-- CreateForeignKey
ALTER TABLE "Manager" ADD CONSTRAINT "Manager_fleetParkId_fkey" 
  FOREIGN KEY ("fleetParkId") REFERENCES "FleetPark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
