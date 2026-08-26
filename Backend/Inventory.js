const express = require("express");

function getSquareClient() {
    try {
        const square = require("square");
        const Client = square.Client || square.SquareClient;
        const Environment = square.Environment || square.SquareEnvironment;
        const accessToken = process.env.SQUARE_ACCESS_TOKEN;
        const environment =
            process.env.SQUARE_ENVIRONMENT === "production"
                ? Environment.Production
                : Environment.Sandbox;

        if (!accessToken) {
            return {
                error: "SQUARE_ACCESS_TOKEN is not set on the backend.",
            };
        }

        return {
            client: new Client({
                accessToken,
                environment,
            }),
        };
    } catch (error) {
        return {
            error: "Square SDK is not installed. Run npm install square in Backend.",
        };
    }
}

function normalizeSquareError(error) {
    const fromSdk = error && error.result && error.result.errors;
    if (Array.isArray(fromSdk) && fromSdk.length > 0) {
        return fromSdk.map((entry) => entry.detail || entry.code || "Square API error").join("; ");
    }

    if (error && error.message) {
        return error.message;
    }

    return "Unexpected inventory error";
}

function parseBool(value) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    if (value.toLowerCase() === "true") {
        return true;
    }
    if (value.toLowerCase() === "false") {
        return false;
    }
    return undefined;
}

function toStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.reduce((acc, entry) => {
        const normalized = String(entry || "").trim();
        if (normalized.length > 0) {
            acc.push(normalized);
        }
        return acc;
    }, []);
}

function createInventoryRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }

        return client;
    }

    // Retrieve InventoryAdjustment
    router.get("/square/inventory/adjustments/:adjustmentId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.inventory.getAdjustment(req.params.adjustmentId);
            return res.json({
                adjustment: result && result.result && result.result.adjustment,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BatchChangeInventory
    router.post("/square/inventory/batch-change", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const changes = Array.isArray(body.changes) ? body.changes : [];
        if (changes.length === 0) {
            return res.status(400).json({ error: "changes is required and must be a non-empty array" });
        }

        const payload = {
            changes,
            idempotencyKey: body.idempotencyKey || body.idempotency_key,
            ignoreUnchangedCounts: body.ignoreUnchangedCounts ?? body.ignore_unchanged_counts,
        };

        try {
            const result = await client.inventory.batchCreateChanges(payload);
            return res.status(201).json({
                changes: (result && result.result && result.result.changes) || [],
                errors: result && result.result && result.result.errors,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BatchRetrieveInventoryChanges
    router.post("/square/inventory/changes/batch-retrieve", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const payload = {
            catalogObjectIds: body.catalogObjectIds || body.catalog_object_ids,
            locationIds: body.locationIds || body.location_ids,
            types: body.types,
            states: body.states,
            updatedAfter: body.updatedAfter || body.updated_after,
            updatedBefore: body.updatedBefore || body.updated_before,
            cursor: body.cursor,
            limit: body.limit,
        };

        try {
            const result = await client.inventory.batchGetChanges(payload);
            return res.json({
                changes: (result && result.result && result.result.changes) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BatchRetrieveInventoryCounts
    router.post("/square/inventory/counts/batch-retrieve", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const payload = {
            catalogObjectIds: body.catalogObjectIds || body.catalog_object_ids,
            locationIds: body.locationIds || body.location_ids,
            updatedAfter: body.updatedAfter || body.updated_after,
            cursor: body.cursor,
            limit: body.limit,
            states: body.states,
        };

        try {
            const result = await client.inventory.batchGetCounts(payload);
            return res.json({
                counts: (result && result.result && result.result.counts) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Retrieve InventoryPhysicalCount
    router.get("/square/inventory/physical-counts/:physicalCountId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.inventory.getPhysicalCount(req.params.physicalCountId);
            return res.json({
                count: result && result.result && result.result.count,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Retrieve InventoryTransfer
    router.get("/square/inventory/transfers/:transferId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.inventory.getTransfer(req.params.transferId);
            return res.json({
                transfer: result && result.result && result.result.transfer,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Retrieve InventoryCount for a catalog object
    router.get("/square/inventory/:catalogObjectId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const q = req.query || {};
        const locationIds = toStringArray(
            q.locationIds || q.location_ids || (typeof q.locationId === "string" ? [q.locationId] : [])
        );
        const cursor = q.cursor ? String(q.cursor) : undefined;

        try {
            const countPayload = {};
            if (locationIds.length > 0) countPayload.locationIds = locationIds;
            if (cursor) countPayload.cursor = cursor;
            const result = await client.inventory.get(req.params.catalogObjectId, countPayload);

            return res.json({
                counts: (result && result.result && result.result.counts) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = {
    createInventoryRouter,
};
