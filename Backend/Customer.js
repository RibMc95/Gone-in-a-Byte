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
    return "Unexpected customer error";
}

function createCustomerRouter() {
    const router = express.Router();
    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }
        return client;
    }

    // ListCustomers
    router.get("/square/customers", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        const q = req.query || {};
        const cursor = q.cursor || undefined;
        const sortField = q.sortField || q.sort_field || undefined;
        const sortOrder = q.sortOrder || q.sort_order || undefined;
        try {
            const listPayload = {};
            if (cursor) listPayload.cursor = cursor;
            if (sortField) listPayload.sortField = sortField;
            if (sortOrder) listPayload.sortOrder = sortOrder;
            const result = await client.customers.list(listPayload);
            return res.json({
                customers: (result && result.result && result.result.customers) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // CreateCustomer
    router.post("/square/customers", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.create(req.body || {});
            return res.status(201).json({
                customer: result && result.result && result.result.customer,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BulkCreateCustomers
    router.post("/square/customers/bulk-create", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.batchCreate(req.body || {});
            return res.status(201).json({
                customers: result && result.result && result.result.customers,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BulkDeleteCustomers
    router.post("/square/customers/bulk-delete", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.bulkDeleteCustomers(req.body || {});
            return res.json({
                deletedCustomerIds: result && result.result && result.result.deletedCustomerIds,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BulkRetrieveCustomers
    router.post("/square/customers/bulk-retrieve", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.bulkRetrieveCustomers(req.body || {});
            return res.json({
                customers: result && result.result && result.result.customers,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BulkUpdateCustomers
    router.post("/square/customers/bulk-update", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.bulkUpdateCustomers(req.body || {});
            return res.json({
                customers: result && result.result && result.result.customers,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // SearchCustomers
    router.post("/square/customers/search", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.search(req.body || {});
            return res.json({
                customers: result && result.result && result.result.customers,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // DeleteCustomer
    router.delete("/square/customers/:customerId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.delete(req.params.customerId);
            return res.json({
                deleted: true,
                customerId: req.params.customerId,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // RetrieveCustomer
    router.get("/square/customers/:customerId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.get(req.params.customerId);
            return res.json({
                customer: result && result.result && result.result.customer,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // UpdateCustomer
    router.put("/square/customers/:customerId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.update(req.params.customerId, req.body || {});
            return res.json({
                customer: result && result.result && result.result.customer,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // RemoveGroupFromCustomer
    router.post("/square/customers/:customerId/groups/:groupId/remove", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.groups.remove(req.params.customerId, req.params.groupId);
            return res.json({
                customer: result && result.result && result.result.customer,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // AddGroupToCustomer
    router.post("/square/customers/:customerId/groups/:groupId/add", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customers.groups.add(req.params.customerId, req.params.groupId);
            return res.json({
                customer: result && result.result && result.result.customer,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // ListCustomerCustomAttributeDefinitions
    router.get("/square/customers/custom-attribute-definitions", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        const q = req.query || {};
        const visibilityFilter = q.visibilityFilter || q.visibility_filter || undefined;
        const limit = q.limit !== undefined ? Number(q.limit) : undefined;
        const cursor = q.cursor || undefined;
        try {
            const result = await client.customerCustomAttributesApi.listCustomerCustomAttributeDefinitions(visibilityFilter, limit, cursor);
            return res.json({
                definitions: (result && result.result && result.result.customAttributeDefinitions) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // CreateCustomerCustomAttributeDefinition
    router.post("/square/customers/custom-attribute-definitions", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customerCustomAttributesApi.createCustomerCustomAttributeDefinition(req.body || {});
            return res.status(201).json({
                definition: result && result.result && result.result.customAttributeDefinition,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // DeleteCustomerCustomAttributeDefinition
    router.delete("/square/customers/custom-attribute-definitions/:key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            await client.customerCustomAttributesApi.deleteCustomerCustomAttributeDefinition(req.params.key);
            return res.json({ deleted: true, key: req.params.key });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // RetrieveCustomerCustomAttributeDefinition
    router.get("/square/customers/custom-attribute-definitions/:key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customerCustomAttributesApi.retrieveCustomerCustomAttributeDefinition(req.params.key);
            return res.json({
                definition: result && result.result && result.result.customAttributeDefinition,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // UpdateCustomerCustomAttributeDefinition
    router.put("/square/customers/custom-attribute-definitions/:key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customerCustomAttributesApi.updateCustomerCustomAttributeDefinition(req.params.key, req.body || {});
            return res.json({
                definition: result && result.result && result.result.customAttributeDefinition,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // BulkUpsertCustomerCustomAttributes
    router.post("/square/customers/custom-attributes/bulk-upsert", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customerCustomAttributesApi.bulkUpsertCustomerCustomAttributes(req.body || {});
            return res.json({
                values: result && result.result && result.result.values,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // ListCustomerCustomAttributes
    router.get("/square/customers/:customerId/custom-attributes", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        const q = req.query || {};
        const visibilityFilter = q.visibilityFilter || q.visibility_filter || undefined;
        const limit = q.limit !== undefined ? Number(q.limit) : undefined;
        const cursor = q.cursor || undefined;
        try {
            const result = await client.customerCustomAttributesApi.listCustomerCustomAttributes(req.params.customerId, visibilityFilter, limit, cursor);
            return res.json({
                customAttributes: (result && result.result && result.result.customAttributes) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // DeleteCustomerCustomAttribute
    router.delete("/square/customers/:customerId/custom-attributes/:key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            await client.customerCustomAttributesApi.deleteCustomerCustomAttribute(req.params.customerId, req.params.key);
            return res.json({ deleted: true, customerId: req.params.customerId, key: req.params.key });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // RetrieveCustomerCustomAttribute
    router.get("/square/customers/:customerId/custom-attributes/:key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customerCustomAttributesApi.retrieveCustomerCustomAttribute(req.params.customerId, req.params.key);
            return res.json({
                customAttribute: result && result.result && result.result.customAttribute,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // UpsertCustomerCustomAttribute
    router.put("/square/customers/:customerId/custom-attributes/:key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customerCustomAttributesApi.upsertCustomerCustomAttribute(req.params.customerId, req.params.key, req.body || {});
            return res.json({
                customAttribute: result && result.result && result.result.customAttribute,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // ListCustomerGroups
    router.get("/square/customers/groups", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        const q = req.query || {};
        const cursor = q.cursor || undefined;
        try {
            const result = await client.customerGroupsApi.listCustomerGroups(cursor);
            return res.json({
                groups: (result && result.result && result.result.groups) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // CreateCustomerGroup
    router.post("/square/customers/groups", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customerGroupsApi.createCustomerGroup(req.body || {});
            return res.status(201).json({
                group: result && result.result && result.result.group,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // RetrieveCustomerGroup
    router.get("/square/customers/groups/:groupId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customerGroupsApi.retrieveCustomerGroup(req.params.groupId);
            return res.json({
                group: result && result.result && result.result.group,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // UpdateCustomerGroup
    router.put("/square/customers/groups/:groupId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;
        try {
            const result = await client.customerGroupsApi.updateCustomerGroup(req.params.groupId, req.body || {});
            return res.json({
                group: result && result.result && result.result.group,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = { createCustomerRouter };
