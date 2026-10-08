import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SOURCE_PAGE_SIZE = 1000;
const MAX_NAME_LENGTH = 200;
const FILTER_BATCH_SIZE = 100;

// Keep the Supabase data shape in code. Deployments only provide the project URL and the
// server-only service-role key; change this object when the source table/query changes.
export const SUPABASE_CUSTOM_GROUP_SOURCE = {
  schema: 'public',
  isDeletedColumn: 'is_deleted',
  programs: {
    table: 'program',
    idColumn: 'id',
    nameColumn: 'name',
    select: 'id,name',
  },
  schools: {
    table: 'school',
    idColumn: 'id',
    programIdColumn: 'program_id',
    groupColumn: 'group3',
    select: 'id,program_id,group3',
  },
  classes: {
    table: 'class',
    idColumn: 'id',
    schoolIdColumn: 'school_id',
    // The live Supabase schema uses singular `group_id`; values are WhatsApp group JIDs.
    groupIdColumn: 'group_id',
    select: 'id,school_id,group_id',
  },
} as const;

export interface SupabaseProgramOption {
  id: string;
  name: string;
}

export interface SupabaseCustomGroupSourceResponse {
  configured: boolean;
  programs: SupabaseProgramOption[];
  groupNames: string[];
  mappedGroupIds: string[];
  rowsRead: number;
  schoolRowsRead: number;
  classRowsRead: number;
  truncated: boolean;
  table?: string;
  nameColumn?: string;
}

@Injectable()
export class SupabaseCustomGroupSourceService {
  constructor(private readonly config: ConfigService) {}

