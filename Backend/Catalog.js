const express = require("express");
const crypto = require("crypto");

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

        const client = new Client({
            accessToken,
            token: accessToken,
            environment,
        });

        return { client };
    } catch (error) {
        return {
            error: "Square SDK is not installed. Run npm install square in Backend.",
        };
    }
}

function createIdempotencyKey() {
    if (crypto && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `idem_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

function normalizeSquareError(error) {
    const fromSdk = error && error.result && error.result.errors;
    if (Array.isArray(fromSdk) && fromSdk.length > 0) {
        return fromSdk.map((entry) => entry.detail || entry.code || "Square API error").join("; ");
    }

    if (error && error.message) {
        return error.message;
    }

    return "Unexpected catalog error";
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

function toNodeFileWrapper(filePayload) {
    if (!filePayload || typeof filePayload !== "object") {
        return null;
    }

    const contentBase64 = String(filePayload.contentBase64 || "").trim();
    if (!contentBase64) {
        return null;
    }

    return {
        data: Buffer.from(contentBase64, "base64"),
        fileName: filePayload.fileName || filePayload.filename || "catalog-image",
        contentType: filePayload.contentType || filePayload.content_type || "image/jpeg",
    };
}

function createCatalogRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }

        return client;
    }

    // Catalog info
    router.get("/square/catalog/info", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.catalog.info();
            return res.json(result && result.result ? result.result : {});
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // List catalog
    router.get("/square/catalog/list", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const q = req.query || {};
        const payload = {};
        if (q.cursor) payload.cursor = String(q.cursor);
        if (q.types) payload.types = String(q.types);
        if (q.catalogVersion || q.catalog_version) {
            const parsed = Number(q.catalogVersion || q.catalog_version);
            if (Number.isFinite(parsed)) payload.catalogVersion = parsed;
        }

        try {
            const result = await client.catalog.list(payload);
            return res.json({
                objects: (result && result.result && result.result.objects) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Batch delete catalog objects
    router.post("/square/catalog/batch-delete", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const objectIds = toStringArray(req.body && (req.body.objectIds || req.body.object_ids));
        if (objectIds.length === 0) {
            return res.status(400).json({ error: "objectIds is required and must be a non-empty array" });
        }

        try {
            const result = await client.catalog.batchDelete({ objectIds });
            return res.json({
                deletedObjectIds: result && result.result && result.result.deletedObjectIds,
                deletedAt: result && result.result && result.result.deletedAt,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Batch retrieve catalog objects
    router.post("/square/catalog/batch-retrieve", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const objectIds = toStringArray(body.objectIds || body.object_ids);
        if (objectIds.length === 0) {
            return res.status(400).json({ error: "objectIds is required and must be a non-empty array" });
        }

        const payload = { objectIds };
        const includeRelated = parseBool(body.includeRelatedObjects ?? body.include_related_objects);
        if (includeRelated !== undefined) payload.includeRelatedObjects = includeRelated;

        if (body.catalogVersion !== undefined || body.catalog_version !== undefined) {
            const parsed = Number(body.catalogVersion ?? body.catalog_version);
            if (Number.isFinite(parsed)) payload.catalogVersion = parsed;
        }

        const includeDeleted = parseBool(body.includeDeletedObjects ?? body.include_deleted_objects);
        if (includeDeleted !== undefined) payload.includeDeletedObjects = includeDeleted;

        const includePathToRoot = parseBool(body.includeCategoryPathToRoot ?? body.include_category_path_to_root);
        if (includePathToRoot !== undefined) payload.includeCategoryPathToRoot = includePathToRoot;

        try {
            const result = await client.catalog.batchGet(payload);
            return res.json({
                objects: (result && result.result && result.result.objects) || [],
                relatedObjects: (result && result.result && result.result.relatedObjects) || [],
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Batch upsert catalog objects
    router.post("/square/catalog/batch-upsert", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const batches = Array.isArray(body.batches) ? body.batches : [];
        if (batches.length === 0) {
            return res.status(400).json({ error: "batches is required and must be a non-empty array" });
        }

        const payload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            batches,
        };

        try {
            const result = await client.catalog.batchUpsert(payload);
            return res.status(201).json({
                objects: (result && result.result && result.result.objects) || [],
                idMappings: (result && result.result && result.result.idMappings) || [],
                updatedAt: result && result.result && result.result.updatedAt,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Create catalog image
    router.post("/square/catalog/images", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const requestPayload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            objectId: body.objectId || body.object_id,
            image: body.image,
            isPrimary: body.isPrimary ?? body.is_primary,
        };

        if (!requestPayload.image || typeof requestPayload.image !== "object") {
            return res.status(400).json({ error: "image object is required" });
        }

        const fileWrapper = toNodeFileWrapper(body.file);
        if (!fileWrapper) {
            return res.status(400).json({
                error: "file.contentBase64 is required for image upload",
            });
        }

        try {
            let result;
            result = await client.catalog.images.create(requestPayload, fileWrapper);

            return res.status(201).json({
                image: result && result.result && result.result.image,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Update catalog image
    router.put("/square/catalog/images/:imageId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const requestPayload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            objectId: body.objectId || body.object_id,
            image: body.image,
        };

        const fileWrapper = toNodeFileWrapper(body.file);
        if (!fileWrapper) {
            return res.status(400).json({ error: "file.contentBase64 is required for image upload" });
        }

        try {
            let result;
            result = await client.catalog.images.update(req.params.imageId, requestPayload, fileWrapper);

            return res.json({
                image: result && result.result && result.result.image,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Upsert catalog object
    router.post("/square/catalog/object", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const object = body.object;
        if (!object || typeof object !== "object") {
            return res.status(400).json({ error: "object is required" });
        }

        const payload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            object,
        };

        try {
            const result = await client.catalog.object.upsert(payload);
            return res.status(201).json({
                catalogObject: result && result.result && result.result.catalogObject,
                idMappings: result && result.result && result.result.idMappings,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Delete catalog object
    router.delete("/square/catalog/object/:objectId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.catalog.object.delete(req.params.objectId);
            return res.json({
                deletedObjectIds: result && result.result && result.result.deletedObjectIds,
                deletedAt: result && result.result && result.result.deletedAt,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Retrieve catalog object
    router.get("/square/catalog/object/:objectId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const q = req.query || {};
        const includeRelatedObjects = parseBool(q.includeRelatedObjects ?? q.include_related_objects);
        const includeCategoryPathToRoot = parseBool(q.includeCategoryPathToRoot ?? q.include_category_path_to_root);

        let catalogVersion;
        if (q.catalogVersion !== undefined || q.catalog_version !== undefined) {
            const parsed = Number(q.catalogVersion ?? q.catalog_version);
            if (Number.isFinite(parsed)) catalogVersion = parsed;
        }

        try {
            const result = await client.catalog.object.get(
                req.params.objectId,
                includeRelatedObjects,
                catalogVersion,
                includeCategoryPathToRoot
            );
            return res.json({
                object: result && result.result && result.result.object,
                relatedObjects: result && result.result && result.result.relatedObjects,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Search catalog objects
    router.post("/square/catalog/search", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const payload = {
            cursor: body.cursor,
            objectTypes: body.objectTypes || body.object_types,
            includeDeletedObjects: body.includeDeletedObjects ?? body.include_deleted_objects,
            includeRelatedObjects: body.includeRelatedObjects ?? body.include_related_objects,
            beginTime: body.beginTime || body.begin_time,
            query: body.query,
            limit: body.limit,
            includeCategoryPathToRoot: body.includeCategoryPathToRoot ?? body.include_category_path_to_root,
        };

        try {
            const result = await client.catalog.search(payload);
            return res.json({
                objects: (result && result.result && result.result.objects) || [],
                relatedObjects: (result && result.result && result.result.relatedObjects) || [],
                cursor: result && result.result && result.result.cursor,
                latestTime: result && result.result && result.result.latestTime,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Search catalog items
    router.post("/square/catalog/search-catalog-items", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const payload = {
            textFilter: body.textFilter || body.text_filter,
            categoryIds: body.categoryIds || body.category_ids,
            stockLevels: body.stockLevels || body.stock_levels,
            enabledLocationIds: body.enabledLocationIds || body.enabled_location_ids,
            cursor: body.cursor,
            limit: body.limit,
            sortOrder: body.sortOrder || body.sort_order,
            productTypes: body.productTypes || body.product_types,
            customAttributeFilters: body.customAttributeFilters || body.custom_attribute_filters,
            archivedState: body.archivedState || body.archived_state,
        };

        try {
            const result = await client.catalog.searchItems(payload);
            return res.json({
                items: (result && result.result && result.result.items) || [],
                matchedVariationIds: (result && result.result && result.result.matchedVariationIds) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Update item modifier lists
    router.post("/square/catalog/update-item-modifier-lists", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const payload = {
            itemIds: body.itemIds || body.item_ids,
            modifierListsToEnable: body.modifierListsToEnable || body.modifier_lists_to_enable,
            modifierListsToDisable: body.modifierListsToDisable || body.modifier_lists_to_disable,
        };

        if (!Array.isArray(payload.itemIds) || payload.itemIds.length === 0) {
            return res.status(400).json({ error: "itemIds is required and must be a non-empty array" });
        }
        if (
            (!Array.isArray(payload.modifierListsToEnable) || payload.modifierListsToEnable.length === 0) &&
            (!Array.isArray(payload.modifierListsToDisable) || payload.modifierListsToDisable.length === 0)
        ) {
            return res.status(400).json({ error: "At least one of modifierListsToEnable or modifierListsToDisable is required" });
        }

        try {
            const result = await client.catalog.updateItemModifierLists(payload);
            return res.json({ updatedAt: result && result.result && result.result.updatedAt });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Update item taxes
    router.post("/square/catalog/update-item-taxes", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const payload = {
            itemIds: body.itemIds || body.item_ids,
            taxesToEnable: body.taxesToEnable || body.taxes_to_enable,
            taxesToDisable: body.taxesToDisable || body.taxes_to_disable,
        };

        if (!Array.isArray(payload.itemIds) || payload.itemIds.length === 0) {
            return res.status(400).json({ error: "itemIds is required and must be a non-empty array" });
        }
        if (
            (!Array.isArray(payload.taxesToEnable) || payload.taxesToEnable.length === 0) &&
            (!Array.isArray(payload.taxesToDisable) || payload.taxesToDisable.length === 0)
        ) {
            return res.status(400).json({ error: "At least one of taxesToEnable or taxesToDisable is required" });
        }

        try {
            const result = await client.catalog.updateItemTaxes(payload);
            return res.json({ updatedAt: result && result.result && result.result.updatedAt });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = {
    createCatalogRouter,
};
