import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseCustomGroupSourceService } from './supabase-custom-group-source.service';

const configured = {
  'customGroups.supabase.url': 'https://project.supabase.co',
  'customGroups.supabase.serviceRoleKey': 'server-only-key',
};

function service(values: Record<string, string> = configured): SupabaseCustomGroupSourceService {
  return new SupabaseCustomGroupSourceService({
    get: (key: string) => values[key],
  } as ConfigService);
}

describe('SupabaseCustomGroupSourceService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports an unconfigured source without making a network request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(service({}).load()).resolves.toEqual({
      configured: false,
      programs: [],
      groupNames: [],
      mappedGroupIds: [],
      rowsRead: 0,
      schoolRowsRead: 0,
      classRowsRead: 0,
      truncated: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('loads, trims, sorts, and deduplicates programs by ID', async () => {
    const json = jest.fn().mockResolvedValue([
      { id: 2, name: ' Literacy ' },
      { id: 1, name: 'Numeracy' },
      { id: 2, name: 'Duplicate ID' },
      { id: 3, name: null },
    ]);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json } as Response);

    await expect(service().load()).resolves.toEqual({
      configured: true,
      programs: [
        { id: '2', name: 'Literacy' },
        { id: '1', name: 'Numeracy' },
      ],
      groupNames: [],
      mappedGroupIds: [],
      rowsRead: 4,
      schoolRowsRead: 0,
      classRowsRead: 0,
      truncated: false,
      table: 'program',
      nameColumn: 'name',
    });

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    const requestedUrl = (url as URL).toString();
    expect(requestedUrl).toContain('/rest/v1/program?');
    expect(requestedUrl).toContain('select=id%2Cname');
    expect((url as URL).searchParams.get('is_deleted')).toBe('eq.false');
    expect(options?.headers).toMatchObject({
      apikey: 'server-only-key',
      Authorization: 'Bearer server-only-key',
      'Accept-Profile': 'public',
    });
  });

  it('ignores rows without a usable ID and name', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          { id: 'one', name: 'One' },
          { id: null, name: 'Missing ID' },
        ]),
    } as Response);
    await expect(service().load()).resolves.toMatchObject({ programs: [{ id: 'one', name: 'One' }], rowsRead: 2 });
  });

  it('paginates past the Supabase 1,000-row response limit', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `program-${index}`,
      name: `Program ${index}`,
    }));
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(firstPage) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ id: 'program-1000', name: 'Program 1000' }]),
      } as Response);

    await expect(service().load()).resolves.toMatchObject({ rowsRead: 1001, truncated: false });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[0][0] as URL).searchParams.get('offset')).toBe('0');
    expect((fetchSpy.mock.calls[1][0] as URL).searchParams.get('offset')).toBe('1000');
  });

  it('loads school group3 values and class WhatsApp group IDs for the selections', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { id: 'program-1', name: 'Literacy' },
            { id: 'program-2', name: 'Numeracy' },
          ]),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { id: 'school-1', program_id: 'program-1', group3: ' School Alpha ' },
            { id: 'school-2', program_id: 'program-2', group3: 'School Beta' },
            { id: 'school-3', program_id: 'program-2', group3: 'School Alpha' },
            { id: 'school-4', program_id: 'program-2', group3: null },
          ]),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { school_id: 'school-1', group_id: ' 120001@g.us ' },
            { school_id: 'school-3', group_id: '120002@g.us' },
            { school_id: 'school-3', group_id: '120001@G.US' },
            { school_id: 'school-3', group_id: null },
          ]),
      } as Response);

    await expect(service().load(['program-2', 'program-1', 'unknown'], ['School Alpha'])).resolves.toMatchObject({
      groupNames: ['School Alpha', 'School Beta'],
      mappedGroupIds: ['120001@g.us', '120002@g.us'],
      schoolRowsRead: 4,
      classRowsRead: 4,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const schoolUrl = (fetchSpy.mock.calls[1][0] as URL).toString();
    expect(schoolUrl).toContain('/rest/v1/school?');
    expect(schoolUrl).toContain('select=id%2Cprogram_id%2Cgroup3');
    expect(schoolUrl).toContain('program_id=in.%28program-2%2Cprogram-1%29');
    expect((fetchSpy.mock.calls[1][0] as URL).searchParams.get('is_deleted')).toBe('eq.false');
    const classUrl = (fetchSpy.mock.calls[2][0] as URL).toString();
    expect(classUrl).toContain('/rest/v1/class?');
    expect(classUrl).toContain('select=id%2Cschool_id%2Cgroup_id');
    expect(classUrl).toContain('school_id=in.%28school-1%2Cschool-3%29');
    expect(classUrl).toContain('group_id=not.is.null');
    expect((fetchSpy.mock.calls[2][0] as URL).searchParams.get('is_deleted')).toBe('eq.false');
  });

  it('does not expose a Supabase error body or API key', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(service().load()).rejects.toEqual(
      new BadGatewayException('Supabase custom-group source returned HTTP 401'),
    );
  });
});
