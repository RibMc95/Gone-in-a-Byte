const oracledb = require("oracledb");

oracledb.fetchAsString = [oracledb.CLOB];

const DEFAULT_ORDERS_TABLE = process.env.ORACLE_ORDERS_TABLE || "ORDERS";
const DEFAULT_HISTORY_TABLE = process.env.ORACLE_HISTORY_TABLE || "ORDER_HISTORY";

// How long an order may sit in "processing" before it's considered stale and
// reclaimable (e.g. the server crashed mid-charge). Default 5 minutes.
const PROCESSING_TIMEOUT_MS = Number(process.env.PAYMENT_PROCESSING_TIMEOUT_MS) || 5 * 60 * 1000;

// How long a logged-in user's cached order list / history stays fresh before
// it's re-read from the DB. Every write of that user's busts their entry, so
// this only bounds staleness as a backstop. Single-process only (fine for our
// one backend instance; see scaling-roadmap.md for the Redis version at scale).
const USER_CACHE_TTL_MS = Number(process.env.USER_CACHE_TTL_MS) || 30 * 1000;

let poolPromise;

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required Oracle configuration: ${name}`);
    }

    return value;
}

function getPoolConfig() {
    const user = getRequiredEnv("ORACLE_DB_USER");
    const password = getRequiredEnv("ORACLE_DB_PASSWORD");
    const connectString = getRequiredEnv("ORACLE_DB_CONNECT_STRING");

    const config = {
        user,
        password,
        connectString,
        poolMin: 0,
        poolMax: Number(process.env.ORACLE_POOL_MAX || 4),
        poolIncrement: 1,
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

async function getPool() {
    if (!poolPromise) {
        poolPromise = oracledb.createPool(getPoolConfig());
    }

    return poolPromise;
}

async function closePool() {
    if (!poolPromise) {
        return;
    }

    const pool = await poolPromise;
    await pool.close(10);
    poolPromise = undefined;
}

async function withConnection(work) {
    const pool = await getPool();
    const connection = await pool.getConnection();

    try {
        return await work(connection);
    } finally {
        await connection.close();
    }
}

async function executeDdl(connection, sql) {
    try {
        await connection.execute(sql);
    } catch (error) {
        if (error && error.errorNum === 955) {
            return;
        }

        throw error;
    }
}

function safeString(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value);
}

function toJson(value) {
    return JSON.stringify(value || {});
}

function parseJson(payload) {
    try {
        return JSON.parse(payload);
    } catch (error) {
        return null;
    }
}

function createOracleStorage() {
    // Per-user read caches: userId -> { expires, data }. The order list and
    // history are read far more often than they change (a logged-in customer
    // reloads their orders page), so a short-lived cache saves most DB round
    // trips without ever serving stale data — any write of the user's clears
    // their entry below.
    const orderListCache = new Map();
    const historyCache = new Map();

    function cacheGet(cache, key) {
        const hit = cache.get(key);
        if (!hit) {
            return undefined;
        }
        if (hit.expires <= Date.now()) {
            cache.delete(key);
            return undefined;
        }
        return hit.data;
    }

    function cacheSet(cache, key, data) {
        cache.set(key, { expires: Date.now() + USER_CACHE_TTL_MS, data });
    }

    // Drop a user's cached order list AND history after any write of theirs.
    // With no userId on hand (e.g. deleteOrder by id only) we can't tell whose
    // list changed, so clear everything — correctness beats a cache hit.
    function invalidateUser(userId) {
        const key = safeString(userId);
        if (key) {
            orderListCache.delete(key);
            historyCache.delete(key);
        } else {
            orderListCache.clear();
            historyCache.clear();
        }
    }

    async function init() {
        const ensureOrdersSchema = withConnection(async (connection) => {
            await executeDdl(
                connection,
                `CREATE TABLE ${DEFAULT_ORDERS_TABLE} (
                    ID VARCHAR2(128) PRIMARY KEY,
                    USER_ID VARCHAR2(256) NOT NULL,
                    CREATED_AT VARCHAR2(64) NOT NULL,
                    UPDATED_AT VARCHAR2(64) NOT NULL,
                    ORDER_JSON CLOB CHECK (ORDER_JSON IS JSON)
                )`
            );

            await executeDdl(
                connection,
                `CREATE INDEX IDX_${DEFAULT_ORDERS_TABLE}_USER_CREATED
                 ON ${DEFAULT_ORDERS_TABLE} (USER_ID, CREATED_AT DESC)`
            );
        });

        const ensureHistorySchema = withConnection(async (connection) => {
            await executeDdl(
                connection,
                `CREATE TABLE ${DEFAULT_HISTORY_TABLE} (
                    HISTORY_ID VARCHAR2(128) PRIMARY KEY,
                    USER_ID VARCHAR2(256) NOT NULL,
                    EVENT_TS VARCHAR2(64) NOT NULL,
                    ENTRY_JSON CLOB CHECK (ENTRY_JSON IS JSON)
                )`
            );

            await executeDdl(
                connection,
                `CREATE INDEX IDX_${DEFAULT_HISTORY_TABLE}_USER_TS
                 ON ${DEFAULT_HISTORY_TABLE} (USER_ID, EVENT_TS DESC)`
            );
        });

        await Promise.all([ensureOrdersSchema, ensureHistorySchema]);
    }

    // --- Connection-level statement helpers (no commit) ---
    // These run a single statement on a caller-supplied connection WITHOUT
    // committing, so they can be composed into one atomic transaction.
    // The public methods below wrap them and commit once.

    async function mergeOrderStmt(connection, order) {
        await connection.execute(
            `MERGE INTO ${DEFAULT_ORDERS_TABLE} target
                 USING (
                     SELECT
                         :id AS id,
                         :userId AS user_id,
                         :createdAt AS created_at,
                         :updatedAt AS updated_at,
                         :orderJson AS order_json
                     FROM dual
                 ) incoming
                 ON (target.id = incoming.id)
                 WHEN MATCHED THEN UPDATE SET
                     target.user_id = incoming.user_id,
                     target.created_at = incoming.created_at,
                     target.updated_at = incoming.updated_at,
                     target.order_json = incoming.order_json
                 WHEN NOT MATCHED THEN INSERT (
                     id,
                     user_id,
                     created_at,
                     updated_at,
                     order_json
                 ) VALUES (
                     incoming.id,
                     incoming.user_id,
                     incoming.created_at,
                     incoming.updated_at,
                     incoming.order_json
                 )`,
            {
                id: safeString(order && order.id),
                userId: safeString(order && order.userId),
                createdAt: safeString(order && order.createdAt),
                updatedAt: safeString(order && order.updatedAt),
                orderJson: toJson(order),
            }
        );
    }

    async function deleteOrderStmt(connection, orderId) {
        await connection.execute(
            `DELETE FROM ${DEFAULT_ORDERS_TABLE}
                 WHERE ID = :id`,
            { id: safeString(orderId) }
        );
    }

    async function insertHistoryStmt(connection, entry) {
        await connection.execute(
            `INSERT INTO ${DEFAULT_HISTORY_TABLE} (
                    HISTORY_ID,
                    USER_ID,
                    EVENT_TS,
                    ENTRY_JSON
                 ) VALUES (
                    :historyId,
                    :userId,
                    :eventTs,
                    :entryJson
                 )`,
            {
                historyId: safeString(entry && entry.historyId),
                userId: safeString(entry && entry.userId),
                eventTs: safeString(entry && entry.timestamp),
                entryJson: toJson(entry),
            }
        );
    }

    async function putOrder(order) {
        await withConnection(async (connection) => {
            await mergeOrderStmt(connection, order);
            await connection.commit();
        });

        invalidateUser(order && order.userId);
        return order;
    }

    // Save an order AND record a history entry in a SINGLE transaction.
    // Either both commit or neither does — no partial state where the order
    // exists without its history row (or vice versa).
    async function putOrderWithHistory(order, historyEntry) {
        await withConnection(async (connection) => {
            await mergeOrderStmt(connection, order);
            await insertHistoryStmt(connection, historyEntry);
            await connection.commit();
        });

        invalidateUser(order && order.userId);
        return order;
    }

    // Atomically claim an order for payment so two concurrent payment requests
    // can't both charge the same card. Locks the order row (SELECT ... FOR
    // UPDATE), re-reads the status, and — only if it's still "pending" — marks
    // it "processing" and commits (releasing the lock before the slow Square
    // call). A concurrent request blocks on the lock, then sees "processing"
    // or "paid" and is turned away.
    // Returns: { status: "claimed" | "already_paid" | "in_progress" | "not_found", order }
    async function claimOrderForPayment(orderId) {
        return withConnection(async (connection) => {
            const result = await connection.execute(
                `SELECT ORDER_JSON
                 FROM ${DEFAULT_ORDERS_TABLE}
                 WHERE ID = :id
                 FOR UPDATE`,
                { id: safeString(orderId) },
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            if (!result.rows || result.rows.length === 0) {
                await connection.commit();
                return { status: "not_found" };
            }

            const order = parseJson(result.rows[0].ORDER_JSON);
            if (!order) {
                await connection.commit();
                return { status: "not_found" };
            }

            if (order.paymentStatus === "paid") {
                await connection.commit();
                return { status: "already_paid", order };
            }

            if (order.paymentStatus === "processing") {
                // Reclaim if the previous attempt has been stuck past the
                // timeout (e.g. the server crashed mid-charge); otherwise treat
                // it as a genuine in-flight payment and turn this request away.
                const since = Date.parse(order.updatedAt || "");
                const isStale = Number.isFinite(since) && Date.now() - since > PROCESSING_TIMEOUT_MS;
                if (!isStale) {
                    await connection.commit();
                    return { status: "in_progress", order };
                }
            }

            order.paymentStatus = "processing";
            order.updatedAt = new Date().toISOString();
            await mergeOrderStmt(connection, order);
            await connection.commit();
            invalidateUser(order.userId);
            return { status: "claimed", order };
        });
    }

    async function getOrder(orderId) {
        return withConnection(async (connection) => {
            const result = await connection.execute(
                `SELECT ORDER_JSON
                 FROM ${DEFAULT_ORDERS_TABLE}
                 WHERE ID = :id`,
                { id: safeString(orderId) },
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            if (!result.rows || result.rows.length === 0) {
                return null;
            }

            return parseJson(result.rows[0].ORDER_JSON);
        });
    }

    async function listOrdersByUser(userId) {
        const key = safeString(userId);
        const cached = cacheGet(orderListCache, key);
        if (cached) {
            return cached;
        }

        const orders = await withConnection(async (connection) => {
            const result = await connection.execute(
                `SELECT ORDER_JSON
                 FROM ${DEFAULT_ORDERS_TABLE}
                 WHERE USER_ID = :userId
                 ORDER BY CREATED_AT DESC`,
                { userId: key },
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            return (result.rows || []).reduce((acc, row) => {
                const parsed = parseJson(row.ORDER_JSON);
                if (parsed) {
                    acc.push(parsed);
                }
                return acc;
            }, []);
        });

        cacheSet(orderListCache, key, orders);
        return orders;
    }

    // Cheap "is the DB reachable?" check for the health endpoint.
    async function ping() {
        return withConnection(async (connection) => {
            await connection.execute("SELECT 1 FROM DUAL");
            return true;
        });
    }

    // Every order across all users, newest first. For the admin/kitchen queue.
    // Not cached (admin-only, low volume, and must always be current).
    async function listAllOrders() {
        return withConnection(async (connection) => {
            const result = await connection.execute(
                `SELECT ORDER_JSON
                 FROM ${DEFAULT_ORDERS_TABLE}
                 ORDER BY CREATED_AT DESC`,
                {},
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            return (result.rows || []).reduce((acc, row) => {
                const parsed = parseJson(row.ORDER_JSON);
                if (parsed) {
                    acc.push(parsed);
                }
                return acc;
            }, []);
        });
    }

    async function deleteOrder(orderId) {
        await withConnection(async (connection) => {
            await deleteOrderStmt(connection, orderId);
            await connection.commit();
        });

        // No userId available here, so clear all cached lists (see invalidateUser).
        invalidateUser();
    }

    // Delete an order AND record a history entry in a SINGLE transaction.
    async function deleteOrderWithHistory(orderId, historyEntry) {
        await withConnection(async (connection) => {
            await deleteOrderStmt(connection, orderId);
            await insertHistoryStmt(connection, historyEntry);
            await connection.commit();
        });

        invalidateUser(historyEntry && historyEntry.userId);
    }

    async function addHistoryEntry(entry) {
        await withConnection(async (connection) => {
            await insertHistoryStmt(connection, entry);
            await connection.commit();
        });

        invalidateUser(entry && entry.userId);
        return entry;
    }

    async function listHistoryForUser(userId) {
        const key = safeString(userId);
        const cached = cacheGet(historyCache, key);
        if (cached) {
            return cached;
        }

        const history = await withConnection(async (connection) => {
            const result = await connection.execute(
                `SELECT ENTRY_JSON
                 FROM ${DEFAULT_HISTORY_TABLE}
                 WHERE USER_ID = :userId
                 ORDER BY EVENT_TS DESC`,
                { userId: key },
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            return (result.rows || []).reduce((acc, row) => {
                const parsed = parseJson(row.ENTRY_JSON);
                if (parsed) {
                    acc.push(parsed);
                }
                return acc;
            }, []);
        });

        cacheSet(historyCache, key, history);
        return history;
    }

    return {
        init,
        putOrder,
        putOrderWithHistory,
        claimOrderForPayment,
        getOrder,
        listOrdersByUser,
        listAllOrders,
        ping,
        deleteOrder,
        deleteOrderWithHistory,
        addHistoryEntry,
        listHistoryForUser,
        close: closePool,
    };
}

module.exports = {
    createOracleStorage,
};
