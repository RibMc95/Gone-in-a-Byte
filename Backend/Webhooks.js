const express = require("express");
const crypto = require("crypto");

const SUPPORTED_WEBHOOK_EVENTS = [
    "oauth.authorization.revoked",
    "payment.created",
    "payment.updated",
    "refund.created",
    "refund.updated",
    "online_checkout.location_settings.updated",
    "online_checkout.merchant_settings.updated",
    "order.created",
    "order.updated",
    "order.fulfillment.updated",
    "invoice.created",
    "invoice.updated",
    "invoice.deleted",
    "invoice.payment_made",
    "invoice.published",
    "invoice.canceled",
    "invoice.refunded",
    "invoice.scheduled_charge_failed",
    "card.automatically_updated",
    "card.created",
    "card.disabled",
    "card.forgotten",
    "card.updated",
    "bank_account.created",
    "bank_account.disabled",
    "bank_account.verified",
    "payout.failed",
    "payout.paid",
    "payout.sent",
    "dispute.created",
    "dispute.evidence.created",
    "dispute.evidence.deleted",
    "dispute.state.updated",
    "dispute.state.changed",
    "inventory.count.updated",
    "catalog.version.updated",
    "customer.created",
    "customer.deleted",
    "customer.updated",
    "customer.custom_attribute_definition.owned.created",
    "customer.custom_attribute_definition.owned.deleted",
    "customer.custom_attribute_definition.owned.updated",
    "customer.custom_attribute_definition.visible.created",
    "customer.custom_attribute_definition.visible.deleted",
    "customer.custom_attribute_definition.visible.updated",
    "customer.custom_attribute.owned.deleted",
    "customer.custom_attribute.owned.updated",
    "customer.custom_attribute.visible.deleted",
    "customer.custom_attribute.visible.updated",
    "order.custom_attribute_definition.owned.created",
    "order.custom_attribute_definition.owned.deleted",
    "order.custom_attribute_definition.owned.updated",
    "order.custom_attribute_definition.visible.created",
    "order.custom_attribute_definition.visible.deleted",
    "order.custom_attribute_definition.visible.updated",
    "order.custom_attribute.owned.deleted",
    "order.custom_attribute.owned.updated",
    "order.custom_attribute.visible.deleted",
    "order.custom_attribute.visible.updated",
];

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

    return "Unexpected webhook error";
}

