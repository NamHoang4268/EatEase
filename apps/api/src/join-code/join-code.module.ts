import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { GuestSessionModule } from '../guest-session/guest-session.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { loadEnvironment } from '../config/environment.js';
import { GuestJoinCodeController, StaffJoinCodeController } from './join-code.controller.js';
import { JoinCodeService } from './join-code.service.js';
import { JoinSourceIpService } from './join-source-ip.service.js';

@Module({
  imports: [DatabaseModule, GuestSessionModule, StaffAuthModule],
  controllers: [GuestJoinCodeController, StaffJoinCodeController],
  providers: [
    JoinCodeService,
    {
      provide: JoinSourceIpService,
      useFactory: () => {
        const environment = loadEnvironment();
        return new JoinSourceIpService({
          signatureRequired: environment.NODE_ENV === 'production',
          sharedSecret: environment.API_PROXY_SHARED_SECRET,
        });
      },
    },
  ],
})
export class JoinCodeModule {}
