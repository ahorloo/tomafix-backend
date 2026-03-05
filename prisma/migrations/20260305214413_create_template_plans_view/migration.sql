CREATE OR REPLACE VIEW "v_template_plans" AS
SELECT
  p."id"                  AS "planId",
  t."id"                  AS "templateId",
  t."key"                 AS "templateKey",
  t."name"                AS "templateName",
  p."name"                AS "planName",
  p."interval"            AS "planInterval",
  p."amountPesewas"       AS "amountPesewas",
  ROUND((p."amountPesewas"::numeric / 100), 2) AS "amountMajor",
  p."currency"            AS "currency",
  p."isActive"            AS "isActive",
  p."createdAt"           AS "createdAt",
  p."updatedAt"           AS "updatedAt"
FROM "Plan" p
JOIN "Template" t ON t."id" = p."templateId";
