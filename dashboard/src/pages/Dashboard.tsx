import { Suspense } from 'react';
import { lazyWithRetry as lazy } from '../utils/lazyWithRetry';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Send, Activity, Loader2, Users } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  useSessionsQuery,
  useSessionGroupListsQueries,
  useSessionStatsQuery,
  useStatsOverviewQuery,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import { WidgetTooltip } from '../components/WidgetTooltip';
import './Dashboard.css';

// recharts is heavy (~150kB gzip); load the analytics section on demand so it never bloats the
// main/login bundle and only ships when the dashboard actually renders.
const DashboardCharts = lazy(() => import('../components/DashboardCharts').then(m => ({ default: m.DashboardCharts })));

export function Dashboard() {
  const { t } = useTranslation();
  useDocumentTitle(t('dashboard.title'));
  const { data: sessions = [], isLoading: loadingSessions, error: sessionsError } = useSessionsQuery();
  const { data: stats } = useSessionStatsQuery();
  const readySessionIds = sessions.filter(session => session.status === 'ready').map(session => session.id);
  const groupListQueries = useSessionGroupListsQueries(readySessionIds);
  // /stats/overview is ADMIN-only; for a non-admin key it 403s → overview stays undefined and the
  // message cards fall back to '—' without breaking the (un-gated) session cards.
  const { data: overview } = useStatsOverviewQuery();
  const messagesToday = overview ? overview.messages.today.sent + overview.messages.today.received : '—';
  const totalMessages = overview ? overview.messages.sent + overview.messages.received : '—';
  const groupsLoading = readySessionIds.length > 0 && groupListQueries.some(query => query.isLoading);
  const groupsUnavailable = groupListQueries.some(query => query.isError);
  const whatsappGroupCount =
    groupsLoading || groupsUnavailable
      ? '—'
      : new Set(groupListQueries.flatMap(query => (query.data ?? []).map(group => group.id))).size;
  const loading = loadingSessions;
  const error =
    sessionsError instanceof Error ? sessionsError.message : sessionsError ? t('dashboard.loadError') : null;

  const statsCards = [
    {
      // `stats.active` counts running engines — which includes initializing/qr_ready/connecting — so
      // it overstates what an operator reads as "connected". READY is the only status where the
      // session can actually send and receive.
      label: t('dashboard.stats.activeSessions'),
      value: stats?.ready ?? 0,
      icon: MessageSquare,
      detail: stats ? t('dashboard.stats.sessionsDetail', { running: stats.active, total: stats.total }) : undefined,
      tooltip: t('dashboard.tooltips.activeSessions', {
        defaultValue: 'Sessions currently ready and able to send or receive WhatsApp messages.',
      }),
    },
    {
      label: t('dashboard.stats.messagesToday'),
      value: messagesToday,
      icon: Send,
      tooltip: t('dashboard.tooltips.messagesToday', {
        defaultValue: "Incoming and outgoing messages recorded since midnight in the server's local time.",
      }),
    },
    {
      label: t('dashboard.stats.whatsappGroups', { defaultValue: 'WhatsApp Groups' }),
      value: whatsappGroupCount,
      icon: Users,
      detail:
        readySessionIds.length === 0
          ? t('dashboard.stats.groupsConnectSession', { defaultValue: 'Connect a session to load groups' })
          : groupsLoading
            ? t('dashboard.stats.groupsLoading', { defaultValue: 'Loading from WhatsApp…' })
            : groupsUnavailable
              ? t('dashboard.stats.groupsUnavailable', { defaultValue: 'Group count is temporarily unavailable' })
              : t('dashboard.stats.groupsDetail', {
                  count: readySessionIds.length,
                  defaultValue: 'Across {{count}} connected session',
                  defaultValue_other: 'Across {{count}} connected sessions',
                }),
      tooltip: t('dashboard.tooltips.whatsappGroups', {
        defaultValue:
          'Unique WhatsApp groups that the connected sessions currently belong to. The same group linked through multiple sessions is counted once.',
      }),
    },
    // The "Webhooks Configured" widget is intentionally hidden from the dashboard.
    {
      label: t('dashboard.stats.totalMessages'),
      value: totalMessages,
      icon: Activity,
      tooltip: t('dashboard.tooltips.totalMessages', {
        defaultValue: 'All incoming and outgoing messages stored across every session.',
      }),
    },
  ];

  if (loading) {
    return (
      <div
        className="dashboard"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard" style={{ padding: '2rem' }}>
        <div
          style={{ background: 'rgba(239, 68, 68, 0.12)', padding: '1rem', borderRadius: '8px', color: 'var(--error)' }}
        >
          {t('dashboard.errorPrefix', { message: error })}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        badge={
          <span className={`status-badge ${stats && stats.ready > 0 ? 'connected' : 'disconnected'}`}>
            {stats && stats.ready > 0 ? t('common.connected') : t('common.disconnected')}
          </span>
        }
      />

      <div className="stats-grid">
        {statsCards.map(({ label, value, icon: Icon, detail, tooltip }) => (
          <div key={label} className="stat-card">
            <Icon className="stat-watermark" />
            <div className="stat-header">
              <div className="stat-heading">
                <span className="stat-label">{label}</span>
                <WidgetTooltip text={tooltip} />
              </div>
              <Icon size={20} className="stat-icon" />
            </div>
            <div className="stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
            {detail && <div className="stat-detail">{detail}</div>}
          </div>
        ))}
      </div>

      <Suspense fallback={null}>
        <DashboardCharts sessions={sessions} />
      </Suspense>
    </div>
  );
}
