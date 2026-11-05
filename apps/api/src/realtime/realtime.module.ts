import { Module } from '@nestjs/common';
import { GuestSessionModule } from '../guest-session/guest-session.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';
import { RealtimeService } from './realtime.service.js';
import { OutboxStore } from './outbox.store.js';
import { OutboxPublisher } from './outbox-publisher.service.js';

@Module({
  imports: [GuestSessionModule, StaffAuthModule],
  controllers: [RealtimeController],
  providers: [RealtimeTicketService, RealtimeService, OutboxStore, OutboxPublisher],
  exports: [RealtimeService, OutboxPublisher],
})
export class RealtimeModule {}
