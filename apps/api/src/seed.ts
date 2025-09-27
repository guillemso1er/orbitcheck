import { createHash, randomBytes } from "crypto";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
    const { rows } = await pool.query("insert into projects (name, plan) values ($1, $2) returning id", ["Dev Project", "dev"]);
    const project_id = rows[0].id;
    const raw = "ok_test_" + randomBytes(18).toString("hex");

    // Use the same hashing mechanism as the auth function
    const hash = createHash('sha256').update(raw).digest('hex');

    // The hash column in your DB should be a simple TEXT or VARCHAR
    await pool.query(
        "insert into api_keys(project_id, prefix, hash, status) values ($1, $2, $3, $4)",
        [project_id, raw.slice(0, 6), hash, 'active']
    );

    console.log("PROJECT_ID=", project_id);
    console.log("API_KEY=", raw);
    process.exit(0);
})();