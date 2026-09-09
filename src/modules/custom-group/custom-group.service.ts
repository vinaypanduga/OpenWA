import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupService } from '../group/group.service';
import { isUniqueViolation } from '../../common/utils/db-errors';
import { createLogger } from '../../common/services/logger.service';
import { CustomGroup } from './entities/custom-group.entity';
import { CreateCustomGroupDto, UpdateCustomGroupDto } from './dto';

@Injectable()
export class CustomGroupService {
  private readonly logger = createLogger('CustomGroupService');

  constructor(
    @InjectRepository(CustomGroup, 'data') private readonly repository: Repository<CustomGroup>,
    private readonly groups: GroupService,
  ) {}

  private async validateGroupIds(sessionId: string, groupIds: string[]): Promise<string[]> {
    const uniqueIds = [...new Set(groupIds.map(id => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) throw new BadRequestException('At least one group must be selected');
    const available = await this.groups.getGroups(sessionId);
    const availableIds = new Set(available.map(group => group.id));
    const missing = uniqueIds.filter(id => !availableIds.has(id));
    if (missing.length) {
      throw new BadRequestException(
        `The selected group${missing.length === 1 ? '' : 's'} no longer exist in this session`,
      );
    }
    return uniqueIds;
  }

  async create(sessionId: string, dto: CreateCustomGroupDto): Promise<CustomGroup> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('A collection name is required');
    const entity = this.repository.create({
      sessionId,
      name,
      groupIds: await this.validateGroupIds(sessionId, dto.groupIds),
    });
    try {
      const saved = await this.repository.save(entity);
      this.logger.log('Custom group created', { sessionId, customGroupId: saved.id, name: saved.name });
      return saved;
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException(`A custom group named '${dto.name}' already exists for this session`);
      throw err;
    }
  }

  findBySession(sessionId: string): Promise<CustomGroup[]> {
    return this.repository.find({ where: { sessionId }, order: { createdAt: 'DESC' } });
  }

  async findOne(sessionId: string, id: string): Promise<CustomGroup> {
    const entity = await this.repository.findOne({ where: { id, sessionId } });
    if (!entity) throw new NotFoundException(`Custom group with id '${id}' not found`);
    return entity;
  }

  async update(sessionId: string, id: string, dto: UpdateCustomGroupDto): Promise<CustomGroup> {
    const entity = await this.findOne(sessionId, id);
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('A collection name is required');
      entity.name = name;
    }
    if (dto.groupIds !== undefined) entity.groupIds = await this.validateGroupIds(sessionId, dto.groupIds);
    try {
      return await this.repository.save(entity);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException(`A custom group named '${entity.name}' already exists for this session`);
      throw err;
    }
  }

  async delete(sessionId: string, id: string): Promise<void> {
    const entity = await this.findOne(sessionId, id);
    await this.repository.remove(entity);
    this.logger.log('Custom group deleted', { sessionId, customGroupId: id });
  }
}
