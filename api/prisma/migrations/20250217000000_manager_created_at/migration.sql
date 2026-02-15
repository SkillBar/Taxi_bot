-- Добавить createdAt для сообщения «номер не был в базе»
ALTER TABLE "Manager" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
