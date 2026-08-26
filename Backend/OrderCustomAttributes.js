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
            return { error: "SQUARE_ACCESS_TOKEN is not set on the backend." };
        }

        return { client: new Client({ accessToken, environment }) };
    } catch (error) {
        return { error: "Square SDK is not installed. Run npm install square in Backend." };
    }
}

function normalizeSquareError(error) {
    const fromSdk = error && error.result && error.result.errors;
    if (Array.isArray(fromSdk) && fromSdk.length > 0) {
        return fromSdk.map((e) => e.detail || e.code || "Square API error").join("; ");
    }
    if (error && error.message) return error.message;
    return "Unexpected order custom attributes error";
}

function createOrderCustomAttributesRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }
        return client;
    }

    // ListOrderCustomAttributeDefinitions
    router.get("/square/orders/custom-attribute-definitions", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const q = req.query || {};
        const visibilityFilter = q.visibilityFilter || q.visibility_filter || undefined;
        const cursor = q.cursor || undefined;
        const limit = q.limit !== undefined ? Number(q.limit) : undefined;

        try {
            const result = await client.orders.customAttributeDefinitions.list(
                visibilityFilter,
                cursor,
                Number.isFinite(limit) ? limit : undefined
            );
            return res.json({
                customAttributeDefinitions:
                    (result && result.result && result.result.customAttributeDefinitions) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // CreateOrderCustomAttributeDefinition
    router.post("/square/orders/custom-attribute-definitions", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.orders.customAttributeDefinitions.create(
                req.body || {}
            );
            return res.status(201).json({
                customAttributeDefinition:
                    result && result.result && result.result.customAttributeDefinition,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // RetrieveOrderCustomAttributeDefinition
    router.get("/square/orders/custom-attribute-definitions/:key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.orders.customAttributeDefinitions.get(
                req.params.key
            );
            return res.json({
                customAttributeDefinition:
                    result && result.result && result.result.customAttributeDefinition,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // UpdateOrderCustomAttributeDefinition
    router.put("/square/orders/custom-attribute-definitions/:key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.orders.customAttributeDefinitions.update(
                req.params.key,
                req.body || {}
            );
            return res.json({
                customAttributeDefinition:
                    result && result.result && result.result.customAttributeDefinition,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // DeleteOrderCustomAttributeDefinition
    router.delete("/square/orders/custom-attribute-definitions/:key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            await client.orders.customAttributeDefinitions.delete(req.params.key);
            return res.json({ deleted: true, key: req.params.key });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BulkDeleteOrderCustomAttributes
    router.post("/square/orders/custom-attributes/bulk-delete", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.orders.customAttributes.batchDelete(
                req.body || {}
            );
            return res.json({
                values: result && result.result && result.result.values,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BulkUpsertOrderCustomAttributes
    router.post("/square/orders/custom-attributes/bulk-upsert", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.orders.customAttributes.batchUpsert(
                req.body || {}
            );
            return res.json({
                values: result && result.result && result.result.values,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // ListOrderCustomAttributes
    router.get("/square/orders/:orderId/custom-attributes", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const q = req.query || {};
        const visibilityFilter = q.visibilityFilter || q.visibility_filter || undefined;
        const cursor = q.cursor || undefined;
        const limit = q.limit !== undefined ? Number(q.limit) : undefined;
        const withDefinitions =
            q.withDefinitions !== undefined ? q.withDefinitions === "true" || q.withDefinitions === true : undefined;
        const withDefinitionsAlt =
            q.with_definitions !== undefined ? q.with_definitions === "true" || q.with_definitions === true : undefined;
        const selectedWithDefinitions =
            withDefinitions !== undefined ? withDefinitions : withDefinitionsAlt;

        try {
            const result = await client.orders.customAttributes.list(
                req.params.orderId,
                visibilityFilter,
                cursor,
                Number.isFinite(limit) ? limit : undefined,
                selectedWithDefinitions
            );
            return res.json({
                customAttributes: (result && result.result && result.result.customAttributes) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // RetrieveOrderCustomAttribute
    router.get(
        "/square/orders/:orderId/custom-attributes/:customAttributeKey",
        async (req, res) => {
            const client = requireSquareConfig(res);
            if (!client) return;

            try {
                const result = await client.orders.customAttributes.get(
                    req.params.orderId,
                    req.params.customAttributeKey
                );
                return res.json({
                    customAttribute: result && result.result && result.result.customAttribute,
                });
            } catch (squareError) {
                return res.status(502).json({ error: normalizeSquareError(squareError) });
            }
        }
    );

    // UpsertOrderCustomAttribute
    router.post(
        "/square/orders/:orderId/custom-attributes/:customAttributeKey",
        async (req, res) => {
            const client = requireSquareConfig(res);
            if (!client) return;

            try {
                const result = await client.orders.customAttributes.upsert(
                    req.params.orderId,
                    req.params.customAttributeKey,
                    req.body || {}
                );
                return res.json({
                    customAttribute: result && result.result && result.result.customAttribute,
                });
            } catch (squareError) {
                return res.status(502).json({ error: normalizeSquareError(squareError) });
            }
        }
    );

    // DeleteOrderCustomAttribute
    router.delete(
        "/square/orders/:orderId/custom-attributes/:customAttributeKey",
        async (req, res) => {
            const client = requireSquareConfig(res);
            if (!client) return;

            try {
                await client.orders.customAttributes.delete(
                    req.params.orderId,
                    req.params.customAttributeKey
                );
                return res.json({
                    deleted: true,
                    orderId: req.params.orderId,
                    customAttributeKey: req.params.customAttributeKey,
                });
            } catch (squareError) {
                return res.status(502).json({ error: normalizeSquareError(squareError) });
            }
        }
    );

    return router;
}

module.exports = {
    createOrderCustomAttributesRouter,
};