  private async query(url: string, serviceRoleKey: string, table: string, params: Record<string, string>) {
    const endpoint = new URL(`${url}/rest/v1/${encodeURIComponent(table)}`);
    for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);
    endpoint.searchParams.set(SUPABASE_CUSTOM_GROUP_SOURCE.isDeletedColumn, 'eq.false');

    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: 'application/json',
          'Accept-Profile': SUPABASE_CUSTOM_GROUP_SOURCE.schema,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException('Unable to connect to the configured Supabase custom-group source');
    }

    if (!response.ok) {
      // Do not relay the Supabase response body: PostgREST errors can expose table/schema details,
      // policies, and SQL hints. The status is enough for an operator to distinguish auth/not-found.
      throw new BadGatewayException(`Supabase custom-group source returned HTTP ${response.status}`);
    }

    try {
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) {
        throw new BadGatewayException('Supabase custom-group source did not return a row array');
      }
      return rows as Array<Record<string, unknown>>;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('Supabase custom-group source returned invalid JSON');
    }
  }

  /** Supabase/PostgREST commonly caps a response at 1,000 rows, so walk every page explicitly. */
  private async queryAll(url: string, serviceRoleKey: string, table: string, params: Record<string, string>) {
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += SOURCE_PAGE_SIZE) {
      const page = await this.query(url, serviceRoleKey, table, {
        ...params,
        limit: String(SOURCE_PAGE_SIZE),
        offset: String(offset),
      });
      rows.push(...page);
      if (page.length < SOURCE_PAGE_SIZE) return rows;
    }
  }

  async load(programIds: string[] = [], selectedGroups: string[] = []): Promise<SupabaseCustomGroupSourceResponse> {
    const url = this.config.get<string>('customGroups.supabase.url')?.replace(/\/+$/, '') || '';
    const serviceRoleKey = this.config.get<string>('customGroups.supabase.serviceRoleKey') || '';
    const { programs: programSource, schools: schoolSource, classes: classSource } = SUPABASE_CUSTOM_GROUP_SOURCE;

    if (!url || !serviceRoleKey) {
      return {
        configured: false,
        programs: [],
        groupNames: [],
        mappedGroupIds: [],
        rowsRead: 0,
        schoolRowsRead: 0,
        classRowsRead: 0,
        truncated: false,
      };
    }

    const rows = await this.queryAll(url, serviceRoleKey, programSource.table, {
      select: programSource.select,
      order: `${programSource.idColumn}.asc`,
    });

    const programs: SupabaseProgramOption[] = [];
    const seenIds = new Set<string>();
    for (const row of rows) {
      const rawId = row[programSource.idColumn];
      const rawName = row[programSource.nameColumn];
      if ((typeof rawId !== 'string' && typeof rawId !== 'number') || typeof rawName !== 'string') continue;
      const id = String(rawId).trim();
      const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
      if (!id || !name || seenIds.has(id)) continue;
      seenIds.add(id);
      programs.push({ id, name });
    }
    programs.sort((left, right) => left.name.localeCompare(right.name));

    const availableIds = new Set(programs.map(program => program.id));
    const selectedProgramIds = [...new Set(programIds.map(id => id.trim()).filter(id => availableIds.has(id)))];
    const programIdBatches = Array.from(
      { length: Math.ceil(selectedProgramIds.length / FILTER_BATCH_SIZE) },
      (_, index) => selectedProgramIds.slice(index * FILTER_BATCH_SIZE, (index + 1) * FILTER_BATCH_SIZE),
    );
    const schoolRowBatches = await Promise.all(
      programIdBatches.map(batch =>
        this.queryAll(url, serviceRoleKey, schoolSource.table, {
          select: schoolSource.select,
          order: `${schoolSource.idColumn}.asc`,
          [schoolSource.programIdColumn]: `in.(${batch.join(',')})`,
        }),
      ),
    );
    const schoolRows = schoolRowBatches.flat();
    const groupNames = [
      ...new Set(
        schoolRows
          .map(row => row[schoolSource.groupColumn])
          .filter((value): value is string => typeof value === 'string')
          .map(value => value.trim().slice(0, MAX_NAME_LENGTH))
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right));
    const availableGroupNames = new Set(groupNames);
    const normalizedSelectedGroups = new Set(
      selectedGroups.map(value => value.trim()).filter(value => availableGroupNames.has(value)),
    );
    const schoolIds = [
      ...new Set(
        schoolRows
          .filter(row => {
            const groupName = row[schoolSource.groupColumn];
            return typeof groupName === 'string' && normalizedSelectedGroups.has(groupName.trim());
          })
          .map(row => row[schoolSource.idColumn])
          .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
          .map(String),
      ),
    ];
    const schoolIdBatches = Array.from({ length: Math.ceil(schoolIds.length / FILTER_BATCH_SIZE) }, (_, index) =>
      schoolIds.slice(index * FILTER_BATCH_SIZE, (index + 1) * FILTER_BATCH_SIZE),
    );
    const classRowBatches = await Promise.all(
      schoolIdBatches.map(batch =>
        this.queryAll(url, serviceRoleKey, classSource.table, {
          select: classSource.select,
          order: `${classSource.idColumn}.asc`,
          [classSource.schoolIdColumn]: `in.(${batch.join(',')})`,
          [classSource.groupIdColumn]: 'not.is.null',
        }),
      ),
    );
    const classRows = classRowBatches.flat();
    const uniqueGroupIds = new Map<string, string>();
    for (const row of classRows) {
      const value = row[classSource.groupIdColumn];
      if (typeof value !== 'string') continue;
      const groupId = value.trim();
      if (!groupId) continue;
      const normalizedId = groupId.toLocaleLowerCase();
      if (!uniqueGroupIds.has(normalizedId)) uniqueGroupIds.set(normalizedId, groupId);
    }
    const mappedGroupIds = [...uniqueGroupIds.values()];

    return {
      configured: true,
      programs,
      groupNames,
      mappedGroupIds,
      rowsRead: rows.length,
      schoolRowsRead: schoolRows.length,
      classRowsRead: classRows.length,
      truncated: false,
      table: programSource.table,
      nameColumn: programSource.nameColumn,
    };
  }
}
