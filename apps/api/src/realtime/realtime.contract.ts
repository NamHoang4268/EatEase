import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const audienceSchema = z.enum(['kitchen', 'activation', 'sessions', 'bill']);
export type Audience = z.infer<typeof audienceSchema>;
export type Subscription = {
  actorType: 'STAFF' | 'GUEST';
  actorSessionId: string;
  restaurantId: string;
  locationId: string;
  audience: Audience;
  resourceId: string | null;
  origin: string;
};
export const permissionFor: Record<Audience, string> = {
  kitchen: 'fulfillment.read',
  activation: 'table.activation.read',
  sessions: 'table.session.read',
  bill: 'bill.read',
};
export function ticketBody(value: unknown) {
  const result = z
    .object({ audience: audienceSchema, tableSessionId: z.uuid().optional() })
    .strict()
    .safeParse(value);
  if (!result.success) throw new BadRequestException({ code: 'REALTIME_REQUEST_INVALID' });
  return result.data;
}

const payloadSchema = z.object({
  id: z.uuid(),
  version: z.number().int().nonnegative(),
  tableSessionId: z.uuid().optional(),
  tableId: z.uuid().optional(),
});
export function notification(event: { id: string; eventType: string; payload: unknown }) {
  const types = [
    'order.submitted',
    'fulfillment.item.created',
    'fulfillment.item.updated',
    'cancellation.updated',
    'bill.updated',
    'activation.requested',
    'activation.updated',
    'table.session.updated',
  ];
  if (!types.includes(event.eventType)) throw new Error('OUTBOX_EVENT_UNSUPPORTED');
  const payload = payloadSchema.parse(event.payload);
  if (
    [
      'order.submitted',
      'fulfillment.item.created',
      'fulfillment.item.updated',
      'cancellation.updated',
      'bill.updated',
    ].includes(event.eventType) &&
    !payload.tableSessionId
  )
    throw new Error('OUTBOX_PAYLOAD_INVALID');
  if (
    ['activation.requested', 'activation.updated', 'table.session.updated'].includes(
      event.eventType,
    ) &&
    !payload.tableId
  )
    throw new Error('OUTBOX_PAYLOAD_INVALID');
  return {
    payload,
    data: {
      eventId: event.id,
      type: event.eventType,
      resourceId: payload.id,
      version: payload.version,
    },
  };
}

export function matches(
  subscription: Subscription,
  event: {
    restaurantId: string;
    locationId: string;
    eventType: string;
  },
  payload: { tableId?: string | undefined; tableSessionId?: string | undefined },
) {
  if (
    subscription.restaurantId !== event.restaurantId ||
    subscription.locationId !== event.locationId
  )
    return false;
  switch (subscription.audience) {
    case 'kitchen':
      return [
        'fulfillment.item.created',
        'fulfillment.item.updated',
        'cancellation.updated',
      ].includes(event.eventType);
    case 'activation':
      return (
        ['activation.requested', 'activation.updated'].includes(event.eventType) &&
        (subscription.actorType === 'STAFF' || payload.tableId === subscription.resourceId)
      );
    case 'sessions':
      return event.eventType === 'table.session.updated';
    case 'bill':
      return (
        ['bill.updated', 'cancellation.updated'].includes(event.eventType) &&
        payload.tableSessionId === subscription.resourceId
      );
  }
}
