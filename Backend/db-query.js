/*
Ad-hoc SQL runner — poke at the database without the Oracle web console.

Run it INSIDE the backend container (reuses the wallet + creds already there,
so NO extra logins):

    docker compose exec backend node db-query.js "SELECT * FROM ORDERS FETCH FIRST 10 ROWS ONLY"
    docker compose exec backend node db-query.js "SELECT COUNT(*) FROM ORDER_HISTORY"

SELECTs print their rows. Statements that change data (UPDATE/DELETE/INSERT) are
NOT saved unless you add --commit, so you can't wreck anything by accident:

    docker compose exec backend node db-query.js --commit "DELETE FROM ORDERS WHERE ID = 'diag_123'"

This is a dev/debug tool — it runs whatever SQL you give it. Use it on your own DB.
*/

const oracledb = require("oracledb");

oracledb.fetchAsString = [oracledb.CLOB]; // show ORDER_JSON / ENTRY_JSON as text

const args = process.argv.slice(2);
const doCommit = args.includes("--commit");
const sql = args.filter((a) => a !== "--commit").join(" ").trim();

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

async function main() {
    if (!sql) {
        console.error('Usage: node db-query.js [--commit] "<SQL statement>"');
        process.exitCode = 1;
        return;
    }

    let connection;
    try {
        connection = await oracledb.getConnection(getConfig());
        const result = await connection.execute(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        if (result.rows) {
            // A query — print the rows.
            result.rows.forEach((row) => console.log(JSON.stringify(row)));
            console.log(`\n${result.rows.length} row(s).`);
        } else {
            // A DML/DDL statement — report what it touched.
            const affected = result.rowsAffected || 0;
            if (doCommit) {
                await connection.commit();
                console.log(`${affected} row(s) affected — committed.`);
            } else {
                console.log(`${affected} row(s) affected — NOT committed (add --commit to save).`);
            }
        }
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
