export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const INTEGRATION_OPERATIONS = [
  ['SessionController_findOne', 'Check whether session is active'],
  ['MessageController_sendText', 'Send text message'],
  ['MessageController_sendVideo', 'Send video message'],
  ['MessageController_sendAudio', 'Send voice message'],
  ['MessageController_sendDocument', 'Send file/document'],
  ['MessageController_sendPoll', 'Send poll message'],
  ['GroupController_findOne', 'Get group data by group ID'],
  ['SessionController_getGroups', 'Get all groups'],
  ['GroupController_joinInfo', 'Get group data by invite link'],
  ['SessionStatsController_getGroupAnalytics', 'Get analytics for multiple groups'],
  ['MessageController_sendBulk', 'Send messages to multiple groups with jitter'],
] as const;

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  title?: string;
  description?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  nullable?: boolean;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  additionalProperties?: boolean | OpenApiSchema;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  example?: unknown;
  schema?: OpenApiSchema;
}

interface OpenApiMediaType {
  schema?: OpenApiSchema;
  example?: unknown;
  examples?: Record<string, { summary?: string; value?: unknown }>;
}

interface OpenApiOperationSource {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  security?: Array<Record<string, unknown[]>>;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, OpenApiMediaType>;
    }
  >;
}

export interface OpenApiDocument {
  info?: { title?: string; version?: string; description?: string };
  security?: Array<Record<string, unknown[]>>;
  paths?: Record<string, Partial<Record<HttpMethod, OpenApiOperationSource>>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

export interface ApiRequestBody {
  required: boolean;
  description?: string;
  contentType: string;
  schema?: OpenApiSchema;
  example?: unknown;
}

export interface ApiResponseDocumentation {
  status: string;
  description: string;
  schema?: OpenApiSchema;
}

export interface ApiOperation {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tag: string;
  authSchemes: string[];
  parameters: OpenApiParameter[];
  requestBody?: ApiRequestBody;
  responses: ApiResponseDocumentation[];
}

export function collectApiOperations(document: OpenApiDocument): ApiOperation[] {
  const operations: ApiOperation[] = [];
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const source = pathItem[method];
      if (!source) continue;
      const bodyEntry = Object.entries(source.requestBody?.content ?? {})[0];
      const mediaExample = bodyEntry
        ? (bodyEntry[1].example ??
          Object.values(bodyEntry[1].examples ?? {}).find(example => example.value !== undefined)?.value)
        : undefined;
      operations.push({
        id: source.operationId ?? `${method}:${path}`,
        method,
        path,
        summary: source.summary ?? source.operationId ?? `${method.toUpperCase()} ${path}`,
        description: source.description,
        tag: source.tags?.[0] ?? 'other',
        authSchemes: [
          ...new Set((source.security ?? document.security ?? []).flatMap(requirement => Object.keys(requirement))),
        ],
        parameters: source.parameters ?? [],
        requestBody: bodyEntry
          ? {
              required: source.requestBody?.required ?? false,
              description: source.requestBody?.description,
              contentType: bodyEntry[0],
              schema: bodyEntry[1].schema,
              example: mediaExample,
            }
          : undefined,
        responses: Object.entries(source.responses ?? {}).map(([status, response]) => ({
          status,
          description: response.description ?? '',
          schema: Object.values(response.content ?? {})[0]?.schema,
        })),
      });
    }
  }
  return operations.sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path));
}

/** The intentionally small external-integration surface exposed in the dashboard. */
export function collectIntegrationOperations(document: OpenApiDocument): ApiOperation[] {
  const operations = collectApiOperations(document);
  const byId = new Map(operations.map(operation => [operation.id, operation]));
  return INTEGRATION_OPERATIONS.flatMap(([id, summary]) => {
    const operation = byId.get(id);
    return operation ? [{ ...operation, summary }] : [];
  });
}

export function resolveSchema(
  schema: OpenApiSchema | undefined,
  document: OpenApiDocument,
  seen = new Set<string>(),
): OpenApiSchema | undefined {
  if (!schema?.$ref) return schema;
  const name = schema.$ref.split('/').at(-1);
  if (!name || seen.has(name)) return schema;
  const resolved = document.components?.schemas?.[name];
  if (!resolved) return schema;
  const nextSeen = new Set(seen);
  nextSeen.add(name);
  return { ...resolveSchema(resolved, document, nextSeen), description: schema.description ?? resolved.description };
}

