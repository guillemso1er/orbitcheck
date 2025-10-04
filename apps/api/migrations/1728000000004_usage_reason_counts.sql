-- Add reason_counts to usage_daily for per-rule metrics
ALTER TABLE usage_daily ADD COLUMN IF NOT EXISTS reason_counts jsonb DEFAULT '{}';

-- Trigger to update reason_counts on log insert
CREATE OR REPLACE FUNCTION update_usage_reason_counts() RETURNS trigger AS $$
DECLARE
    reason_counts_json jsonb;
BEGIN
  -- Aggregate reason codes into JSONB object
  SELECT COALESCE(jsonb_object_agg(reason_code, count), '{}'::jsonb)
  INTO reason_counts_json
  FROM (
    SELECT unnest(NEW.reason_codes) as reason_code, COUNT(*) as count
    GROUP BY reason_code
  ) sub;

  -- Update usage_daily with aggregated reason code counts
  INSERT INTO usage_daily (project_id, date, validations, orders, reason_counts)
  VALUES (
    NEW.project_id,
    CURRENT_DATE,
    CASE WHEN NEW.type = 'validation' THEN 1 ELSE 0 END,
    CASE WHEN NEW.type = 'order' THEN 1 ELSE 0 END,
    reason_counts_json
  )
  ON CONFLICT (project_id, date) DO UPDATE SET
    validations = usage_daily.validations + EXCLUDED.validations,
    orders = usage_daily.orders + EXCLUDED.orders,
    reason_counts = usage_daily.reason_counts || EXCLUDED.reason_counts;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_usage_trigger AFTER INSERT ON logs FOR EACH ROW EXECUTE FUNCTION update_usage_reason_counts();