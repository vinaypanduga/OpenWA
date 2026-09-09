import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomGroupModule } from '../custom-group/custom-group.module';
import { MessageModule } from '../message/message.module';
import { ScheduledMessageController } from './scheduled-message.controller';
import { ScheduledMessageService } from './scheduled-message.service';
import { ScheduledMessage } from './entities/scheduled-message.entity';
import { HistoryRetentionService } from './history-retention.service';

@Module({
  imports: [TypeOrmModule.forFeature([ScheduledMessage], 'data'), CustomGroupModule, MessageModule],
  controllers: [ScheduledMessageController],
  providers: [ScheduledMessageService, HistoryRetentionService],
  exports: [ScheduledMessageService],
})
export class ScheduledMessageModule {}
