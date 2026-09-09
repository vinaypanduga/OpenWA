import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { CreateScheduledMessageDto, ScheduledMessageResponseDto } from './dto';
import { ScheduledMessageService } from './scheduled-message.service';
import { ScheduledMessage } from './entities/scheduled-message.entity';

@ApiTags('scheduled-messages')
@Controller('sessions/:sessionId/scheduled-messages')
@RequireRole(ApiKeyRole.OPERATOR)
export class ScheduledMessageController {
  constructor(private readonly service: ScheduledMessageService) {}

  @Post()
  @ApiOperation({ summary: 'Schedule a message campaign for a saved custom group' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 201, type: ScheduledMessageResponseDto })
  async create(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateScheduledMessageDto,
  ): Promise<ScheduledMessage> {
    return this.service.create(sessionId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List scheduled message campaigns for a session' })
  async findBySession(@Param('sessionId') sessionId: string): Promise<ScheduledMessage[]> {
    return this.service.findBySession(sessionId);
  }

  @Get(':id')
  async findOne(@Param('sessionId') sessionId: string, @Param('id') id: string): Promise<ScheduledMessage> {
    return this.service.findOne(sessionId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a pending or processing scheduled campaign' })
  async cancel(@Param('sessionId') sessionId: string, @Param('id') id: string): Promise<ScheduledMessage> {
    return this.service.cancel(sessionId, id);
  }
}
