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

    return "Unexpected invoice error";
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
        fileName: filePayload.fileName || filePayload.filename || "invoice-attachment",
        contentType: filePayload.contentType || filePayload.content_type || "application/octet-stream",
    };
}

function createInvoiceRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }

        return client;
    }

    // ListInvoices
    router.get("/square/invoices", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const q = req.query || {};
        const locationId = (q.locationId || q.location_id || process.env.SQUARE_LOCATION_ID || "").toString().trim();
        if (!locationId) {
            return res.status(400).json({
                error: "locationId is required (or set SQUARE_LOCATION_ID)",
            });
        }

        const cursor = q.cursor ? String(q.cursor) : undefined;
        const limit = q.limit !== undefined ? Number(q.limit) : undefined;

        try {
            const result = await client.invoices.list(
                locationId,
                cursor,
                Number.isFinite(limit) ? limit : undefined
            );

            return res.json({
                invoices: (result && result.result && result.result.invoices) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // CreateInvoice
    router.post("/square/invoices", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const invoice = body.invoice;
        if (!invoice || typeof invoice !== "object") {
            return res.status(400).json({ error: "invoice object is required" });
        }

        const payload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            invoice,
        };

        try {
            const result = await client.invoices.create(payload);
            return res.status(201).json({
                invoice: result && result.result && result.result.invoice,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // SearchInvoices
    router.post("/square/invoices/search", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.invoices.search(req.body || {});
            return res.json({
                invoices: (result && result.result && result.result.invoices) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // GetInvoice
    router.get("/square/invoices/:invoiceId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.invoices.get(req.params.invoiceId);
            return res.json({
                invoice: result && result.result && result.result.invoice,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // UpdateInvoice
    router.put("/square/invoices/:invoiceId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const invoice = body.invoice;
        if (!invoice || typeof invoice !== "object") {
            return res.status(400).json({ error: "invoice object is required" });
        }

        const payload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            invoice,
            fieldsToClear: Array.isArray(body.fieldsToClear || body.fields_to_clear)
                ? (body.fieldsToClear || body.fields_to_clear)
                : undefined,
        };

        try {
            const result = await client.invoices.update(req.params.invoiceId, payload);
            return res.json({
                invoice: result && result.result && result.result.invoice,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // DeleteInvoice
    router.delete("/square/invoices/:invoiceId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const versionRaw = body.version ?? req.query.version;
        const version = versionRaw !== undefined ? Number(versionRaw) : undefined;
        if (!Number.isFinite(version)) {
            return res.status(400).json({ error: "version is required (body.version or query ?version=)" });
        }

        try {
            const result = await client.invoices.delete(req.params.invoiceId, version);
            return res.json({
                invoice: result && result.result && result.result.invoice,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // CreateInvoiceAttachment
    router.post("/square/invoices/:invoiceId/attachments", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const body = req.body || {};
        const requestPayload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            description: body.description,
            fileName: body.fileName || body.file_name,
        };

        const fileWrapper = toNodeFileWrapper(body.file);
        if (!fileWrapper) {
            return res.status(400).json({
                error: "file.contentBase64 is required for attachment upload",
            });
        }

        try {
            let result;
            try {
                result = await client.invoices.createInvoiceAttachment(
                    req.params.invoiceId,
                    requestPayload,
                    fileWrapper
                );
            } catch (firstError) {
                result = await client.invoices.createInvoiceAttachment(req.params.invoiceId, {
                    ...requestPayload,
                    file: fileWrapper,
                });
            }

            return res.status(201).json({
                attachment: result && result.result && result.result.attachment,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // DeleteInvoiceAttachment
    router.delete("/square/invoices/:invoiceId/attachments/:attachmentId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.invoices.deleteInvoiceAttachment(
                req.params.invoiceId,
                req.params.attachmentId
            );
            return res.json({
                success: true,
                attachment: result && result.result && result.result.attachment,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // CancelInvoice
    router.post("/square/invoices/:invoiceId/cancel", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.invoices.cancel(req.params.invoiceId, req.body || {});
            return res.json({
                invoice: result && result.result && result.result.invoice,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // PublishInvoice
    router.post("/square/invoices/:invoiceId/publish", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.invoices.publish(req.params.invoiceId, req.body || {});
            return res.json({
                invoice: result && result.result && result.result.invoice,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = {
    createInvoiceRouter,
};
