/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Drop the existing trigger first
  pgm.sql(`DROP TRIGGER IF EXISTS log_usage_trigger ON logs;`);
  
  // Drop the existing function
  pgm.sql(`DROP FUNCTION IF EXISTS update_usage_reason_counts();`);
  
  // Create the corrected function
  pgm.sql(`
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
  `);
  
  // Recreate the trigger
  pgm.sql(`
    CREATE TRIGGER log_usage_trigger AFTER INSERT ON logs FOR EACH ROW EXECUTE FUNCTION update_usage_reason_counts();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {};
