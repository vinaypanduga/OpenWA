import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { CustomGroupService } from './custom-group.service';
import { CreateCustomGroupDto, CustomGroupResponseDto, UpdateCustomGroupDto } from './dto';
import { CustomGroup } from './entities/custom-group.entity';

@ApiTags('custom-groups')
@Controller('sessions/:sessionId/custom-groups')
export class CustomGroupController {
  constructor(private readonly service: CustomGroupService) {}

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Create a named collection of existing WhatsApp groups' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 201, type: CustomGroupResponseDto })
  async create(@Param('sessionId') sessionId: string, @Body() dto: CreateCustomGroupDto): Promise<CustomGroup> {
    return this.service.create(sessionId, dto);
  }

  @Get()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List custom group collections for a session' })
  async findBySession(@Param('sessionId') sessionId: string): Promise<CustomGroup[]> {
    return this.service.findBySession(sessionId);
  }

  @Get(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  async findOne(@Param('sessionId') sessionId: string, @Param('id') id: string): Promise<CustomGroup> {
    return this.service.findOne(sessionId, id);
  }

  @Put(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Update a custom group collection' })
  async update(@Param('sessionId') sessionId: string, @Param('id') id: string, @Body() dto: UpdateCustomGroupDto) {
    return this.service.update(sessionId, id, dto);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom group collection' })
  async delete(@Param('sessionId') sessionId: string, @Param('id') id: string): Promise<void> {
    return this.service.delete(sessionId, id);
  }
}
