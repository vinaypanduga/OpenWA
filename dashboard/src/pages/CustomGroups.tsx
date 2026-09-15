import { useEffect, useMemo, useState } from 'react';
import { Edit3, Layers3, Loader2, Plus, Trash2, UsersRound } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import {
  useCreateCustomGroupMutation,
  useCustomGroupsQuery,
  useDeleteCustomGroupMutation,
  useSessionGroupsQuery,
  useSessionsQuery,
  useUpdateCustomGroupMutation,
} from '../hooks/queries';
import type { CustomGroup } from '../services/api';
import { matchGroupsByNames, parsePastedGroupNames } from '../utils/groupNameSearch';
import './CustomGroups.css';

type GroupOption = { id: string; name: string };

export function CustomGroups() {
  useDocumentTitle('Custom Groups');
  const { canWrite } = useRole();
  const toast = useToast();
  const { data: sessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const [sessionId, setSessionId] = useState('');
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<CustomGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomGroup | null>(null);
  const [filter, setFilter] = useState('');
  const [pastedGroupNames, setPastedGroupNames] = useState('');

  useEffect(() => {
    if (!sessionId && sessions.length) setSessionId(sessions[0].id);
  }, [sessionId, sessions]);

  const {
    data: groups = [],
    isLoading: loadingGroups,
    isError: groupsError,
  } = useSessionGroupsQuery(sessionId, !!sessionId);
  const { data: customGroups = [], isLoading: loadingCustomGroups } = useCustomGroupsQuery(sessionId, !!sessionId);
  const createMutation = useCreateCustomGroupMutation();
  const updateMutation = useUpdateCustomGroupMutation();
  const deleteMutation = useDeleteCustomGroupMutation();

  const pastedNames = useMemo(() => parsePastedGroupNames(pastedGroupNames), [pastedGroupNames]);
  const pastedMatches = useMemo(() => matchGroupsByNames(groups, pastedNames), [groups, pastedNames]);
  const filteredGroups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const bulkMatchIds = new Set(pastedMatches.matchedGroups.map(group => group.id));
    return groups.filter(
      group =>
        (!query || group.name.toLowerCase().includes(query)) &&
        (pastedNames.length === 0 || bulkMatchIds.has(group.id)),
    );
  }, [filter, groups, pastedMatches.matchedGroups, pastedNames.length]);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const resetForm = () => {
    setName('');
    setSelectedIds([]);
    setEditing(null);
    setFilter('');
    setPastedGroupNames('');
  };

  const startEdit = (collection: CustomGroup) => {
    setEditing(collection);
    setName(collection.name);
    setSelectedIds(collection.groupIds);
    setFilter('');
    setPastedGroupNames('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleGroup = (id: string) => {
    setSelectedIds(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]));
  };

  const selectPastedMatches = () => {
    setSelectedIds(current => [...new Set([...current, ...pastedMatches.matchedGroups.map(group => group.id)])]);
  };

  const save = async () => {
    if (!sessionId || !name.trim() || selectedIds.length === 0) return;
    try {
      if (editing) {
        await updateMutation.mutateAsync({
          sessionId,
          id: editing.id,
          data: { name: name.trim(), groupIds: selectedIds },
        });
        toast.success('Custom group updated');
      } else {
        await createMutation.mutateAsync({ sessionId, data: { name: name.trim(), groupIds: selectedIds } });
        toast.success('Custom group created');
      }
      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save custom group');
    }
  };

  const remove = async () => {
    if (!sessionId || !deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ sessionId, id: deleteTarget.id });
      toast.success('Custom group deleted');
      if (editing?.id === deleteTarget.id) resetForm();
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete custom group');
    }
  };

  const groupNameById = useMemo(() => new Map(groups.map(group => [group.id, group.name])), [groups]);
  const selectedSession = sessions.find(session => session.id === sessionId);

  if (loadingSessions) {
    return (
      <div className="custom-groups-page custom-groups-loading">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="custom-groups-page">
      <PageHeader
        title="Custom Groups"
        subtitle="Create reusable collections by selecting multiple WhatsApp groups."
        actions={
          <select
            className="custom-groups-session-select"
            value={sessionId}
            onChange={event => {
              setSessionId(event.target.value);
              resetForm();
            }}
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
        <div className="custom-groups-empty">
          <UsersRound size={48} strokeWidth={1} />
          <h3>No sessions available</h3>
          <p>Create and connect a session before managing custom groups.</p>
        </div>
      ) : (
        <div className="custom-groups-layout">
          <section className="custom-groups-panel custom-groups-form-panel">
            <div className="custom-groups-panel-header">
              <div>
                <h2>{editing ? 'Edit collection' : 'New collection'}</h2>
                <p>{selectedSession?.name}</p>
              </div>
              {editing && (
                <button className="btn-secondary" onClick={resetForm}>
                  Cancel
                </button>
              )}
            </div>
            <div className="custom-groups-form">
              <label className="form-group">
                <span>Collection name</span>
                <input
                  value={name}
                  maxLength={100}
                  onChange={event => setName(event.target.value)}
                  placeholder="e.g. Marketing groups"
                  disabled={!canWrite}
                />
              </label>
              <div className="custom-groups-selection-header">
                <div>
                  <strong>Select groups</strong>
                  <span>{selectedIds.length} selected</span>
                </div>
                <input
                  value={filter}
                  onChange={event => setFilter(event.target.value)}
                  placeholder="Filter groups"
                  aria-label="Filter groups"
                />
              </div>
              <div className="custom-groups-bulk-search">
                <label htmlFor="custom-groups-pasted-names">Paste group names from Excel</label>
                <textarea
                  id="custom-groups-pasted-names"
                  value={pastedGroupNames}
                  onChange={event => setPastedGroupNames(event.target.value)}
                  placeholder={'Class A Parents\nClass B Parents\nClass C Parents'}
                  rows={5}
                />
                <p>Paste one or more Excel cells. Each row or tab is searched as a separate group name.</p>
                {pastedNames.length > 0 && (
                  <div className="custom-groups-match-summary" aria-live="polite">
                    <span>
                      {pastedMatches.matchedGroups.length} group
                      {pastedMatches.matchedGroups.length === 1 ? '' : 's'} found for{' '}
                      {pastedMatches.matchedNames.length} of {pastedNames.length} name
                      {pastedNames.length === 1 ? '' : 's'}
                    </span>
                    <div className="custom-groups-match-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={selectPastedMatches}
                        disabled={!canWrite || pastedMatches.matchedGroups.length === 0}
                      >
                        Select all matches
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setPastedGroupNames('')}>
                        Clear
                      </button>
                    </div>
                  </div>
                )}
                {pastedMatches.unmatchedNames.length > 0 && (
                  <details className="custom-groups-unmatched">
                    <summary>
                      {pastedMatches.unmatchedNames.length} name
                      {pastedMatches.unmatchedNames.length === 1 ? '' : 's'} not found
                    </summary>
                    <div>
                      {pastedMatches.unmatchedNames.map(groupName => (
                        <span key={groupName}>{groupName}</span>
                      ))}
                    </div>
                  </details>
                )}
              </div>
              <div className="custom-groups-options">
                {loadingGroups ? (
                  <div className="custom-groups-inline-loading">
                    <Loader2 className="animate-spin" size={22} />
                  </div>
                ) : groupsError ? (
                  <p className="custom-groups-muted">Unable to load groups. Make sure the session is connected.</p>
                ) : filteredGroups.length === 0 ? (
                  <p className="custom-groups-muted">No groups found.</p>
                ) : (
                  filteredGroups.map((group: GroupOption) => (
                    <label
                      key={group.id}
                      className={`custom-group-option ${selectedIds.includes(group.id) ? 'selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(group.id)}
                        onChange={() => toggleGroup(group.id)}
                        disabled={!canWrite}
                      />
                      <span>{group.name}</span>
                    </label>
                  ))
                )}
              </div>
              <button
                className="btn-primary custom-groups-save"
                onClick={save}
                disabled={!canWrite || isSaving || !name.trim() || selectedIds.length === 0}
              >
                {isSaving ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />}
                {editing ? 'Save changes' : 'Create custom group'}
              </button>
            </div>
          </section>

          <section className="custom-groups-panel custom-groups-list-panel">
            <div className="custom-groups-panel-header">
              <div>
                <h2>Saved collections</h2>
                <p>
                  {customGroups.length} collection{customGroups.length === 1 ? '' : 's'}
                </p>
              </div>
              <Layers3 size={22} />
            </div>
            {loadingCustomGroups ? (
              <div className="custom-groups-inline-loading">
                <Loader2 className="animate-spin" size={24} />
              </div>
            ) : customGroups.length === 0 ? (
              <div className="custom-groups-muted custom-groups-no-items">Your saved collections will appear here.</div>
            ) : (
              <div className="custom-groups-list">
                {customGroups.map(collection => (
                  <article className="custom-group-card" key={collection.id}>
                    <div className="custom-group-card-main">
                      <h3>{collection.name}</h3>
                      <span>
                        {collection.groupIds.length} group{collection.groupIds.length === 1 ? '' : 's'}
                      </span>
                      <div className="custom-group-chips">
                        {collection.groupIds.map(id => (
                          <span key={id} title={id}>
                            {groupNameById.get(id) || id}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="custom-group-card-actions">
                      <button
                        className="btn-icon"
                        onClick={() => startEdit(collection)}
                        disabled={!canWrite}
                        aria-label={`Edit ${collection.name}`}
                      >
                        <Edit3 size={17} />
                      </button>
                      <button
                        className="btn-icon danger"
                        onClick={() => setDeleteTarget(collection)}
                        disabled={!canWrite}
                        aria-label={`Delete ${collection.name}`}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title="Delete custom group"
          className="modal-sm"
          footer={
            <>
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={remove} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? <Loader2 className="animate-spin" size={17} /> : <Trash2 size={17} />}Delete
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{deleteTarget.name}</strong>? This only removes the collection; your WhatsApp groups are not
            affected.
          </p>
        </Modal>
      )}
    </div>
  );
}
