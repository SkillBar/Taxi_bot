-- Baseline: существующая БД уже содержит таблицы Agent, Manager, DriverLink и др.
-- Пометить как применённую: npx prisma migrate resolve --applied "20240101000000_baseline_existing_schema"
-- Затем: npx prisma migrate deploy
SELECT 1;
