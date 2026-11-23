-- Hardening after independent review (Checkpoint 1):
-- 1. Row triggers do not fire on TRUNCATE, so block TRUNCATE with statement-level triggers.
-- 2. The reset flag now only permits deleting rows that belong to the synthetic demo tenant.

CREATE OR REPLACE FUNCTION sm_append_only() RETURNS trigger AS $$
DECLARE
  row_tenant text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only table %: UPDATE is not allowed', TG_TABLE_NAME;
  END IF;
  IF coalesce(current_setting('app.allow_reset', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'append-only table %: DELETE is not allowed', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'AuditEvent' THEN
    row_tenant := OLD."tenantId";
  ELSE
    SELECT p."tenantId" INTO row_tenant FROM "Publisher" p WHERE p.id = OLD."publisherId";
  END IF;
  IF row_tenant IS DISTINCT FROM 'ten_demo' THEN
    RAISE EXCEPTION 'append-only table %: reset may only delete demo-tenant rows', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sm_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: TRUNCATE is not allowed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_no_truncate" BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION sm_no_truncate();
CREATE TRIGGER "MappingVersion_no_truncate" BEFORE TRUNCATE ON "MappingVersion"
  FOR EACH STATEMENT EXECUTE FUNCTION sm_no_truncate();
