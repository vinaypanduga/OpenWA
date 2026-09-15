import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { BarChart3, MessageCircleMore, MessageSquare, Send } from 'lucide-react';
import { useSessionGroupListsQueries, useStatsMessagesQuery } from '../hooks/queries';
import type { StatsPeriod } from '../services/api';
import { WidgetTooltip } from './WidgetTooltip';
import './DashboardCharts.css';

const PERIODS: StatsPeriod[] = ['24h', '7d', '30d'];

// Stable, distinct color per message type (recharts needs literal colors). Keyed by type name —
// not array index — so two types can never share a color, and a slice keeps its color even when the
// set of present types changes between requests. Covers every type mapMessageType() can emit.
const TYPE_COLORS: Record<string, string> = {
  text: '#25d366',
  image: '#3b82f6',
  contact: '#a855f7',
  document: '#f59e0b',
  audio: '#06b6d4',
  voice: '#ec4899',
  video: '#14b8a6',
  sticker: '#ef4444',
  location: '#84cc16',
  poll: '#6366f1',
  revoked: '#f43f5e',
  masked: '#8b5cf6',
  unknown: '#64748b',
};

// Deterministic fallback for any unmapped type, so its color is stable across renders.
const FALLBACK_COLORS = ['#0ea5e9', '#d946ef', '#f97316', '#10b981', '#6366f1', '#eab308'];
function colorForType(name: string): string {
  if (TYPE_COLORS[name]) return TYPE_COLORS[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// '2026-06-24 14:00:00' (hour buckets) → '14:00'; '2026-06-24' (day buckets) → '06-24'.
function formatTick(ts: string, period: StatsPeriod): string {
  return period === '24h' ? ts.slice(11, 16) : ts.slice(5);
}

// WhatsApp ids look like '62812...@c.us' / '...@g.us' / '...@lid' — show just the local part.
function shortChat(chatId: string): string {
  return chatId.split('@')[0] || chatId;
}

function phoneFromChatId(chatId: string): string | null {
  const [local, domain] = chatId.split('@');
  return local && /^\d+$/.test(local) && (domain === 'c.us' || domain === 's.whatsapp.net') ? `+${local}` : null;
}

function formatLastActive(value: string): string {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const timestamp = new Date(normalized).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

interface DashboardChartsProps {
  sessionIds?: string[];
}

export function DashboardCharts({ sessionIds = [] }: DashboardChartsProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<StatsPeriod>('24h');
  const [groupId, setGroupId] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [chatSearch, setChatSearch] = useState('');
  const { data, isLoading, isError, error } = useStatsMessagesQuery(period, groupId);
  const groupListQueries = useSessionGroupListsQueries(sessionIds);

  // Non-admin keys 403 on /stats/messages → hide the section entirely. Any OTHER error (e.g. a
  // server 500) is a real fault: surface a small notice below instead of silently vanishing, which
  // is what masked the #488 stats crash and made the whole chart "disappear" with no explanation.
  const forbidden = (error as (Error & { status?: number }) | null)?.status === 403;
  if (isError && forbidden) return null;

  const groupBreakdown = data?.groupBreakdown ?? [];
  const liveGroupNameById = new Map<string, string>();
  for (const query of groupListQueries) {
    for (const group of query.data ?? []) {
      const name = group.name.trim();
      if (name) liveGroupNameById.set(group.id, name);
    }
  }
  const groupNameUnavailable = t('dashboard.charts.groupNameUnavailable', {
    defaultValue: 'Group name unavailable',
  });
  const displayGroupName = (id: string, storedName?: string | null) => {
    const liveName = liveGroupNameById.get(id);
    if (liveName) return liveName;
    const stored = storedName?.trim();
    // Older rows sometimes carry the JID/local numeric id in the name column. That is an
    // identifier, not a group subject, so do not present it as though it were a real name.
    return stored && stored !== id && stored !== shortChat(id) ? stored : groupNameUnavailable;
  };

  const timeSeries = (data?.timeSeries ?? []).map(p => ({ ...p, label: formatTick(p.timestamp, period) }));
  const byType = Object.entries(data?.byType ?? {})
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const totalChatMessages = (data?.summary.sent ?? 0) + (data?.summary.received ?? 0);
  const chatActivity = (data?.topChats ?? []).map(chat => {
    const isGroup = chat.chatId.endsWith('@g.us');
    const phone = phoneFromChatId(chat.chatId);
    return {
      ...chat,
      name: isGroup
        ? displayGroupName(chat.chatId, chat.chatName)
        : chat.chatName ||
          phone ||
          t('dashboard.charts.contactNameUnavailable', { defaultValue: 'Contact name unavailable' }),
      address:
        phone ??
        (isGroup
          ? t('dashboard.charts.whatsappGroup', { defaultValue: 'WhatsApp group' })
          : t('dashboard.charts.phoneUnavailable', { defaultValue: 'Phone unavailable' })),
      activityShare: totalChatMessages > 0 ? (chat.messageCount / totalChatMessages) * 100 : 0,
    };
  });
  const normalizedChatSearch = chatSearch.trim().toLowerCase();
  const visibleChatActivity = normalizedChatSearch
    ? chatActivity.filter(chat =>
        `${chat.name ?? ''} ${chat.address} ${chat.chatId}`.toLowerCase().includes(normalizedChatSearch),
      )
    : chatActivity;
  const selectedGroup = groupBreakdown.find(group => group.groupId === groupId);
  const selectedGroupLabel = groupId ? displayGroupName(groupId, selectedGroup?.groupName) : '';
  const normalizedGroupSearch = groupSearch.trim().toLowerCase();
  const visibleGroups = normalizedGroupSearch
    ? groupBreakdown.filter(group =>
        `${displayGroupName(group.groupId, group.groupName)} ${group.groupId}`
          .toLowerCase()
          .includes(normalizedGroupSearch),
      )
    : groupBreakdown;
  const allGroupMessages = groupBreakdown.reduce((total, group) => total + group.total, 0);
  const summary = data?.summary;
  const hasData =
    Boolean(summary && (summary.sent > 0 || summary.received > 0 || summary.interactions > 0)) ||
    timeSeries.length > 0 ||
    byType.length > 0 ||
    chatActivity.length > 0 ||
    groupBreakdown.length > 0;
  const metricCards = summary
    ? [
        {
          label: t('dashboard.charts.sent'),
          value: summary.sent.toLocaleString(),
          detail: t('analytics.outgoingDetail', { defaultValue: 'Outgoing messages in this period' }),
          tooltip: t('dashboard.tooltips.periodSent', {
            defaultValue: 'Outgoing messages recorded during the selected reporting period.',
          }),
          icon: Send,
          tone: 'sent',
        },
        {
          label: t('dashboard.charts.received'),
          value: summary.received.toLocaleString(),
          detail: t('analytics.incomingDetail', { defaultValue: 'Incoming messages in this period' }),
          tooltip: t('dashboard.tooltips.periodReceived', {
            defaultValue: 'Incoming messages recorded during the selected reporting period.',
          }),
          icon: MessageSquare,
          tone: 'received',
        },
        {
          label: t('dashboard.stats.totalMessages'),
          value: (summary.sent + summary.received).toLocaleString(),
          detail: t('analytics.totalDetail', { defaultValue: 'Sent and received messages combined' }),
          tooltip: t('dashboard.tooltips.periodTotal', {
            defaultValue: 'All incoming and outgoing messages recorded during the selected reporting period.',
          }),
          icon: BarChart3,
          tone: 'total',
        },
        {
          label: t('analytics.activeChats', { defaultValue: 'Active chats' }),
          value: summary.interactions.toLocaleString(),
          detail: t('analytics.activeChatsDetail', {
            defaultValue: 'Different chat windows with at least one message',
          }),
          tooltip: t('dashboard.tooltips.activeChats', {
            defaultValue:
              'A chat is counted once when it has any sent or received message. One message or 100 messages in the same chat still count as one active chat.',
          }),
          icon: MessageCircleMore,
          tone: 'interactions',
        },
      ]
    : [];

  return (
    <section className="dashboard-charts">
      <div className="charts-header">
        <div className="charts-title">
          <BarChart3 size={18} />
          <h2>{t('dashboard.charts.title')}</h2>
        </div>
        <div className="analytics-filters">
          <label className="group-filter">
            <span>{t('dashboard.charts.groupFilter', { defaultValue: 'Group filter' })}</span>
            <select value={groupId} onChange={event => setGroupId(event.target.value)}>
              <option value="">{t('dashboard.charts.allConversations', { defaultValue: 'All conversations' })}</option>
              {groupId && !selectedGroup && <option value={groupId}>{displayGroupName(groupId)}</option>}
              {groupBreakdown.map(group => (
                <option key={group.groupId} value={group.groupId}>
                  {displayGroupName(group.groupId, group.groupName)}
                </option>
              ))}
            </select>
          </label>
          <div className="period-toggle" role="group" aria-label={t('dashboard.charts.title')}>
            {PERIODS.map(p => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                className={`period-tab ${period === p ? 'active' : ''}`}
                onClick={() => setPeriod(p)}
              >
                {t(`dashboard.charts.period.${p}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {groupId && (
        <div className="analytics-scope-note">
          Showing every metric below for <strong>{selectedGroupLabel}</strong>.
        </div>
      )}

      {isLoading ? (
        <div className="charts-empty">{t('common.loading')}</div>
      ) : isError ? (
        <div className="charts-empty">{t('dashboard.charts.error')}</div>
      ) : !hasData ? (
        <div className="charts-empty">{t('dashboard.charts.empty')}</div>
      ) : (
        <>
          <div className="analytics-metrics">
            {metricCards.map(({ label, value, detail, tooltip, icon: Icon, tone }) => (
              <div className={`analytics-metric ${tone}`} key={label}>
                <div className="metric-heading">
                  <span className="metric-title">
                    {label}
                    <WidgetTooltip text={tooltip} />
                  </span>
                  <Icon size={20} aria-hidden="true" />
                </div>
                <strong>{value}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
          <div className="active-chats-explanation">
            <strong>{t('analytics.activeChats', { defaultValue: 'Active chats' })}:</strong>{' '}
            {t('analytics.activeChatsExplanation', {
              defaultValue:
                'This counts different chat windows, not messages. If the same group has 1 message or 100 messages through one WhatsApp session, it counts as 1 active chat.',
            })}
          </div>
          <div className="charts-grid">
            <div className="chart-card chart-wide">
              <div className="chart-card-title">
                <h3>{t('dashboard.charts.overTime')}</h3>
                <WidgetTooltip
                  text={t('dashboard.tooltips.messagesOverTime', {
                    defaultValue:
                      'Compares sent and received message volume in hourly or daily buckets for the selected period.',
                  })}
                />
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={timeSeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#25d366" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#25d366" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gReceived" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="sent"
                    name={t('dashboard.charts.sent')}
                    stroke="#25d366"
                    fill="url(#gSent)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="received"
                    name={t('dashboard.charts.received')}
                    stroke="#3b82f6"
                    fill="url(#gReceived)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <div className="chart-card-title">
                <h3>{t('dashboard.charts.byType')}</h3>
                <WidgetTooltip
                  text={t('dashboard.tooltips.messagesByType', {
                    defaultValue:
                      'Breaks message activity down by content type, such as text, image, audio, or document.',
                  })}
                />
              </div>
              {byType.length === 0 ? (
                <div className="charts-empty small">{t('dashboard.charts.empty')}</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={byType}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {byType.map(entry => (
                        <Cell key={entry.name} fill={colorForType(entry.name)} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="chart-card chat-activity-card">
              <div className="chat-activity-header">
                <div className="chart-card-title">
                  <h3>{t('dashboard.charts.topChats')}</h3>
                  <WidgetTooltip
                    text={t('dashboard.tooltips.topChats', {
                      defaultValue:
                        'Search up to 1,000 of the most active chats by name or phone number. Activity is the chat’s share of all messages plus its most recent message time.',
                    })}
                  />
                </div>
                <input
                  value={chatSearch}
                  onChange={event => setChatSearch(event.target.value)}
                  placeholder={t('dashboard.charts.searchChats', { defaultValue: 'Search name or phone' })}
                  aria-label={t('dashboard.charts.searchChats', { defaultValue: 'Search name or phone' })}
                />
              </div>
              <p className="chat-activity-note">
                <strong>{t('dashboard.charts.fromThem', { defaultValue: 'From them' })}</strong>{' '}
                {t('dashboard.charts.fromThemExplanation', {
                  defaultValue: 'is how many messages that phone or chat sent to your WhatsApp account.',
                })}{' '}
                <strong>{t('dashboard.charts.activity', { defaultValue: 'Activity' })}</strong>{' '}
                {t('dashboard.charts.activityExplanation', {
                  defaultValue:
                    'is this chat’s percentage of all messages in the period, together with its latest message time.',
                })}
              </p>
              {chatActivity.length === 0 ? (
                <div className="charts-empty small">{t('dashboard.charts.empty')}</div>
              ) : visibleChatActivity.length === 0 ? (
                <div className="charts-empty small">
                  {t('dashboard.charts.noChatMatches', { defaultValue: 'No chats match your search.' })}
                </div>
              ) : (
                <div className="chat-activity-table">
                  <div className="chat-activity-row chat-activity-columns">
                    <span>{t('dashboard.charts.chatAndPhone', { defaultValue: 'Chat / phone' })}</span>
                    <span>{t('dashboard.charts.fromThem', { defaultValue: 'From them' })}</span>
                    <span>{t('dashboard.charts.replies', { defaultValue: 'Replies' })}</span>
                    <span>{t('dashboard.charts.total', { defaultValue: 'Total' })}</span>
                    <span>{t('dashboard.charts.activity', { defaultValue: 'Activity' })}</span>
                  </div>
                  {visibleChatActivity.map(chat => (
                    <div className="chat-activity-row" key={chat.chatId}>
                      <span className="chat-activity-name" title={chat.chatId}>
                        <strong>{chat.name}</strong>
                        <small>{chat.address}</small>
                      </span>
                      <span>{chat.received.toLocaleString()}</span>
                      <span>{chat.sent.toLocaleString()}</span>
                      <span>{chat.messageCount.toLocaleString()}</span>
                      <span className="chat-activity-value">
                        <strong>{chat.activityShare.toFixed(1)}%</strong>
                        <small>{formatLastActive(chat.lastActive)}</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="group-breakdown-card">
            <div className="group-breakdown-header">
              <div className="chart-card-title">
                <h3>{t('dashboard.charts.groupBreakdown', { defaultValue: 'Group breakdown' })}</h3>
                <WidgetTooltip
                  text={t('dashboard.tooltips.groupBreakdown', {
                    defaultValue:
                      'Shows sent, received, and total message volume for every WhatsApp group active in this period. Select a group to apply it to all analytics above.',
                  })}
                />
              </div>
              <input
                value={groupSearch}
                onChange={event => setGroupSearch(event.target.value)}
                placeholder={t('dashboard.charts.searchGroups', { defaultValue: 'Search groups' })}
                aria-label={t('dashboard.charts.searchGroups', { defaultValue: 'Search groups' })}
              />
            </div>
            <p className="group-breakdown-note">
              <strong>Message share</strong> = this group’s total messages ÷ messages across all groups in the selected
              period. Direct messages are not included in this percentage.
            </p>
            {groupBreakdown.length === 0 ? (
              <div className="charts-empty small">No group activity in this period.</div>
            ) : visibleGroups.length === 0 ? (
              <div className="charts-empty small">No groups match your search.</div>
            ) : (
              <div className="group-breakdown-table">
                <div className="group-breakdown-row group-breakdown-columns">
                  <span>Group</span>
                  <span>Sent</span>
                  <span>Received</span>
                  <span>Total</span>
                  <span>Message share</span>
                </div>
                {visibleGroups.map(group => (
                  <button
                    type="button"
                    key={group.groupId}
                    className={`group-breakdown-row ${group.groupId === groupId ? 'selected' : ''}`}
                    onClick={() => setGroupId(group.groupId)}
                    aria-pressed={group.groupId === groupId}
                  >
                    <span className="group-breakdown-name" title={group.groupId}>
                      <strong>{displayGroupName(group.groupId, group.groupName)}</strong>
                    </span>
                    <span>{group.sent.toLocaleString()}</span>
                    <span>{group.received.toLocaleString()}</span>
                    <span>{group.total.toLocaleString()}</span>
                    <span>
                      {allGroupMessages > 0 ? `${((group.total / allGroupMessages) * 100).toFixed(1)}%` : '0%'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