function createIdempotencyKey() {
    if (crypto && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `idem_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

function verifyWebhookSignature(signatureHeader, rawBody, notificationUrl, signatureKey) {
    if (!signatureHeader || !rawBody || !notificationUrl || !signatureKey) {
        return false;
    }

    const payload = `${notificationUrl}${rawBody}`;
    const expectedSignature = crypto
        .createHmac("sha256", signatureKey)
        .update(payload, "utf8")
        .digest("base64");

    const provided = Buffer.from(String(signatureHeader), "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    if (provided.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(provided, expected);
}

function getWebhookSubscriptionsApi(client) {
    return client.webhooks ? client.webhooks.subscriptions : null;
}

async function callListWebhookEventTypes(webhookApi) {
    // In v42+ SDK, eventTypes is on the parent webhooks object, not subscriptions
    // This function is called with deps.webhookApi but we also need the parent
    // Use webhookApi._parent if set, otherwise try eventTypes directly
    if (typeof webhookApi.eventTypes === "function") {
        return webhookApi.eventTypes();
    }
    if (webhookApi._parent && typeof webhookApi._parent.eventTypes === "function") {
        return webhookApi._parent.eventTypes();
    }
    throw new Error("eventTypes is unavailable in current Square SDK");
}

async function callUpdateWebhookSubscriptionSignatureKey(webhookApi, subscriptionId) {
    return webhookApi.updateSignatureKey(subscriptionId);
}

function createWebhooksRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }

        const webhookApi = getWebhookSubscriptionsApi(client);
        if (!webhookApi) {
            res.status(503).json({ error: "Square Webhook Subscriptions API is unavailable in current SDK" });
            return null;
        }

        return { client, webhookApi };
    }

    // List events this backend is prepared to process.
    router.get("/square/webhooks/events/supported", (req, res) => {
        return res.json({
            events: SUPPORTED_WEBHOOK_EVENTS,
        });
    });

    // ListWebhookEventTypes
    router.get("/square/webhook-subscriptions/event-types", async (req, res) => {
        const deps = requireSquareConfig(res);
        if (!deps) return;

        try {
            const result = await deps.client.webhooks.eventTypes();
            return res.json({
                eventTypes: (result && result.result && result.result.eventTypes) || [],
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Generic webhook receiver for all configured subscriptions.
    router.post("/square/webhooks", (req, res) => {
        const signatureHeader = req.header("x-square-hmacsha256-signature");
        const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
        const notificationUrl =
            process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ||
            `${req.protocol}://${req.get("host")}${req.originalUrl}`;
        const rawBody =
            typeof req.rawBody === "string" && req.rawBody.length > 0
                ? req.rawBody
                : JSON.stringify(req.body || {});

        if (!signatureKey) {
            return res.status(503).json({
                error: "SQUARE_WEBHOOK_SIGNATURE_KEY is required to verify webhook signatures",
            });
        }

        const isValid = verifyWebhookSignature(signatureHeader, rawBody, notificationUrl, signatureKey);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid webhook signature" });
        }

        const eventType = req.body && req.body.type;
        const eventId = req.body && req.body.event_id;
        const eventData = (req.body && req.body.data) || {};
        const eventObject = eventData.object || {};

        if (!eventType) {
            return res.status(400).json({ error: "Webhook payload missing type" });
        }

        // Hook point: add idempotency storage and persistence for each handled event.
        let details = {};
        if (eventType === "payment.created" || eventType === "payment.updated") {
            details = {
                paymentId: eventObject.payment_id || eventObject.paymentId || eventObject.id,
                orderId: eventObject.order_id || eventObject.orderId,
                status: eventObject.status,
                amountMoney: eventObject.amount_money || eventObject.amountMoney,
            };
        } else if (eventType === "refund.created" || eventType === "refund.updated") {
            details = {
                refundId: eventObject.refund_id || eventObject.refundId || eventObject.id,
                paymentId: eventObject.payment_id || eventObject.paymentId,
                status: eventObject.status,
                amountMoney: eventObject.amount_money || eventObject.amountMoney,
            };
        } else if (eventType === "online_checkout.location_settings.updated") {
            details = {
                locationId: eventObject.location_id || eventObject.locationId,
                checkoutEnabled:
                    eventObject.online_checkout_enabled || eventObject.onlineCheckoutEnabled,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
            };
        } else if (eventType === "online_checkout.merchant_settings.updated") {
            details = {
                merchantId: eventObject.merchant_id || eventObject.merchantId,
                branding: eventObject.branding,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
            };
        } else if (eventType === "dispute.created" || eventType === "dispute.state.updated") {
            details = {
                disputeId: eventObject.dispute_id || eventObject.disputeId || eventObject.id,
                paymentId: eventObject.payment_id || eventObject.paymentId,
                amountMoney: eventObject.amount_money || eventObject.amountMoney,
                reason: eventObject.reason,
                state: eventObject.state,
                dueAt: eventObject.due_at || eventObject.dueAt,
            };
        } else if (
            eventType === "dispute.evidence.created" ||
            eventType === "dispute.evidence.deleted"
        ) {
            details = {
                disputeId: eventObject.dispute_id || eventObject.disputeId,
                evidenceId: eventObject.evidence_id || eventObject.evidenceId || eventObject.id,
                evidenceType: eventObject.evidence_type || eventObject.evidenceType,
                uploadedAt: eventObject.uploaded_at || eventObject.uploadedAt,
            };
        } else if (
            eventType === "invoice.created" ||
            eventType === "invoice.updated" ||
            eventType === "invoice.deleted" ||
            eventType === "invoice.payment_made" ||
            eventType === "invoice.published" ||
            eventType === "invoice.canceled" ||
            eventType === "invoice.refunded" ||
            eventType === "invoice.scheduled_charge_failed"
        ) {
            details = {
                invoiceId: eventObject.invoice_id || eventObject.invoiceId || eventObject.id,
                orderId: eventObject.order_id || eventObject.orderId,
                locationId: eventObject.location_id || eventObject.locationId,
                status: eventObject.status,
                primaryRecipient:
                    eventObject.primary_recipient || eventObject.primaryRecipient,
                paymentRequests: eventObject.payment_requests || eventObject.paymentRequests,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
            };
        } else if (
            eventType === "card.automatically_updated" ||
            eventType === "card.created" ||
            eventType === "card.disabled" ||
            eventType === "card.forgotten" ||
            eventType === "card.updated"
        ) {
            details = {
                cardId: eventObject.card_id || eventObject.cardId || eventObject.id,
                customerId: eventObject.customer_id || eventObject.customerId,
                merchantId: eventObject.merchant_id || eventObject.merchantId,
                enabled: eventObject.enabled,
                expMonth: eventObject.exp_month || eventObject.expMonth,
                expYear: eventObject.exp_year || eventObject.expYear,
                cardBrand: eventObject.card_brand || eventObject.cardBrand,
                last4: eventObject.last_4 || eventObject.last4,
                referenceId: eventObject.reference_id || eventObject.referenceId,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
            };
        } else if (
            eventType === "bank_account.created" ||
            eventType === "bank_account.disabled" ||
            eventType === "bank_account.verified"
        ) {
            details = {
                bankAccountId: eventObject.bank_account_id || eventObject.bankAccountId || eventObject.id,
                accountNumberSuffix: eventObject.account_number_suffix || eventObject.accountNumberSuffix,
                accountType: eventObject.account_type || eventObject.accountType,
                holderName: eventObject.holder_name || eventObject.holderName,
                country: eventObject.country,
                currency: eventObject.currency,
                status: eventObject.status,
                creditable: eventObject.creditable,
                debitable: eventObject.debitable,
                bankName: eventObject.bank_name || eventObject.bankName,
                customerId: eventObject.customer_id || eventObject.customerId,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
            };
        } else if (
            eventType === "payout.failed" ||
            eventType === "payout.paid" ||
            eventType === "payout.sent"
        ) {
            details = {
                payoutId: eventObject.payout_id || eventObject.payoutId || eventObject.id,
                locationId: eventObject.location_id || eventObject.locationId,
                status: eventObject.status,
                amount: eventObject.amount_money || eventObject.amount,
                arrivalDate: eventObject.arrival_date || eventObject.arrivalDate,
                payoutFee: eventObject.payout_fee || eventObject.payoutFee,
                bankAccountDetails: eventObject.bank_account_details || eventObject.bankAccountDetails,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
                createdAt: eventObject.created_at || eventObject.createdAt,
            };
        } else if (eventType === "catalog.version.updated") {
            details = {
                catalogVersion: eventObject.catalog_version || eventObject.catalogVersion,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
            };
        } else if (eventType === "inventory.count.updated") {
            details = {
                catalogObjectId: eventObject.catalog_object_id || eventObject.catalogObjectId,
                catalogObjectType: eventObject.catalog_object_type || eventObject.catalogObjectType,
                locationId: eventObject.location_id || eventObject.locationId,
                quantity: eventObject.quantity,
                state: eventObject.state,
                calculatedAt: eventObject.calculated_at || eventObject.calculatedAt,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
            };
        } else if (
            eventType === "customer.created" ||
            eventType === "customer.deleted" ||
            eventType === "customer.updated"
        ) {
            details = {
                customerId: eventObject.customer_id || eventObject.customerId || eventObject.id,
                createdAt: eventObject.created_at || eventObject.createdAt,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
                deleted: eventType === "customer.deleted",
                givenName: eventObject.given_name || eventObject.givenName,
                familyName: eventObject.family_name || eventObject.familyName,
                email: eventObject.email_address || eventObject.emailAddress,
                phone: eventObject.phone_number || eventObject.phoneNumber,
                referenceId: eventObject.reference_id || eventObject.referenceId,
                note: eventObject.note,
                preferences: eventObject.preferences,
            };
        } else if (eventType.startsWith("customer.custom_attribute_definition.")) {
            details = {
                key: eventObject.key,
                name: eventObject.name,
                description: eventObject.description,
                visibility: eventObject.visibility,
                version: eventObject.version,
                createdAt: eventObject.created_at || eventObject.createdAt,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
            };
        } else if (eventType.startsWith("customer.custom_attribute.")) {
            details = {
                customerId: eventObject.customer_id || eventObject.customerId,
                key: eventObject.key,
                value: eventObject.value,
                version: eventObject.version,
                updatedAt: eventObject.updated_at || eventObject.updatedAt,
                deleted: eventType.endsWith(".deleted"),
            };
        } else if (eventType.startsWith("order.custom_attribute_definition.")) {
            const definition =
                eventObject.custom_attribute_definition ||
                eventObject.customAttributeDefinition ||
                eventObject;

            details = {
                key: definition.key,
                name: definition.name,
                description: definition.description,
                visibility: definition.visibility,
                version: definition.version,
                schema: definition.schema,
                createdAt: definition.created_at || definition.createdAt,
                updatedAt: definition.updated_at || definition.updatedAt,
            };
        } else if (eventType.startsWith("order.custom_attribute.")) {
            const customAttribute =
                eventObject.custom_attribute ||
                eventObject.customAttribute ||
                eventObject;

            details = {
                orderId: customAttribute.order_id || customAttribute.orderId,
                key: customAttribute.key,
                value: customAttribute.value,
                version: customAttribute.version,
                visibility: customAttribute.visibility,
                createdAt: customAttribute.created_at || customAttribute.createdAt,
                updatedAt: customAttribute.updated_at || customAttribute.updatedAt,
                deleted: eventType.endsWith(".deleted"),
            };
        }

        const handled = SUPPORTED_WEBHOOK_EVENTS.includes(eventType);
        return res.status(200).json({
            received: true,
            handled,
            eventType,
            eventId,
            details,
        });
    });

    // Create webhook subscription.
    router.post("/square/webhook-subscriptions", async (req, res) => {
        const deps = requireSquareConfig(res);
        if (!deps) return;

        const body = req.body || {};
        const subscription = body.subscription;
        if (!subscription || typeof subscription !== "object") {
            return res.status(400).json({ error: "subscription object is required" });
        }

        const payload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            subscription,
        };

        try {
            const result = await deps.webhookApi.create(payload);
            return res.status(201).json({
                subscription: result && result.result && result.result.subscription,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // List webhook subscriptions.
    router.get("/square/webhook-subscriptions", async (req, res) => {
        const deps = requireSquareConfig(res);
        if (!deps) return;

        const q = req.query || {};
        const cursor = q.cursor ? String(q.cursor) : undefined;
        const limitRaw = q.limit;
        const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
        const includeDisabled =
            q.includeDisabled === "true" || q.include_disabled === "true" || q.includeDisabled === true;

        try {
            const listParams = {};
            if (cursor) listParams.cursor = cursor;
            if (Number.isFinite(limit)) listParams.limit = limit;
            if (includeDisabled) listParams.includeDisabled = includeDisabled;
            const result = await deps.webhookApi.list(listParams);
            return res.json({
                subscriptions: (result && result.result && result.result.subscriptions) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Retrieve a webhook subscription.
    router.get("/square/webhook-subscriptions/:subscriptionId", async (req, res) => {
        const deps = requireSquareConfig(res);
        if (!deps) return;

        try {
            const result = await deps.webhookApi.get(req.params.subscriptionId);
            return res.json({
                subscription: result && result.result && result.result.subscription,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Update a webhook subscription.
    router.put("/square/webhook-subscriptions/:subscriptionId", async (req, res) => {
        const deps = requireSquareConfig(res);
        if (!deps) return;

        const body = req.body || {};
        const subscription = body.subscription;
        if (!subscription || typeof subscription !== "object") {
            return res.status(400).json({ error: "subscription object is required" });
        }

        const payload = {
            subscription,
            fieldsToClear: Array.isArray(body.fieldsToClear || body.fields_to_clear)
                ? (body.fieldsToClear || body.fields_to_clear)
                : undefined,
        };

        try {
            const result = await deps.webhookApi.update(req.params.subscriptionId, payload);
            return res.json({
                subscription: result && result.result && result.result.subscription,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Delete a webhook subscription.
    router.delete("/square/webhook-subscriptions/:subscriptionId", async (req, res) => {
        const deps = requireSquareConfig(res);
        if (!deps) return;

        try {
            await deps.webhookApi.delete(req.params.subscriptionId);
            return res.json({ deleted: true, subscriptionId: req.params.subscriptionId });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Send a test event from a webhook subscription.
    router.post("/square/webhook-subscriptions/:subscriptionId/test", async (req, res) => {
        const deps = requireSquareConfig(res);
        if (!deps) return;

        try {
            const result = await deps.webhookApi.test(req.params.subscriptionId);
            return res.json(result && result.result ? result.result : { sent: true });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // UpdateWebhookSubscriptionSignatureKey
    router.post("/square/webhook-subscriptions/:subscriptionId/signature-key", async (req, res) => {
        const deps = requireSquareConfig(res);
        if (!deps) return;

        try {
            const result = await callUpdateWebhookSubscriptionSignatureKey(
                deps.webhookApi,
                req.params.subscriptionId
            );
            return res.json({
                subscription: result && result.result && result.result.subscription,
                signatureKey: result && result.result && result.result.signatureKey,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = {
    createWebhooksRouter,
};
