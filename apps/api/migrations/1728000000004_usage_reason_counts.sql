-- Add reason_counts to usage_daily for per-rule metrics
ALTER TABLE usage_daily ADD COLUMN IF NOT EXISTS reason_counts jsonb DEFAULT '{}';

-- Trigger to update reason_counts on log insert
CREATE OR REPLACE FUNCTION update_usage_reason_counts() RETURNS trigger AS $$
BEGIN
  INSERT INTO usage_daily (project_id, date, validations, orders, reason_counts)
  VALUES (
    NEW.project_id,
    CURRENT_DATE,
    CASE WHEN NEW.type = 'validation' THEN 1 ELSE 0 END,
    CASE WHEN NEW.type = 'order' THEN 1 ELSE 0 END,
    jsonb_object_agg(rc, COALESCE(rc_count, 0))
  )
  ON CONFLICT (project_id, date) DO UPDATE SET
    validations = usage_daily.validations + EXCLUDED.validations,
    orders = usage_daily.orders + EXCLUDED.orders,
    reason_counts = usage_daily.reason_counts || EXCLUDED.reason_counts;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_usage_trigger AFTER INSERT ON logs FOR EACH ROW EXECUTE FUNCTION update_usage_reason_counts();