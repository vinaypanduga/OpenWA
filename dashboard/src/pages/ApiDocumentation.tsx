import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { CheckCircle2, ChevronRight, Clipboard, Loader2, Play, Search, XCircle } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { API_BASE_URL } from '../services/api';
import {
  collectIntegrationOperations,
  curlForOperation,
  exampleFromSchema,
  parameterInitialValue,
  resolveApiRequest,
  resolveSchema,
  schemaLabel,
  type ApiOperation,
  type HttpMethod,
  type OpenApiDocument,
} from '../utils/apiDocumentation';
import { appAssetUrl } from '../utils/appBase';
import { copyToClipboard } from '../utils/clipboard';
import './ApiDocumentation.css';

interface CheckResult {
  ok: boolean;
  status: number;
  statusText: string;
  elapsedMs: number;
  body: string;
  contentType: string;
}

const mutationMethods = new Set<HttpMethod>(['post', 'put', 'patch', 'delete']);

function prettyResponse(text: string, contentType: string): string {
  if (!text) return '(empty response body)';
  if (!contentType.includes('json')) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function bodyInitialValue(operation: ApiOperation, document: OpenApiDocument): string {
  if (!operation.requestBody) return '';
  const example = operation.requestBody.example ?? exampleFromSchema(operation.requestBody.schema, document);
  return JSON.stringify(example ?? {}, null, 2);
}

export function ApiDocumentation() {
  useDocumentTitle('API Documentation');
  const toast = useToast();
  const [document, setDocument] = useState<OpenApiDocument | null>(null);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [requestBody, setRequestBody] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [bearerToken, setBearerToken] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(appAssetUrl('openapi.json'), { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as OpenApiDocument;
      })
      .then(setDocument)
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error instanceof Error ? error.message : 'Unable to load the API contract');
      });
    return () => controller.abort();
  }, []);

  const operations = useMemo(() => (document ? collectIntegrationOperations(document) : []), [document]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return operations.filter(operation => {
      return (
        !needle ||
        operation.path.toLowerCase().includes(needle) ||
        operation.summary.toLowerCase().includes(needle) ||
        operation.tag.toLowerCase().includes(needle)
      );
    });
  }, [operations, search]);

  const selected = filtered.find(operation => operation.id === selectedId) ?? filtered[0];

  useEffect(() => {
    if (!selected || !document) return;
    setSelectedId(selected.id);
    setParameterValues(
      Object.fromEntries(
        selected.parameters.map(parameter => [`${parameter.in}:${parameter.name}`, parameterInitialValue(parameter)]),
      ),
    );
    setRequestBody(bodyInitialValue(selected, document));
    setUploadFile(null);
    setBearerToken('');
    setResult(null);
  }, [selected, document]);

  const curl = selected ? curlForOperation(API_BASE_URL, selected, parameterValues, requestBody) : '';

  const checkApi = async () => {
    if (!selected) return;
    if (
      mutationMethods.has(selected.method) &&
      !window.confirm(
        `${selected.method.toUpperCase()} ${selected.path} can send messages or change server data. Run this API now?`,
      )
    ) {
      return;
    }

    setChecking(true);
    setResult(null);
    try {
      const request = resolveApiRequest(API_BASE_URL, selected, parameterValues);
      const apiKey = localStorage.getItem('openwa_api_key');
      const headers: Record<string, string> = { Accept: 'application/json', ...request.headers };
      if (apiKey && selected.authSchemes.includes('X-API-Key')) headers['X-API-Key'] = apiKey;
      if (selected.authSchemes.includes('metrics-bearer')) {
        if (!bearerToken.trim()) throw new Error('Enter the metrics bearer token before checking this API');
        headers.Authorization = `Bearer ${bearerToken.trim()}`;
      }
      let body: BodyInit | undefined;

      if (selected.requestBody?.contentType === 'application/json') {
        JSON.parse(requestBody || '{}');
        headers['Content-Type'] = 'application/json';
        body = requestBody || '{}';
      } else if (selected.requestBody?.contentType === 'multipart/form-data') {
        if (!uploadFile) throw new Error('Choose the required file before checking this API');
        const form = new FormData();
        form.append('file', uploadFile);
        body = form;
      }

      const startedAt = performance.now();
      const response = await fetch(request.url, {
        method: selected.method.toUpperCase(),
        headers,
        body,
        credentials: 'include',
      });
      const text = await response.text();
      const contentType = response.headers.get('content-type') ?? '';
      setResult({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        elapsedMs: Math.round(performance.now() - startedAt),
        body: prettyResponse(text, contentType),
        contentType,
      });
    } catch (error) {
      setResult({
        ok: false,
        status: 0,
        statusText: 'Request not sent',
        elapsedMs: 0,
        body: error instanceof Error ? error.message : 'Unknown request error',
        contentType: 'text/plain',
      });
    } finally {
      setChecking(false);
    }
  };

  const copyCurl = async () => {
    if (await copyToClipboard(curl)) toast.success('cURL copied');
    else toast.error('Could not copy cURL');
  };

  if (loadError) {
    return (
      <div className="api-documentation-page">
        <PageHeader title="API Documentation" />
        <div className="api-doc-load-state error-banner">
          <XCircle size={20} /> Unable to load API documentation: {loadError}
        </div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="api-documentation-page">
        <div className="api-doc-load-state">
          <Loader2 className="animate-spin" size={28} /> Loading API documentation…
        </div>
      </div>
    );
  }

  return (
    <div className="api-documentation-page">
      <PageHeader
        title="API Documentation"
        subtitle={`${operations.length} integration APIs from OpenWA ${document.info?.version ?? ''}. Select an API to view its parameters, generate cURL, and test it.`}
        badge={<span className="api-doc-version">OpenAPI 3</span>}
      />

      <div className="api-doc-toolbar">
        <label className="api-doc-search">
          <Search size={18} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search by API name, path, or group…"
            aria-label="Search APIs"
          />
        </label>
        <span className="api-doc-count">{filtered.length} shown</span>
      </div>

      <div className="api-doc-layout">
        <aside className="api-doc-list" aria-label="API endpoints">
          {filtered.length === 0 ? (
            <div className="api-doc-empty">No APIs match these filters.</div>
          ) : (
            filtered.map(operation => (
              <button
                key={operation.id}
                className={`api-doc-list-item ${selected?.id === operation.id ? 'active' : ''}`}
                onClick={() => setSelectedId(operation.id)}
              >
                <span className={`api-method api-method-${operation.method}`}>{operation.method.toUpperCase()}</span>
                <span className="api-doc-list-copy">
                  <strong>{operation.summary}</strong>
                  <code>{operation.path}</code>
                </span>
                <ChevronRight size={17} />
              </button>
            ))
          )}
        </aside>

        {selected && (
          <section className="api-doc-detail">
            <div className="api-doc-endpoint-heading">
              <span className={`api-method api-method-${selected.method}`}>{selected.method.toUpperCase()}</span>
              <code>{selected.path}</code>
              <span className="api-doc-tag">{selected.tag}</span>
              <span className="api-doc-auth">
                {selected.authSchemes.length ? `Auth: ${selected.authSchemes.join(', ')}` : 'Public API'}
              </span>
            </div>
            <h2>{selected.summary}</h2>
            {selected.description && <p className="api-doc-description">{selected.description}</p>}

            <section className="api-doc-section">
              <h3>Parameters</h3>
              {selected.parameters.length === 0 ? (
                <p className="api-doc-muted">This API has no path, query, or custom-header parameters.</p>
              ) : (
                <div className="api-doc-table-wrap">
                  <table className="api-doc-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Location</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Test value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.parameters.map(parameter => {
                        const inputKey = `${parameter.in}:${parameter.name}`;
                        const automaticCredential =
                          parameter.in === 'header' && ['x-api-key', 'cookie'].includes(parameter.name.toLowerCase());
                        return (
                          <tr key={inputKey}>
                            <td>
                              <code>{parameter.name}</code>
                              {parameter.required && <span className="api-required">required</span>}
                            </td>
                            <td>{parameter.in}</td>
                            <td>{schemaLabel(parameter.schema, document)}</td>
                            <td>{parameter.description || '—'}</td>
                            <td>
                              {automaticCredential ? (
                                <span className="api-doc-muted">
                                  {parameter.name.toLowerCase() === 'cookie'
                                    ? 'Current browser cookie'
                                    : 'Current login key'}
                                </span>
                              ) : (
                                <input
                                  value={parameterValues[inputKey] ?? ''}
                                  onChange={event =>
                                    setParameterValues(values => ({ ...values, [inputKey]: event.target.value }))
                                  }
                                  placeholder={parameter.required ? 'Required' : 'Optional'}
                                  aria-label={`${parameter.name} test value`}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {selected.requestBody && (
              <section className="api-doc-section">
                <h3>
                  Request body <code>{selected.requestBody.contentType}</code>
                  {selected.requestBody.required && <span className="api-required">required</span>}
                </h3>
                {selected.requestBody.description && <p>{selected.requestBody.description}</p>}
                {selected.requestBody.contentType === 'multipart/form-data' ? (
                  <label className="api-doc-file">
                    Plugin ZIP file
                    <input
                      type="file"
                      accept=".zip,application/zip"
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setUploadFile(event.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                ) : (
                  <textarea
                    className="api-doc-body-editor"
                    value={requestBody}
                    onChange={event => setRequestBody(event.target.value)}
                    spellCheck={false}
                    aria-label="JSON request body"
                  />
                )}
                <details className="api-doc-schema">
                  <summary>View request schema</summary>
                  <pre>{JSON.stringify(resolveSchema(selected.requestBody.schema, document), null, 2)}</pre>
                </details>
              </section>
            )}

            {selected.authSchemes.includes('metrics-bearer') && (
              <section className="api-doc-section">
                <h3>Authentication</h3>
                <label className="api-doc-token-field">
                  Metrics bearer token
                  <input
                    type="password"
                    value={bearerToken}
                    onChange={event => setBearerToken(event.target.value)}
                    autoComplete="off"
                    placeholder="Used for this check only"
                  />
                </label>
              </section>
            )}

            <section className="api-doc-section">
              <div className="api-doc-section-title-row">
                <h3>How to call this API</h3>
                <button className="api-doc-secondary-button" onClick={() => void copyCurl()}>
                  <Clipboard size={16} /> Copy cURL
                </button>
              </div>
              <pre className="api-doc-code">{curl}</pre>
            </section>

            <section className="api-doc-section api-doc-check-section">
              <div>
                <h3>Check API</h3>
                <p>
                  Uses your current dashboard login key. POST, PUT, PATCH, and DELETE calls ask for confirmation because
                  they may send a real WhatsApp message or change data.
                </p>
              </div>
              <button className="api-doc-check-button" onClick={() => void checkApi()} disabled={checking}>
                {checking ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                {checking ? 'Checking…' : 'Check API'}
              </button>
            </section>

            {result && (
              <section className={`api-doc-result ${result.ok ? 'success' : 'failure'}`} aria-live="polite">
                <div className="api-doc-result-heading">
                  {result.ok ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                  <strong>
                    {result.status || 'Error'} {result.statusText}
                  </strong>
                  <span>{result.elapsedMs} ms</span>
                  {result.contentType && <span>{result.contentType.split(';')[0]}</span>}
                </div>
                <pre>{result.body}</pre>
              </section>
            )}

            <section className="api-doc-section">
              <h3>Responses</h3>
              <div className="api-doc-table-wrap">
                <table className="api-doc-table api-doc-response-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Description</th>
                      <th>Response type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.responses.map(response => (
                      <tr key={response.status}>
                        <td>
                          <code>{response.status}</code>
                        </td>
                        <td>{response.description || '—'}</td>
                        <td>{schemaLabel(response.schema, document)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        )}
      </div>
    </div>
  );
}
