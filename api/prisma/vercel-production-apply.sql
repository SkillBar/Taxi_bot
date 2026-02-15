-- Выполнить в Neon (SQL Editor) для той БД, которую использует Vercel (DATABASE_URL).
-- Добавляет FleetPark и колонки Manager, если их ещё нет.

-- 1) Таблица FleetPark
CREATE TABLE IF NOT EXISTS "FleetPark" (
    "id" SERIAL NOT NULL,
    "parkId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetPark_pkey" PRIMARY KEY ("id")
);

-- 2) Колонки Manager
ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "telegramUsername" TEXT;
ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- fleetParkId (если уже есть — пропустите следующую строку)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Manager' AND column_name = 'fleetParkId'
  ) THEN
    ALTER TABLE "Manager" ADD COLUMN "fleetParkId" INTEGER;
  END IF;
END $$;

-- 3) Внешний ключ
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Manager_fleetParkId_fkey') THEN
    ALTER TABLE "Manager" ADD CONSTRAINT "Manager_fleetParkId_fkey"
      FOREIGN KEY ("fleetParkId") REFERENCES "FleetPark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
