import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupModule } from '../group/group.module';
import { CustomGroupController } from './custom-group.controller';
import { CustomGroupService } from './custom-group.service';
import { CustomGroup } from './entities/custom-group.entity';
import { SupabaseCustomGroupSourceService } from './supabase-custom-group-source.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustomGroup], 'data'), GroupModule],
  controllers: [CustomGroupController],
  providers: [CustomGroupService, SupabaseCustomGroupSourceService],
  exports: [CustomGroupService],
})
export class CustomGroupModule {}
