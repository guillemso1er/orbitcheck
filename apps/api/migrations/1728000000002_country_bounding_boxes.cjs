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
  // Add table for country bounding boxes (min/max lat/lng for geo-validation)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS countries_bounding_boxes (
        country_code text PRIMARY KEY,
        min_lat double precision NOT NULL,
        max_lat double precision NOT NULL,
        min_lng double precision NOT NULL,
        max_lng double precision NOT NULL
    );
  `);

  // Sample data for major countries (extend with full GeoNames or external data)
  pgm.sql(`
    INSERT INTO countries_bounding_boxes (country_code, min_lat, max_lat, min_lng, max_lng) VALUES
    ('US', 18.0, 71.0, -179.0, -66.0),
    ('CA', 41.7, 83.1, -141.0, -52.6),
    ('MX', 14.5, 32.7, -118.4, -86.8),
    ('BR', -33.7, 5.3, -74.0, -34.8),
    ('AR', -55.0, -22.0, -73.5, -53.6),
    ('CL', -55.9, -17.5, -75.5, -66.7),
    ('PE', -18.3, -0.1, -81.3, -68.7),
    ('CO', 0.9, 12.5, -81.7, -66.9),
    ('ES', 27.6, 43.8, -9.5, 4.3),
    ('DE', 47.3, 55.1, 5.9, 15.0)
    ON CONFLICT (country_code) DO NOTHING;
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_bounding_country ON countries_bounding_boxes(country_code);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_bounding_country;`);
  pgm.sql(`DROP TABLE IF EXISTS countries_bounding_boxes;`);
};

module.exports = { shorthands, up, down };