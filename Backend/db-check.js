/*
Database connection check — a fast "is Oracle actually working?" tool.

Run it INSIDE the backend container (where the env vars + wallet already live):

    docker compose exec backend node db-check.js            # read-only
    docker compose exec backend node db-check.js --write     # also test a write

Read-only mode: connects, runs SELECT 1, and counts rows in the orders +
history tables. Proves the connection works and shows your data is there.

--write mode: additionally inserts a clearly-marked diagnostic row, reads it
back, and deletes it — proving writes persist. It cleans up after itself.

Exit code 0 = all checks passed, 1 = something failed (good for scripts/CI).
*/

const oracledb = require("oracledb");

const ORDERS_TABLE = process.env.ORACLE_ORDERS_TABLE || "ORDERS";
const HISTORY_TABLE = process.env.ORACLE_HISTORY_TABLE || "ORDER_HISTORY";
const doWriteTest = process.argv.includes("--write");

// Same connection config the app uses (mirrors getPoolConfig in oracleStorage.js).
function getConfig() {
    const required = ["ORACLE_DB_USER", "ORACLE_DB_PASSWORD", "ORACLE_DB_CONNECT_STRING"];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length > 0) {
        throw new Error(`Missing env var(s): ${missing.join(", ")}. Run this inside the backend container.`);
    }

    const config = {
        user: process.env.ORACLE_DB_USER,
        password: process.env.ORACLE_DB_PASSWORD,
        connectString: process.env.ORACLE_DB_CONNECT_STRING,
    };
    if (process.env.ORACLE_WALLET_DIR) {
        config.configDir = process.env.ORACLE_WALLET_DIR;
        config.walletLocation = process.env.ORACLE_WALLET_DIR;
    }
    if (process.env.ORACLE_WALLET_PASSWORD) {
        config.walletPassword = process.env.ORACLE_WALLET_PASSWORD;
    }
    return config;
}

function pass(msg) { console.log(`  [PASS] ${msg}`); }
function info(msg) { console.log(`  [info] ${msg}`); }

async function countRows(connection, table) {
    const result = await connection.execute(`SELECT COUNT(*) AS N FROM ${table}`, {}, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return result.rows[0].N;
}

async function writeRoundTrip(connection) {
    const id = `diag_${Date.now()}`;
    const now = new Date().toISOString();
    const json = JSON.stringify({ id, diagnostic: true, note: "db-check.js — safe to delete" });

    // Insert
    await connection.execute(
        `INSERT INTO ${ORDERS_TABLE} (ID, USER_ID, CREATED_AT, UPDATED_AT, ORDER_JSON)
         VALUES (:id, :userId, :createdAt, :updatedAt, :orderJson)`,
        { id, userId: "db-check@diagnostic", createdAt: now, updatedAt: now, orderJson: json }
    );
    await connection.commit();
    pass(`inserted diagnostic row ${id}`);

    // Read back
    const read = await connection.execute(
        `SELECT ID FROM ${ORDERS_TABLE} WHERE ID = :id`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!read.rows || read.rows.length === 0) {
        throw new Error("diagnostic row was not found after insert — writes are NOT persisting");
    }
    pass("read the diagnostic row back — writes persist");

    // Clean up
    await connection.execute(`DELETE FROM ${ORDERS_TABLE} WHERE ID = :id`, { id });
    await connection.commit();
    pass("deleted the diagnostic row (cleaned up)");
}

async function main() {
    console.log(`\nDatabase check — ${new Date().toISOString()}`);
    console.log(`Tables: ${ORDERS_TABLE}, ${HISTORY_TABLE}${doWriteTest ? "  (write test ON)" : ""}\n`);

    let connection;
    try {
        connection = await oracledb.getConnection(getConfig());
        pass("connected to Oracle");

        await connection.execute("SELECT 1 FROM DUAL");
        pass("ran a test query (SELECT 1)");

        info(`${ORDERS_TABLE}: ${await countRows(connection, ORDERS_TABLE)} row(s)`);
        info(`${HISTORY_TABLE}: ${await countRows(connection, HISTORY_TABLE)} row(s)`);

        if (doWriteTest) {
            await writeRoundTrip(connection);
        }

        console.log("\nAll checks passed. ✅\n");
    } catch (error) {
        console.error(`\n  [FAIL] ${error.message}\n`);
        console.error("See docs/database-runbook.md for what this error usually means.\n");
        process.exitCode = 1;
    } finally {
        if (connection) {
            try { await connection.close(); } catch (_) { /* ignore */ }
        }
    }
}

main();
