import { Controller, ForbiddenException, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MessageStatsResponseDto, OverviewStatsResponseDto, SessionStatsResponseDto } from './dto/stats-response.dto';
import { StatsService } from './stats.service';
import { StatsQueryDto } from './dto/stats-query.dto';
import { CurrentApiKey } from '../auth/decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('statistics')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  private analyticsSessionScope(apiKey?: ApiKey): string[] | undefined {
    const sessionIds = apiKey?.allowedSessions?.length ? apiKey.allowedSessions : undefined;
    // An administrator may inspect installation-wide aggregates. A restricted dashboard/API
    // identity may inspect only its explicitly assigned sessions. Never let an unscoped operator
    // turn these global routes into a cross-session data leak.
    if (!sessionIds && apiKey?.role !== ApiKeyRole.ADMIN) {
      throw new ForbiddenException('Analytics require an administrator or a session-scoped key');
    }
    return sessionIds;
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get overall statistics' })
  @ApiResponse({
    status: 200,
    description: 'Cross-session aggregate statistics (sessions, messages, etc.).',
    type: OverviewStatsResponseDto,
  })
  async getOverview(@CurrentApiKey() apiKey?: ApiKey) {
    return this.statsService.getOverview(this.analyticsSessionScope(apiKey));
  }

  @Get('messages')
  @ApiOperation({ summary: 'Get message statistics with time series' })
  @ApiResponse({
    status: 200,
    description: 'Message statistics with a time series for the requested period.',
    type: MessageStatsResponseDto,
  })
  async getMessageStats(@Query() query: StatsQueryDto, @CurrentApiKey() apiKey?: ApiKey) {
    const sessionIds = this.analyticsSessionScope(apiKey);
    const groupIds = [...(query.groupIds ?? []), ...(query.groupId ? [query.groupId] : [])];
    return this.statsService.getMessageStats(query.period || '24h', groupIds.length ? groupIds : undefined, sessionIds);
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: 'Get statistics for a specific session' })
  @ApiResponse({
    status: 200,
    description: 'Per-session statistics for the requested session.',
    type: SessionStatsResponseDto,
  })
  async getSessionStats(@Param('sessionId') sessionId: string) {
    return this.statsService.getSessionStats(sessionId);
  }
}
