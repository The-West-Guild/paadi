import { z } from "zod";
import { OUTBOUND_EVENT_TYPES } from "../events";

export const outboundEventTypeSchema = z.enum(OUTBOUND_EVENT_TYPES);

export const registerWebhookEndpointSchema = z.object({
  url: z.string().url(),
  events: z.array(outboundEventTypeSchema).min(1),
  description: z.string().max(280).optional()
});

export const webhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  events: z.array(z.string()),
  description: z.string().nullable(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const webhookEndpointCreatedSchema = webhookEndpointSchema.extend({
  secret: z.string()
});

export const webhookEndpointsResponseSchema = z.object({
  endpoints: z.array(webhookEndpointSchema)
});

export const webhookEndpointParamsSchema = z.object({
  id: z.string()
});

export const webhookDeliverySchema = z.object({
  id: z.string(),
  endpointId: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  status: z.enum(["PENDING", "DELIVERED", "FAILED", "DEAD"]),
  attempts: z.number(),
  nextAttemptAt: z.string().nullable(),
  lastResponseCode: z.number().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const webhookDeliveriesResponseSchema = z.object({
  deliveries: z.array(webhookDeliverySchema)
});

export const apiErrorSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.union([z.string(), z.array(z.string())])
});

export type RegisterWebhookEndpointInput = z.infer<
  typeof registerWebhookEndpointSchema
>;
export type WebhookEndpointDto = z.infer<typeof webhookEndpointSchema>;
export type WebhookEndpointCreatedDto = z.infer<
  typeof webhookEndpointCreatedSchema
>;
export type WebhookEndpointsResponse = z.infer<
  typeof webhookEndpointsResponseSchema
>;
export type WebhookEndpointParams = z.infer<typeof webhookEndpointParamsSchema>;
export type WebhookDeliveryDto = z.infer<typeof webhookDeliverySchema>;
export type WebhookDeliveriesResponse = z.infer<
  typeof webhookDeliveriesResponseSchema
>;
export type ApiError = z.infer<typeof apiErrorSchema>;
