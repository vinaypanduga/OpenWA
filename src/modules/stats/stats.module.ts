import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { Session } from '../session/entities/session.entity';
import { Message } from '../message/entities/message.entity';
import { BigQuery } from '@google-cloud/bigquery';
import {
  BIGQUERY_CLIENT_FACTORY,
  BigQueryAnalyticsExportService,
  BigQueryClientFactory,
} from './bigquery-analytics-export.service';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Message], 'data')],
  controllers: [StatsController],
  providers: [
    StatsService,
    BigQueryAnalyticsExportService,
    {
      provide: BIGQUERY_CLIENT_FACTORY,
      useValue: ((projectId: string) => new BigQuery({ projectId })) satisfies BigQueryClientFactory,
    },
  ],
  exports: [StatsService],
})
export class StatsModule {}
