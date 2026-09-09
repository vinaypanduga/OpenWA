import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Send, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import {
  useCancelScheduledMessageMutation,
  useCreateScheduledMessageMutation,
  useCustomGroupsQuery,
  useScheduledMessagesQuery,
  useSessionsQuery,
} from '../hooks/queries';
import type { ScheduledMessageScheduleType, ScheduledMessageType } from '../services/api';
import './ScheduledMessages.css';

const toLocalInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const toLocalTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const scheduledMessagePreview = (messageType: ScheduledMessageType, content: Record<string, unknown>) => {
  if (messageType === 'text') return typeof content.text === 'string' ? content.text : '';

  const caption = typeof content.caption === 'string' ? content.caption.trim() : '';
  const media = content[messageType];
  if (caption) return caption;
  if (!media || typeof media !== 'object') return `${messageType} message`;

  const { filename, url, base64 } = media as Record<string, unknown>;
  if (typeof filename === 'string' && filename.trim()) return filename;
  if (typeof url === 'string' && url.trim()) return url;
  if (typeof base64 === 'string' && base64) return `Uploaded ${messageType}`;
  return `${messageType} message`;
};

export function ScheduledMessages() {
  useDocumentTitle('Scheduled Messages');
  const { canWrite } = useRole();
  const toast = useToast();
  const { data: sessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const [sessionId, setSessionId] = useState('');
  const [customGroupId, setCustomGroupId] = useState('');
  const [name, setName] = useState('');
  const [messageType, setMessageType] = useState<ScheduledMessageType>('video');
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduledMessageScheduleType>('once');
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(new Date(Date.now() + 5 * 60_000)));
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([new Date().getDay()]);
  const [recurrenceTime, setRecurrenceTime] = useState(() => toLocalTime(new Date(Date.now() + 5 * 60_000)));
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [minDelaySeconds, setMinDelaySeconds] = useState(2);
  const [maxDelaySeconds, setMaxDelaySeconds] = useState(10);

  useEffect(() => {
    if (!sessionId && sessions.length) setSessionId(sessions[0].id);
  }, [sessionId, sessions]);

  const { data: customGroups = [], isLoading: loadingCustomGroups } = useCustomGroupsQuery(sessionId, !!sessionId);
  const { data: schedules = [], isLoading: loadingSchedules } = useScheduledMessagesQuery(sessionId, !!sessionId);
  const createMutation = useCreateScheduledMessageMutation();
  const cancelMutation = useCancelScheduledMessageMutation();
  const customGroupNameById = useMemo(() => new Map(customGroups.map(group => [group.id, group.name])), [customGroups]);

  useEffect(() => {
    if (!customGroupId && customGroups.length) setCustomGroupId(customGroups[0].id);
    if (customGroupId && !customGroups.some(group => group.id === customGroupId))
      setCustomGroupId(customGroups[0]?.id || '');
  }, [customGroupId, customGroups]);

  const save = async () => {
    if (!sessionId || !customGroupId || !name.trim()) return;
    let scheduledAtIso: string | undefined;
    if (scheduleType === 'once') {
      const localDate = new Date(scheduledAt);
      if (Number.isNaN(localDate.getTime()) || localDate.getTime() <= Date.now()) {
        toast.error('Choose a future date and time');
        return;
      }
      scheduledAtIso = localDate.toISOString();
    } else if (!recurrenceDays.length) {
      toast.error('Select at least one weekday');
      return;
    }
    const content =
      messageType === 'text'
        ? { text: text.trim() }
        : { [messageType]: { url: mediaUrl.trim() }, caption: caption.trim() || undefined };
    try {
      await createMutation.mutateAsync({
        sessionId,
        data: {
          name: name.trim(),
          customGroupId,
          messageType,
          content,
          scheduledAt: scheduledAtIso,
          scheduleType,
          recurrenceDays: scheduleType === 'weekly' ? recurrenceDays : undefined,
          recurrenceTime: scheduleType === 'weekly' ? recurrenceTime : undefined,
          timezone: scheduleType === 'weekly' ? timezone : undefined,
          minDelaySeconds,
          maxDelaySeconds,
        },
      });
      toast.success(scheduleType === 'weekly' ? 'Recurring message scheduled' : 'Message scheduled');
      setName('');
      setText('');
      setMediaUrl('');
      setCaption('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to schedule message');
    }
  };

  const toggleWeekday = (weekday: number) => {
    setRecurrenceDays(current =>
      current.includes(weekday) ? current.filter(value => value !== weekday) : [...current, weekday],
    );
  };

  const cancel = async (id: string, scheduleName: string) => {
    if (!window.confirm(`Cancel scheduled message “${scheduleName}”?`)) return;
    try {
      await cancelMutation.mutateAsync({ sessionId, id });
      toast.success('Scheduled message cancelled');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to cancel scheduled message');
    }
  };

  if (loadingSessions)
    return (
      <div className="scheduled-messages-page scheduled-messages-loading">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );

  return (
    <div className="scheduled-messages-page">
      <PageHeader
        title="Scheduled Messages"
        subtitle="The server sends these campaigns at the selected time—even when this site is closed."
        actions={
          <select
            className="scheduled-session-select"
            value={sessionId}
            onChange={event => setSessionId(event.target.value)}
            aria-label="Session"
          >
            {!sessions.length && <option value="">No sessions</option>}
            {sessions.map(session => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
        }
      />
      {!sessions.length ? (
        <div className="scheduled-messages-empty">
          <CalendarClock size={48} strokeWidth={1} />
          <h3>No sessions available</h3>
          <p>Connect a session before scheduling messages.</p>
        </div>
      ) : (
        <div className="scheduled-messages-layout">
          <section className="scheduled-panel">
            <div className="scheduled-panel-header">
              <div>
                <h2>Schedule a campaign</h2>
                <p>One message is sent to each group in the selected collection.</p>
              </div>
              <Send size={22} />
            </div>
            <div className="scheduled-form">
              <label className="form-group">
                <span>Campaign name</span>
                <input
                  value={name}
                  maxLength={100}
                  onChange={event => setName(event.target.value)}
                  placeholder="Weekly parent update"
                  disabled={!canWrite}
                />
              </label>
              <label className="form-group">
                <span>Custom group collection</span>
                <select
                  value={customGroupId}
                  onChange={event => setCustomGroupId(event.target.value)}
                  disabled={!canWrite || loadingCustomGroups || !customGroups.length}
                >
                  {!customGroups.length && <option value="">No custom groups found</option>}
                  {customGroups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.groupIds.length} groups)
                    </option>
                  ))}
                </select>
              </label>
              <div className="scheduled-two-columns">
                <label className="form-group">
                  <span>Message type</span>
                  <select
                    value={messageType}
                    onChange={event => setMessageType(event.target.value as ScheduledMessageType)}
                    disabled={!canWrite}
                  >
                    <option value="text">Text</option>
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                    <option value="audio">Audio</option>
                    <option value="document">Document</option>
                  </select>
                </label>
                <label className="form-group">
                  <span>Repeat</span>
                  <select
                    value={scheduleType}
                    onChange={event => setScheduleType(event.target.value as ScheduledMessageScheduleType)}
                    disabled={!canWrite}
                  >
                    <option value="once">Does not repeat</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </label>
              </div>
              {scheduleType === 'once' ? (
                <label className="form-group">
                  <span>Send at</span>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    min={toLocalInput(new Date())}
                    onChange={event => setScheduledAt(event.target.value)}
                    disabled={!canWrite}
                  />
                </label>
              ) : (
                <div className="scheduled-recurrence">
                  <div className="form-group">
                    <span>Repeat on</span>
                    <div className="scheduled-weekdays">
                      {WEEKDAYS.map(day => (
                        <button
                          key={day.value}
                          type="button"
                          className={recurrenceDays.includes(day.value) ? 'selected' : ''}
                          onClick={() => toggleWeekday(day.value)}
                          disabled={!canWrite}
                          aria-pressed={recurrenceDays.includes(day.value)}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="form-group">
                    <span>Send time</span>
                    <input
                      type="time"
                      value={recurrenceTime}
                      onChange={event => setRecurrenceTime(event.target.value)}
                      disabled={!canWrite}
                    />
                  </label>
                  <p className="scheduled-hint">
                    Timezone: {timezone}. The server automatically schedules each next run.
                  </p>
                </div>
              )}
              {messageType === 'text' ? (
                <label className="form-group">
                  <span>Message text</span>
                  <textarea
                    value={text}
                    maxLength={4096}
                    rows={5}
                    onChange={event => setText(event.target.value)}
                    placeholder="Write the message to send"
                    disabled={!canWrite}
                  />
                </label>
              ) : (
                <>
                  <label className="form-group">
                    <span>{messageType[0].toUpperCase() + messageType.slice(1)} URL</span>
                    <input
                      value={mediaUrl}
                      onChange={event => setMediaUrl(event.target.value)}
                      placeholder="https://example.com/media.mp4"
                      disabled={!canWrite}
                    />
                  </label>
                  <label className="form-group">
                    <span>Caption (optional)</span>
                    <textarea
                      value={caption}
                      maxLength={1024}
                      rows={4}
                      onChange={event => setCaption(event.target.value)}
                      placeholder="Add a caption"
                      disabled={!canWrite}
                    />
                  </label>
                </>
              )}
              <div className="scheduled-two-columns">
                <label className="form-group">
                  <span>Minimum jitter (seconds)</span>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={minDelaySeconds}
                    onChange={event => setMinDelaySeconds(Number(event.target.value))}
                    disabled={!canWrite}
                  />
                </label>
                <label className="form-group">
                  <span>Maximum jitter (seconds)</span>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={maxDelaySeconds}
                    onChange={event => setMaxDelaySeconds(Number(event.target.value))}
                    disabled={!canWrite}
                  />
                </label>
              </div>
              <p className="scheduled-hint">
                Each group receives the message after a fresh random delay between {minDelaySeconds} and{' '}
                {maxDelaySeconds} seconds.
              </p>
              <button
                className="btn-primary scheduled-save"
                onClick={save}
                disabled={
                  !canWrite ||
                  createMutation.isPending ||
                  !customGroupId ||
                  !name.trim() ||
                  (messageType === 'text' ? !text.trim() : !mediaUrl.trim()) ||
                  (scheduleType === 'weekly' && !recurrenceDays.length)
                }
              >
                {createMutation.isPending ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <CalendarClock size={17} />
                )}
                Schedule message
              </button>
            </div>
          </section>
          <section className="scheduled-panel">
            <div className="scheduled-panel-header">
              <div>
                <h2>Scheduled campaigns</h2>
                <p>
                  {schedules.length} campaign{schedules.length === 1 ? '' : 's'}
                </p>
              </div>
              <CalendarClock size={22} />
            </div>
            {loadingSchedules ? (
              <div className="scheduled-inline-loading">
                <Loader2 className="animate-spin" size={24} />
              </div>
            ) : schedules.length === 0 ? (
              <div className="scheduled-empty-list">No scheduled campaigns yet.</div>
            ) : (
              <div className="scheduled-list">
                {schedules.map(schedule => (
                  <article className="scheduled-card" key={schedule.id}>
                    <div>
                      <div className="scheduled-card-title">
                        <h3>{schedule.name}</h3>
                        <span className={`scheduled-status ${schedule.status}`}>{schedule.status}</span>
                      </div>
                      <p>
                        {schedule.messageType} · {customGroupNameById.get(schedule.customGroupId) || 'Custom group'} ·{' '}
                        {schedule.scheduleType === 'weekly' ? (
                          <>
                            Every{' '}
                            {WEEKDAYS.filter(day => schedule.recurrenceDays?.includes(day.value))
                              .map(day => day.label)
                              .join(', ')}{' '}
                            at {schedule.recurrenceTime} ({schedule.timezone}) · Next:{' '}
                          </>
                        ) : (
                          'Send: '
                        )}
                        {new Date(schedule.scheduledAt).toLocaleString()}
                      </p>
                      <div className="scheduled-card-message">
                        <span>Message</span>
                        <p>{scheduledMessagePreview(schedule.messageType, schedule.content)}</p>
                      </div>
                      <small>
                        Jitter: {schedule.minDelaySeconds}–{schedule.maxDelaySeconds}s
                        {schedule.scheduleType === 'weekly' ? ` · Runs: ${schedule.runCount}` : ''}
                        {schedule.error ? ` · ${schedule.error}` : ''}
                      </small>
                    </div>
                    {(schedule.status === 'pending' || schedule.status === 'processing') && (
                      <button
                        className="btn-icon danger"
                        onClick={() => cancel(schedule.id, schedule.name)}
                        disabled={!canWrite || cancelMutation.isPending}
                        aria-label={`Cancel ${schedule.name}`}
                      >
                        <Trash2 size={17} />
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
