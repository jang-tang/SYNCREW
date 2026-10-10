-- Prisma 스키마로 표현할 수 없는 제약조건
ALTER TABLE "openai_usage" ADD CONSTRAINT "openai_usage_kind_check" CHECK ("kind" IN ('stt', 'translate'));
ALTER TABLE "openai_usage" ADD CONSTRAINT "openai_usage_cost_check" CHECK ("cost_usd" >= 0);
