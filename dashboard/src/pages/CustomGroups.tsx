import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Database,
  Edit3,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import {
  useCreateCustomGroupMutation,
  useCustomGroupSupabaseSourceQuery,
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
type GroupPageTab = 'supabase' | 'whatsapp' | 'saved';
type MultiSelectOption = { value: string; label: string };
const EMPTY_GROUP_NAMES: string[] = [];
const EMPTY_GROUP_IDS: string[] = [];
const EMPTY_PROGRAMS: Array<{ id: string; name: string }> = [];

function SearchableMultiSelect({
  label,
  options,
  selectedValues,
  onChange,
  placeholder,
}: {
  label: string;
  options: MultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredOptions = options.filter(option => option.label.toLocaleLowerCase().includes(normalizedSearch));
  const selectedSet = new Set(selectedValues);
  const allVisibleSelected =
    filteredOptions.length > 0 && filteredOptions.every(option => selectedSet.has(option.value));

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleValues = new Set(filteredOptions.map(option => option.value));
      onChange(selectedValues.filter(value => !visibleValues.has(value)));
      return;
    }
    onChange([...new Set([...selectedValues, ...filteredOptions.map(option => option.value)])]);
  };

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="custom-groups-multi-field">
      <span>{label}</span>
      <button
        type="button"
        className="custom-groups-multi-trigger"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span>
          {selectedValues.length
            ? `${selectedValues.length} selected`
            : options.length
              ? placeholder
              : `No ${label.toLocaleLowerCase()} available`}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          className="custom-groups-picker-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <section
            className="custom-groups-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Select ${label}`}
          >
            <header>
              <div>
                <h3>Select {label}</h3>
                <span>
                  {selectedValues.length} of {options.length} selected
                </span>
              </div>
              <button type="button" className="btn-icon" onClick={() => setIsOpen(false)} aria-label="Close">
                <X size={19} />
              </button>
            </header>
            <div className="custom-groups-multi-menu">
              <label className="custom-groups-multi-search">
                <Search size={17} aria-hidden="true" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder={`Search ${label.toLocaleLowerCase()}`}
                  aria-label={`Search ${label.toLocaleLowerCase()}`}
                  autoFocus
                />
              </label>
              <div className="custom-groups-multi-actions">
                <span>
                  {filteredOptions.length} result{filteredOptions.length === 1 ? '' : 's'}
                </span>
                <div>
                  <button type="button" onClick={toggleAllVisible} disabled={filteredOptions.length === 0}>
                    {allVisibleSelected ? 'Clear visible' : 'Select all'}
                  </button>
                  <button type="button" onClick={() => onChange([])} disabled={selectedValues.length === 0}>
                    Clear
                  </button>
                </div>
              </div>
              <div className="custom-groups-multi-options">
                {filteredOptions.length === 0 ? (
                  <small>No matches found</small>
                ) : (
                  filteredOptions.map(option => {
                    const selected = selectedSet.has(option.value);
                    return (
                      <button
                        type="button"
                        key={option.value}
                        role="checkbox"
                        aria-checked={selected}
                        className={selected ? 'selected' : ''}
                        onClick={() =>
                          onChange(
                            selected
                              ? selectedValues.filter(value => value !== option.value)
                              : [...selectedValues, option.value],
                          )
                        }
                      >
                        <span className="custom-groups-multi-check">{selected && <Check size={14} />}</span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <footer>
              <button type="button" className="btn-primary" onClick={() => setIsOpen(false)}>
                Done
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

export function CustomGroups() {
  useDocumentTitle('Target Groups');
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
  const [sourceTab, setSourceTab] = useState<GroupPageTab>('supabase');
  const [selectedProgramIds, setSelectedProgramIds] = useState<string[]>([]);
  const [selectedSchoolGroups, setSelectedSchoolGroups] = useState<string[]>([]);

  useEffect(() => {
    if (!sessionId && sessions.length) setSessionId(sessions[0].id);
  }, [sessionId, sessions]);

  const {
    data: groups = [],
    isLoading: loadingGroups,
    isError: groupsError,
  } = useSessionGroupsQuery(sessionId, !!sessionId);
  const { data: customGroups = [], isLoading: loadingCustomGroups } = useCustomGroupsQuery(sessionId, !!sessionId);
  const supabaseSource = useCustomGroupSupabaseSourceQuery(
    sessionId,
    selectedProgramIds,
    selectedSchoolGroups,
    sourceTab === 'supabase',
  );
  const createMutation = useCreateCustomGroupMutation();
  const updateMutation = useUpdateCustomGroupMutation();
  const deleteMutation = useDeleteCustomGroupMutation();

  const pastedNames = useMemo(() => parsePastedGroupNames(pastedGroupNames), [pastedGroupNames]);
  const pastedMatches = useMemo(() => matchGroupsByNames(groups, pastedNames), [groups, pastedNames]);
  const supabasePrograms = supabaseSource.data?.programs ?? EMPTY_PROGRAMS;
  const supabaseGroupNames = supabaseSource.data?.groupNames ?? EMPTY_GROUP_NAMES;
  const supabaseMappedGroupIds = supabaseSource.isFetching
    ? EMPTY_GROUP_IDS
    : (supabaseSource.data?.mappedGroupIds ?? EMPTY_GROUP_IDS);
  const supabaseMappedGroupIdSet = useMemo(() => new Set(supabaseMappedGroupIds), [supabaseMappedGroupIds]);
  const supabaseMatchedGroups = useMemo(
    () => groups.filter(group => supabaseMappedGroupIdSet.has(group.id)),
    [groups, supabaseMappedGroupIdSet],
  );
  const unmatchedSupabaseGroupIds = useMemo(() => {
    const availableIds = new Set(groups.map(group => group.id));
    return supabaseMappedGroupIds.filter(id => !availableIds.has(id));
  }, [groups, supabaseMappedGroupIds]);
  const activeCollectionSource = sourceTab === 'supabase' ? 'supabase' : 'custom';
  const programOptions = useMemo(
    () => supabasePrograms.map(program => ({ value: program.id, label: program.name })),
    [supabasePrograms],
  );
  const blockOptions = useMemo(
    () => supabaseGroupNames.map(groupName => ({ value: groupName, label: groupName })),
    [supabaseGroupNames],
  );
  const filteredGroups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const pastedMatchIds = new Set(pastedMatches.matchedGroups.map(group => group.id));
    return groups.filter(
      group =>
        (!query || group.name.toLowerCase().includes(query)) &&
        (sourceTab === 'supabase'
          ? selectedProgramIds.length > 0 && selectedSchoolGroups.length > 0 && supabaseMappedGroupIdSet.has(group.id)
          : pastedNames.length === 0 || pastedMatchIds.has(group.id)),
    );
  }, [
    filter,
    groups,
    pastedMatches,
    pastedNames,
    selectedProgramIds.length,
    selectedSchoolGroups.length,
    sourceTab,
    supabaseMappedGroupIdSet,
  ]);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const resetForm = () => {
    setName('');
    setSelectedIds([]);
    setEditing(null);
    setFilter('');
    setPastedGroupNames('');
    setSelectedProgramIds([]);
    setSelectedSchoolGroups([]);
  };

  const startEdit = (collection: CustomGroup) => {
    setEditing(collection);
    setName(collection.name);
    setSelectedIds(collection.groupIds);
    setFilter('');
    setPastedGroupNames('');
    setSourceTab(collection.source === 'supabase' ? 'supabase' : 'whatsapp');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectSourceTab = (tab: GroupPageTab) => {
    if (tab === sourceTab) return;
    resetForm();
    setSourceTab(tab);
  };

  const toggleGroup = (id: string) => {
    setSelectedIds(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]));
  };

  const selectPastedMatches = () => {
    setSelectedIds(current => [...new Set([...current, ...pastedMatches.matchedGroups.map(group => group.id)])]);
  };

  const selectSupabaseMatches = () => {
    setSelectedIds(current => [...new Set([...current, ...supabaseMatchedGroups.map(group => group.id)])]);
  };

  const selectPrograms = (programIds: string[]) => {
    setSelectedProgramIds(programIds);
    setSelectedSchoolGroups([]);
    setSelectedIds([]);
  };

  const selectBlocks = (groupNames: string[]) => {
    setSelectedSchoolGroups(groupNames);
    setSelectedIds([]);
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
        await createMutation.mutateAsync({
          sessionId,
          data: { name: name.trim(), groupIds: selectedIds, source: activeCollectionSource },
        });
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
        title="Target Groups"
        subtitle="Build reusable targets from programs or select individual WhatsApp groups."
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
        <>
          <div className="custom-groups-source-tabs" role="tablist" aria-label="Group creation type">
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'supabase'}
              className={sourceTab === 'supabase' ? 'active' : ''}
              onClick={() => selectSourceTab('supabase')}
            >
              <Database size={17} /> Program Target
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'whatsapp'}
              className={sourceTab === 'whatsapp' ? 'active' : ''}
              onClick={() => selectSourceTab('whatsapp')}
            >
              <UsersRound size={17} /> Individual Target
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'saved'}
              className={sourceTab === 'saved' ? 'active' : ''}
              onClick={() => selectSourceTab('saved')}
            >
              <Layers3 size={17} /> Saved Groups
            </button>
          </div>

          <div className="custom-groups-layout">
            {sourceTab !== 'saved' ? (
              <section className="custom-groups-panel custom-groups-form-panel">
                <div className="custom-groups-panel-header">
                  <div>
                    <h2>
                      {editing
                        ? 'Edit collection'
                        : sourceTab === 'supabase'
                          ? 'Create program target'
                          : 'Create individual target'}
                    </h2>
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
                  {sourceTab === 'whatsapp' ? (
                    <div className="custom-groups-bulk-search" role="tabpanel">
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
                  ) : (
                    <div className="custom-groups-supabase" role="tabpanel">
                      <div className="custom-groups-supabase-heading">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void supabaseSource.refetch()}
                          disabled={supabaseSource.isFetching}
                        >
                          {supabaseSource.isFetching ? (
                            <Loader2 className="animate-spin" size={15} />
                          ) : (
                            <RefreshCw size={15} />
                          )}
                          Refresh
                        </button>
                      </div>
                      {supabaseSource.isLoading ? (
                        <div className="custom-groups-inline-loading">
                          <Loader2 className="animate-spin" size={22} />
                        </div>
                      ) : supabaseSource.isError ? (
                        <p className="custom-groups-source-error">
                          {supabaseSource.error instanceof Error
                            ? supabaseSource.error.message
                            : 'Unable to load the Supabase source.'}
                        </p>
                      ) : !supabaseSource.data?.configured ? (
                        <div className="custom-groups-supabase-setup">
                          <p>Configure the Supabase credentials in the server `.env`, then restart the API:</p>
                          <code>SUPABASE_URL</code>
                          <code>SUPABASE_SERVICE_ROLE_KEY</code>
                        </div>
                      ) : (
                        <>
                          <SearchableMultiSelect
                            label="Programs"
                            options={programOptions}
                            selectedValues={selectedProgramIds}
                            onChange={selectPrograms}
                            placeholder="Select programs"
                          />

                          {selectedProgramIds.length > 0 && (
                            <SearchableMultiSelect
                              key={[...selectedProgramIds].sort().join(',')}
                              label="Blocks"
                              options={blockOptions}
                              selectedValues={selectedSchoolGroups}
                              onChange={selectBlocks}
                              placeholder={supabaseSource.isFetching ? 'Loading blocks…' : 'Select blocks'}
                            />
                          )}

                          {selectedSchoolGroups.length > 0 && (
                            <div className="custom-groups-match-summary" aria-live="polite">
                              <span>
                                {supabaseSource.isFetching
                                  ? 'Loading mapped class groups…'
                                  : `${supabaseMatchedGroups.length} of ${supabaseMappedGroupIds.length} mapped WhatsApp group${supabaseMappedGroupIds.length === 1 ? '' : 's'} available`}
                              </span>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={selectSupabaseMatches}
                                disabled={!canWrite || supabaseSource.isFetching || supabaseMatchedGroups.length === 0}
                              >
                                Select all mapped groups
                              </button>
                            </div>
                          )}
                          {selectedSchoolGroups.length > 0 && unmatchedSupabaseGroupIds.length > 0 && (
                            <details className="custom-groups-unmatched">
                              <summary>
                                {unmatchedSupabaseGroupIds.length} mapped group ID
                                {unmatchedSupabaseGroupIds.length === 1 ? '' : 's'} not available in this WhatsApp
                                session
                              </summary>
                              <div>
                                {unmatchedSupabaseGroupIds.map(groupId => (
                                  <span key={groupId}>{groupId}</span>
                                ))}
                              </div>
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  )}
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
                  <div className="custom-groups-options">
                    {loadingGroups ||
                    (sourceTab === 'supabase' && selectedSchoolGroups.length > 0 && supabaseSource.isFetching) ? (
                      <div className="custom-groups-inline-loading">
                        <Loader2 className="animate-spin" size={22} />
                      </div>
                    ) : groupsError ? (
                      <p className="custom-groups-muted">Unable to load groups. Make sure the session is connected.</p>
                    ) : sourceTab === 'supabase' && selectedProgramIds.length === 0 ? (
                      <p className="custom-groups-muted">Select one or more programs to continue.</p>
                    ) : sourceTab === 'supabase' && selectedSchoolGroups.length === 0 ? (
                      <p className="custom-groups-muted">Select one or more blocks to view mapped WhatsApp groups.</p>
                    ) : filteredGroups.length === 0 ? (
                      <p className="custom-groups-muted">
                        {sourceTab === 'supabase'
                          ? 'No mapped WhatsApp groups are available for the selected programs and blocks.'
                          : 'No groups found.'}
                      </p>
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
                    {editing
                      ? 'Save changes'
                      : sourceTab === 'supabase'
                        ? 'Create program target'
                        : 'Create individual target'}
                  </button>
                </div>
              </section>
            ) : (
              <section className="custom-groups-panel custom-groups-list-panel">
                <div className="custom-groups-panel-header">
                  <div>
                    <h2>Saved groups</h2>
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
                  <div className="custom-groups-muted custom-groups-no-items">
                    Saved program and individual targets will appear here.
                  </div>
                ) : (
                  <div className="custom-groups-list">
                    {customGroups.map(collection => (
                      <article className="custom-group-card" key={collection.id}>
                        <div className="custom-group-card-main">
                          <span className="custom-group-source-badge">
                            {collection.source === 'supabase' ? 'Program Target' : 'Individual Target'}
                          </span>
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
            )}
          </div>
        </>
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
