-- P2022: колонка Manager.telegramUsername отсутствовала в БД
ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "telegramUsername" TEXT;
