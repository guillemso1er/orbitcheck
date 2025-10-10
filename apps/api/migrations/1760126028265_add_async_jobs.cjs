/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  // Async jobs table for batch operations
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        job_type text NOT NULL CHECK (job_type IN ('batch_validate', 'batch_dedupe')),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        input_data jsonb NOT NULL,
        result_data jsonb,
        error_message text,
        total_items integer,
        processed_items integer DEFAULT 0,
        result_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
    );
  `);

  // Indexes for efficient queries
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_jobs_project_id ON jobs(project_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);`);

  // Function to update updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_job_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger to automatically update updated_at
  pgm.sql(`
    CREATE TRIGGER update_jobs_updated_at_trigger
    BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_job_updated_at();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS update_jobs_updated_at_trigger ON jobs;`);
  pgm.sql(`DROP FUNCTION IF EXISTS update_job_updated_at();`);
  pgm.sql(`DROP TABLE IF EXISTS jobs;`);
};

module.exports = { shorthands, up, down };