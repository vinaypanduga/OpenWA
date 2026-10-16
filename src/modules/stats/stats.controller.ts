import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MessageStatsResponseDto, OverviewStatsResponseDto, SessionStatsResponseDto } from './dto/stats-response.dto';
import { StatsService } from './stats.service';
import { StatsQueryDto } from './dto/stats-query.dto';
import { CurrentApiKey } from '../auth/decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';
import { GroupAnalyticsRequestDto, GroupAnalyticsResponseDto } from './dto/group-analytics.dto';

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

@ApiTags('statistics')
@Controller('sessions/:sessionId/stats')
export class SessionStatsController {
  constructor(private readonly statsService: StatsService) {}

  @Post('groups')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get analytics for multiple groups and a rolling day range',
    description:
      'Returns combined and per-group analytics for the supplied WhatsApp group IDs. Results are restricted to the session in the URL.',
  })
  @ApiBody({
    type: GroupAnalyticsRequestDto,
    examples: {
      sevenDays: {
        summary: 'Last seven days for two groups',
        value: {
          groupIds: ['120363000000000001@g.us', '120363000000000002@g.us'],
          days: 7,
        },
      },
    },
  })
  @ApiParam({
    name: 'sessionId',
    description: 'WhatsApp session UUID whose stored message analytics should be queried.',
    example: '57c032a1-a20d-4849-aa6a-eaeac756883a',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics for the requested session, groups, and rolling day window.',
    type: GroupAnalyticsResponseDto,
  })
  async getGroupAnalytics(
    @Param('sessionId') sessionId: string,
    @Body() body: GroupAnalyticsRequestDto,
  ): Promise<GroupAnalyticsResponseDto> {
    return this.statsService.getGroupAnalytics(sessionId, body.groupIds, body.days);
  }
}