export function schemaLabel(schema: OpenApiSchema | undefined, document: OpenApiDocument): string {
  if (!schema) return 'any';
  if (schema.$ref) return schema.$ref.split('/').at(-1) ?? 'object';
  const resolved = resolveSchema(schema, document);
  if (resolved?.enum?.length) return resolved.enum.map(String).join(' | ');
  if (resolved?.type === 'array') return `array<${schemaLabel(resolved.items, document)}>`;
  return [resolved?.type ?? 'object', resolved?.format].filter(Boolean).join(' · ');
}

export function exampleFromSchema(
  schema: OpenApiSchema | undefined,
  document: OpenApiDocument,
  depth = 0,
  seenRefs = new Set<string>(),
): unknown {
  if (!schema || depth > 8) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1);
    if (!name || seenRefs.has(name)) return {};
    const resolved = document.components?.schemas?.[name];
    if (!resolved) return {};
    const nextSeen = new Set(seenRefs);
    nextSeen.add(name);
    return exampleFromSchema(resolved, document, depth + 1, nextSeen);
  }
  if (schema.allOf?.length) {
    return Object.assign(
      {},
      ...schema.allOf.map(item => exampleFromSchema(item, document, depth + 1, new Set(seenRefs))),
    );
  }
  const alternative = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (alternative) return exampleFromSchema(alternative, document, depth + 1, seenRefs);
  if (schema.type === 'array') return [exampleFromSchema(schema.items, document, depth + 1, seenRefs)];
  if (schema.type === 'object' || schema.properties) {
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([name, property]) => [
        name,
        exampleFromSchema(property, document, depth + 1, new Set(seenRefs)),
      ]),
    );
  }
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  if (schema.format === 'date-time') return new Date(0).toISOString();
  return '';
}

export function parameterInitialValue(parameter: OpenApiParameter): string {
  const value =
    parameter.example ?? parameter.schema?.example ?? parameter.schema?.default ?? parameter.schema?.enum?.[0];
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function resolveApiRequest(
  apiBaseUrl: string,
  operation: Pick<ApiOperation, 'path' | 'parameters'>,
  values: Record<string, string>,
): { url: string; headers: Record<string, string> } {
  let resolvedPath = operation.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};

  for (const parameter of operation.parameters) {
    const value = values[`${parameter.in}:${parameter.name}`]?.trim() ?? '';
    if (parameter.required && !value && parameter.in !== 'header') {
      throw new Error(`${parameter.name} is required`);
    }
    if (!value) continue;
    if (parameter.in === 'path') resolvedPath = resolvedPath.replace(`{${parameter.name}}`, encodeURIComponent(value));
    if (parameter.in === 'query') query.append(parameter.name, value);
    if (
      parameter.in === 'header' &&
      parameter.name.toLowerCase() !== 'x-api-key' &&
      parameter.name.toLowerCase() !== 'cookie'
    ) {
      headers[parameter.name] = value;
    }
  }

  if (/\{[^}]+\}/.test(resolvedPath)) throw new Error('Fill all required path parameters');
  const suffix = resolvedPath.startsWith('/api') ? resolvedPath.slice(4) : resolvedPath;
  return { url: `${apiBaseUrl}${suffix}${query.size ? `?${query.toString()}` : ''}`, headers };
}

export function curlForOperation(
  apiBaseUrl: string,
  operation: ApiOperation,
  values: Record<string, string>,
  body: string,
): string {
  let request: { url: string; headers: Record<string, string> };
  try {
    request = resolveApiRequest(apiBaseUrl, operation, values);
  } catch {
    request = { url: `${apiBaseUrl}${operation.path.replace(/^\/api/, '')}`, headers: {} };
  }
  const lines = [`curl -X ${operation.method.toUpperCase()} '${request.url}'`];
  if (operation.authSchemes.includes('X-API-Key')) lines.push(`  -H 'X-API-Key: YOUR_API_KEY'`);
  if (operation.authSchemes.includes('metrics-bearer')) {
    lines.push(`  -H 'Authorization: Bearer YOUR_METRICS_TOKEN'`);
  }
  if (operation.parameters.some(parameter => parameter.in === 'header' && parameter.name.toLowerCase() === 'cookie')) {
    lines.push(`  -b 'openwa_dashboard_session=YOUR_DASHBOARD_COOKIE'`);
  }
  for (const [name, value] of Object.entries(request.headers)) lines.push(`  -H '${name}: ${value}'`);
  if (operation.requestBody?.contentType === 'application/json') {
    lines.push(`  -H 'Content-Type: application/json'`, `  -d '${body.replaceAll("'", "'\\''")}'`);
  } else if (operation.requestBody?.contentType === 'multipart/form-data') {
    lines.push(`  -F 'file=@/path/to/plugin.zip'`);
  }
  return lines.join(' \\\n');
}
