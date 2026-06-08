import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  FileDown,
  Lightbulb,
  MapPin,
  NotebookPen,
  Plus,
  Save,
  Search,
  Split,
  Trash2,
  Upload,
  XCircle,
  Zap,
} from 'lucide-react';
import { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  addBranchGroup,
  addTakeaway,
  addTrade,
  createSession,
  deleteFlowBlock,
  getSessionBundle,
  listSessions,
  listTakeaways,
  listTradeScreenshots,
  listTrades,
  lockSession,
  selectBranch,
  updateFlowBlock,
  updateSession,
  updateTradeOutcome,
} from './repositories';
import {
  BlockType,
  BranchGroup,
  FlowBlock,
  ScreenshotAttachment,
  SessionBundle,
  Takeaway,
  TradeOutcome,
  TradeTaken,
  TradingSession,
  blockTypeLabels,
  tradeOutcomeLabels,
  tradeOutcomeOptions,
} from './types';

const blockTextPresets: Record<BlockType, string[]> = {
  zone: [
    'London Low',
    'London High',
    'Prior Day High',
    'Prior Day Low',
    'Prior Day Close',
    'Premarket High',
    'Premarket Low',
    'Key Zone',
    'Value Area High',
    'Value Area Low',
    'Naked POC',
  ],
  event: [
    'Tapped level',
    'Rejected strongly',
    'Closed through level',
    'Swept level',
    'Bounced from zone',
    'Failed to continue',
    'Moved to next key zone',
    'Returned to level',
  ],
  condition: [
    'Waiting for retracement and ASK bubble',
    'Waiting for retracement and BID bubble',
    'Waiting for rejection from level',
    'Waiting for continuation through level',
    'Waiting for pullback after close-through',
    'Waiting for reclaim',
  ],
  invalidation: [
    'Moves to next key zone without confirmation',
    'Returns to original level',
    'Closes deeply through level',
    'Fails to hold above level',
    'Fails to hold below level',
    'No bubble appears',
    'Price accepts beyond zone',
  ],
  entry: ['Long entry', 'Short entry', 'No trade'],
  takeaway: ['Takeaway marker'],
};

const blockTypes: BlockType[] = ['zone', 'event', 'condition', 'invalidation', 'entry'];

function submitFormOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/session/:id" element={<SessionPage />} />
      <Route path="/takeaways" element={<GlobalTakeawaysPage />} />
      <Route path="/trades" element={<TradeLogPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

function DashboardPage() {
  const [sessions, setSessions] = useState<TradingSession[]>([]);
  const [counts, setCounts] = useState<Record<string, { trades: number; takeaways: number }>>({});
  const navigate = useNavigate();

  const refresh = async () => {
    const records = await listSessions();
    setSessions(records);
    const entries = await Promise.all(
      records.map(async (session) => {
        const bundle = await getSessionBundle(session.id);
        return [session.id, { trades: bundle?.trades.length ?? 0, takeaways: bundle?.takeaways.length ?? 0 }] as const;
      }),
    );
    setCounts(Object.fromEntries(entries));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleNewSession = async () => {
    const session = await createSession();
    navigate(`/session/${session.id}`);
  };

  return (
    <main className="page-shell dashboard-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local-first decision journal</p>
          <h1>NQ Decision Flow</h1>
        </div>
        <nav className="top-actions">
          <Link to="/trades" className="button secondary">
            <ArrowDownUp size={18} /> Trade Log
          </Link>
          <Link to="/takeaways" className="button secondary">
            <Lightbulb size={18} /> Global Takeaways
          </Link>
          <button onClick={handleNewSession} className="button primary">
            <Plus size={18} /> New Session
          </button>
        </nav>
      </header>

      <section className="session-grid">
        {sessions.length === 0 ? (
          <div className="empty-state">
            <NotebookPen size={34} />
            <h2>No Sessions Yet</h2>
            <p>Create a session, write the market context, then build the live decision path as price acts.</p>
            <button onClick={handleNewSession} className="button primary">
              <Plus size={18} /> New Session
            </button>
          </div>
        ) : (
          sessions.map((session) => (
            <article className="session-card" key={session.id}>
              <div className="session-card-header">
                <div>
                  <p className="eyebrow">{formatDate(session.dateCreated)}</p>
                </div>
                <span className={`status-pill ${session.isLocked ? 'locked' : 'active'}`}>
                  {session.isLocked ? 'Read-only' : 'Active'}
                </span>
              </div>
              <p className="context-preview">
                {session.marketContextText || 'No market context entered yet.'}
              </p>
              <div className="card-meta">
                <span>{counts[session.id]?.takeaways ?? 0} takeaways</span>
                <span>{counts[session.id]?.trades ?? 0} trades</span>
              </div>
              <Link to={`/session/${session.id}`} className="button secondary full">
                Open Session <ChevronRight size={16} />
              </Link>
            </article>
          ))
        )}
      </section>
    </main>
  );
}

function SessionPage() {
  const { id } = useParams();
  const [bundle, setBundle] = useState<SessionBundle>();
  const [activeParentId, setActiveParentId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!id) return;
    const next = await getSessionBundle(id);
    setBundle(next);
    setLoading(false);
    if (next && !activeParentId) {
      setActiveParentId(deriveActiveBlockId(next.blocks));
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <main className="page-shell">Loading session...</main>;
  if (!bundle) return <Navigate to="/" replace />;

  const locked = bundle.session.isLocked;
  const activeBlock = activeParentId ? bundle.blocks.find((block) => block.id === activeParentId) : undefined;

  const persistSession = async (patch: Partial<TradingSession>) => {
    const session = await updateSession(bundle.session, patch);
    setBundle({ ...bundle, session });
  };

  const afterMutation = async (nextActive?: string | null) => {
    await refresh();
    if (nextActive !== undefined) setActiveParentId(nextActive ?? undefined);
  };

  const handleSave = async () => {
    if (!window.confirm('Save and lock this session? This will make it read-only.')) return;
    await lockSession(bundle.session.id);
    await afterMutation(activeParentId);
  };

  const handleDeleteBlock = async (blockId: string) => {
    if (!window.confirm('Delete this block and every block branching from it?')) return;
    const { deletedBlockIds, parentBlockId } = await deleteFlowBlock(blockId);
    const nextActive = activeParentId && deletedBlockIds.includes(activeParentId) ? parentBlockId ?? null : activeParentId;
    await afterMutation(nextActive);
  };

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div className="workspace-title">
          <Link to="/" className="text-link">
            Dashboard
          </Link>
          <h1>{bundle.session.instrument || 'NQ'} Live Decision Flow</h1>
          <span className={`status-pill ${locked ? 'locked' : 'active'}`}>
            {locked ? 'Read-only review' : 'Live Session'}
          </span>
        </div>
        <div className="top-actions">
          {locked && <PDFExportButton targetId="session-print-root" />}
          {!locked && (
            <button onClick={handleSave} className="button primary">
              <Save size={18} /> Save Session
            </button>
          )}
        </div>
      </header>

      <div className="workspace-grid" id="session-print-root">
        <section className="main-pane">
          <MarketContextEditor session={bundle.session} locked={locked} onChange={persistSession} />
          <FlowDiagram
            blocks={bundle.blocks}
            branchGroups={bundle.branchGroups}
            activeParentId={activeParentId}
            locked={locked}
            onSelectActive={setActiveParentId}
            onSelectBranch={async (groupId, blockId) => {
              await selectBranch(groupId, blockId);
              await afterMutation(blockId);
            }}
            onEditBlock={async (blockId, text) => {
              await updateFlowBlock(blockId, { text });
              await afterMutation(activeParentId);
            }}
            onDeleteBlock={handleDeleteBlock}
          />
        </section>

        <aside className="side-pane no-print">
          {!locked && (
            <div className="active-anchor">
              <p className="eyebrow">Active Build Point</p>
              <strong>{activeBlock ? blockTypeLabels[activeBlock.type] : 'Session root'}</strong>
              <span>{activeBlock?.text ?? 'New blocks will start a root flow.'}</span>
            </div>
          )}

          {!locked && (
            <BranchGroupPanel
              sessionId={bundle.session.id}
              activeParentId={activeParentId}
              onAdded={afterMutation}
            />
          )}

          <TradePanel
            session={bundle.session}
            blocks={bundle.blocks}
            trades={bundle.trades}
            screenshots={bundle.screenshots}
            locked={locked}
            onAdded={() => afterMutation(activeParentId)}
            onTradeOutcomeChange={async (tradeId, outcome) => {
              await updateTradeOutcome(tradeId, outcome);
              await afterMutation(activeParentId);
            }}
          />

          <TakeawayPanel
            session={bundle.session}
            takeaways={bundle.takeaways}
            locked={locked}
            onAdded={() => afterMutation(activeParentId)}
          />
        </aside>
      </div>
    </main>
  );
}

function MarketContextEditor({
  session,
  locked,
  onChange,
}: {
  session: TradingSession;
  locked: boolean;
  onChange: (patch: Partial<TradingSession>) => void;
}) {
  const [text, setText] = useState(session.marketContextText);

  useEffect(() => {
    setText(session.marketContextText);
  }, [session.id, session.marketContextText]);

  return (
    <section className="context-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Market Context</p>
          <h2>What is price doing and what are you waiting for?</h2>
        </div>
      </div>
      {locked ? (
        <p className="readonly-text">{session.marketContextText || 'No market context entered.'}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onChange({ marketContextText: text });
          }}
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={submitFormOnEnter}
            onBlur={() => onChange({ marketContextText: text })}
            placeholder="Premarket sold into London Low, tapped it, and rejected strongly. Watching whether pullback gives ASK bubble for long or whether price returns and closes through the level."
            rows={4}
          />
        </form>
      )}
    </section>
  );
}

function FlowDiagram({
  blocks,
  branchGroups,
  activeParentId,
  locked,
  onSelectActive,
  onSelectBranch,
  onEditBlock,
  onDeleteBlock,
}: {
  blocks: FlowBlock[];
  branchGroups: BranchGroup[];
  activeParentId?: string;
  locked: boolean;
  onSelectActive: (blockId?: string) => void;
  onSelectBranch: (groupId: string, blockId: string) => void;
  onEditBlock: (blockId: string, text: string) => void;
  onDeleteBlock: (blockId: string) => void;
}) {
  const blockMap = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);
  const groupMap = useMemo(() => new Map(branchGroups.map((group) => [group.id, group])), [branchGroups]);
  const rootBlocks = blocks.filter((block) => !block.parentBlockId).sort((a, b) => a.orderIndex - b.orderIndex);
  const renderedRootGroups = new Set<string>();

  return (
    <section className="flow-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Structured Flow</p>
          <h2>Decision Tree</h2>
        </div>
        {!locked && (
          <button onClick={() => onSelectActive(undefined)} className="button ghost">
            Add from Root
          </button>
        )}
      </div>

      {rootBlocks.length === 0 ? (
        <div className="empty-flow">
          <Split size={28} />
          <p>Add a Zone / Level block, then add events and branches as the session unfolds.</p>
        </div>
      ) : (
        <div className="tree-stack">
          {rootBlocks.map((block) => {
            if (block.branchGroupId) {
              if (renderedRootGroups.has(block.branchGroupId)) return null;
              renderedRootGroups.add(block.branchGroupId);
              const group = groupMap.get(block.branchGroupId);
              const branchBlocks =
                group?.branchBlockIds.map((id) => blockMap.get(id)).filter(Boolean) ??
                rootBlocks.filter((item) => item.branchGroupId === block.branchGroupId);
              return (
                <div className="branch-group root-branch-group" key={block.branchGroupId}>
                  <div className="branch-group-label">
                    <Split size={16} /> Possible Paths
                  </div>
                  <div className="branch-columns">
                    {(branchBlocks as FlowBlock[]).map((branchBlock) => (
                      <FlowNode
                        key={branchBlock.id}
                        block={branchBlock}
                        blockMap={blockMap}
                        groupMap={groupMap}
                        activeParentId={activeParentId}
                        locked={locked}
                        onSelectActive={onSelectActive}
                        onSelectBranch={onSelectBranch}
                        onEditBlock={onEditBlock}
                        onDeleteBlock={onDeleteBlock}
                      />
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <FlowNode
                key={block.id}
                block={block}
                blockMap={blockMap}
                groupMap={groupMap}
                activeParentId={activeParentId}
                locked={locked}
                onSelectActive={onSelectActive}
                onSelectBranch={onSelectBranch}
                onEditBlock={onEditBlock}
                onDeleteBlock={onDeleteBlock}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function FlowNode({
  block,
  blockMap,
  groupMap,
  activeParentId,
  locked,
  onSelectActive,
  onSelectBranch,
  onEditBlock,
  onDeleteBlock,
}: {
  block: FlowBlock;
  blockMap: Map<string, FlowBlock>;
  groupMap: Map<string, BranchGroup>;
  activeParentId?: string;
  locked: boolean;
  onSelectActive: (blockId: string) => void;
  onSelectBranch: (groupId: string, blockId: string) => void;
  onEditBlock: (blockId: string, text: string) => void;
  onDeleteBlock: (blockId: string) => void;
}) {
  const children = block.childBlockIds.map((id) => blockMap.get(id)).filter(Boolean) as FlowBlock[];
  const renderedGroups = new Set<string>();

  return (
    <div className="flow-node">
      <FlowBlockCard
        block={block}
        active={activeParentId === block.id}
        locked={locked}
        onSelectActive={() => onSelectActive(block.id)}
        onEdit={(text) => onEditBlock(block.id, text)}
        onDelete={() => onDeleteBlock(block.id)}
        onSelectBranch={block.branchGroupId ? () => onSelectBranch(block.branchGroupId!, block.id) : undefined}
      />
      {children.length > 0 && (
        <div className="children-line">
          {children.map((child) => {
            if (child.branchGroupId) {
              if (renderedGroups.has(child.branchGroupId)) return null;
              renderedGroups.add(child.branchGroupId);
              const group = groupMap.get(child.branchGroupId);
              const branchBlocks =
                group?.branchBlockIds.map((id) => blockMap.get(id)).filter(Boolean) ??
                children.filter((item) => item.branchGroupId === child.branchGroupId);
              return (
                <div className="branch-group" key={child.branchGroupId}>
                  <div className="branch-group-label">
                    <Split size={16} /> Possible Paths
                  </div>
                  <div className="branch-columns">
                    {(branchBlocks as FlowBlock[]).map((branchBlock) => (
                      <FlowNode
                        key={branchBlock.id}
                        block={branchBlock}
                        blockMap={blockMap}
                        groupMap={groupMap}
                        activeParentId={activeParentId}
                        locked={locked}
                        onSelectActive={onSelectActive}
                        onSelectBranch={onSelectBranch}
                        onEditBlock={onEditBlock}
                        onDeleteBlock={onDeleteBlock}
                      />
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <FlowNode
                key={child.id}
                block={child}
                blockMap={blockMap}
                groupMap={groupMap}
                activeParentId={activeParentId}
                locked={locked}
                onSelectActive={onSelectActive}
                onSelectBranch={onSelectBranch}
                onEditBlock={onEditBlock}
                onDeleteBlock={onDeleteBlock}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function FlowBlockCard({
  block,
  active,
  locked,
  onSelectActive,
  onSelectBranch,
  onEdit,
  onDelete,
}: {
  block: FlowBlock;
  active: boolean;
  locked: boolean;
  onSelectActive: () => void;
  onSelectBranch?: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(block.text);
  const Icon = blockIcon(block.type);

  useEffect(() => setText(block.text), [block.text]);

  const canSelectBranch = !locked && onSelectBranch && block.status === 'pending';
  const canMakeActive = !locked && !active && block.status !== 'inactive';

  return (
    <article className={`flow-card type-${block.type} status-${block.status} ${active ? 'active-card' : ''}`}>
      <div className="flow-card-top">
        <span className="type-label">
          <Icon size={16} /> {blockTypeLabels[block.type]}
        </span>
        <div className="flow-card-meta">
          {active && (
            <span className="active-point-badge">
              <CircleDot size={14} /> Active point
            </span>
          )}
          {!locked && (
            <button
              className="icon-button danger"
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${blockTypeLabels[block.type]} block`}
              title="Delete block"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onEdit(text.trim() || block.text);
            setEditing(false);
          }}
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={submitFormOnEnter}
            rows={3}
            autoFocus
          />
          <div className="inline-actions">
            <button className="button primary compact" type="submit">
              Save
            </button>
            <button className="button ghost compact" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="flow-text">{block.text}</p>
      )}
      {!locked && (
        <div className="flow-card-actions no-print">
          {canSelectBranch && (
            <button className="button primary compact" onClick={onSelectBranch}>
              <CheckCircle2 size={15} /> Happened
            </button>
          )}
          {canMakeActive && (
            <button className="button ghost compact" onClick={onSelectActive}>
              Build here
            </button>
          )}
          <button className="button ghost compact" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      )}
    </article>
  );
}

function BranchGroupPanel({
  sessionId,
  activeParentId,
  onAdded,
}: {
  sessionId: string;
  activeParentId?: string;
  onAdded: (nextActive?: string) => void;
}) {
  const [branches, setBranches] = useState([
    { type: 'condition' as BlockType, text: blockTextPresets.condition[0] },
    { type: 'invalidation' as BlockType, text: blockTextPresets.invalidation[0] },
  ]);

  const handleAddBranch = async () => {
    const valid = branches.filter((branch) => branch.text.trim()).slice(0, 3);
    if (valid.length === 0) return;
    await addBranchGroup({ sessionId, parentBlockId: activeParentId, branches: valid });
    onAdded(activeParentId);
  };

  return (
    <section className="tool-panel">
      <form
        className="branch-builder"
        onSubmit={(event) => {
          event.preventDefault();
          void handleAddBranch();
        }}
      >
        <div className="section-heading compact-heading">
          <h2>Add Branch Group</h2>
        </div>
        {branches.map((branch, index) => (
          <div className="branch-row" key={index}>
            <div className="branch-row-header">
              <span className="branch-path-label">Path {index + 1}</span>
              <select
                aria-label={`Block type for path ${index + 1}`}
                value={branch.type}
                onChange={(event) => {
                  const nextType = event.target.value as BlockType;
                  setBranches((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { type: nextType, text: blockTextPresets[nextType][0] } : item,
                    ),
                  );
                }}
              >
                {blockTypes.map((item) => (
                  <option value={item} key={item}>
                    {blockTypeLabels[item]}
                  </option>
                ))}
              </select>
            </div>
            <div className="chip-wrap" aria-label={`Preset options for path ${index + 1}`}>
              {blockTextPresets[branch.type].map((preset) => (
                <button
                  type="button"
                  className={`chip ${branch.text === preset ? 'selected' : ''}`}
                  key={preset}
                  aria-pressed={branch.text === preset}
                  onClick={() =>
                    setBranches((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, text: preset } : item,
                      ),
                    )
                  }
                >
                  {preset}
                </button>
              ))}
            </div>
            <textarea
              aria-label={`Text for path ${index + 1}`}
              value={branch.text}
              rows={2}
              onKeyDown={submitFormOnEnter}
              onChange={(event) =>
                setBranches((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, text: event.target.value } : item,
                  ),
                )
              }
            />
          </div>
        ))}
        <div className="inline-actions">
          {branches.length < 3 && (
            <button
              type="button"
              className="button ghost compact"
              onClick={() =>
                setBranches((current) => [
                  ...current,
                  { type: 'invalidation', text: blockTextPresets.invalidation[Math.min(current.length, 2)] },
                ])
              }
            >
              <Plus size={15} /> Path
            </button>
          )}
          {branches.length > 1 && (
            <button type="button" className="button ghost compact" onClick={() => setBranches((current) => current.slice(0, -1))}>
              <Trash2 size={15} /> Remove
            </button>
          )}
          <button type="submit" className="button secondary compact grow">
            <Split size={15} /> Add Branches
          </button>
        </div>
      </form>
    </section>
  );
}

function TradePanel({
  session,
  blocks,
  trades,
  screenshots,
  locked,
  onAdded,
  onTradeOutcomeChange,
}: {
  session: TradingSession;
  blocks: FlowBlock[];
  trades: TradeTaken[];
  screenshots: ScreenshotAttachment[];
  locked: boolean;
  onAdded: () => void;
  onTradeOutcomeChange: (tradeId: string, outcome: TradeOutcome) => void;
}) {
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [notes, setNotes] = useState('');
  const [relatedFlowBlockId, setRelatedFlowBlockId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const entryBlocks = blocks.filter((block) => block.type === 'entry');

  const appendFiles = (nextFiles: File[]) => {
    if (nextFiles.length === 0) return;
    setFiles((current) => [...current, ...nextFiles]);
  };

  const handlePaste = (event: ClipboardEvent<HTMLFormElement>) => {
    const pastedImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item, index) => {
        const file = item.getAsFile();
        if (!file) return undefined;
        const fallbackExtension = file.type.split('/')[1] || 'png';
        const filename = file.name || `pasted-screenshot-${Date.now()}-${index + 1}.${fallbackExtension}`;
        return new File([file], filename, { type: file.type, lastModified: file.lastModified });
      })
      .filter((file): file is File => Boolean(file));

    if (pastedImages.length === 0) return;
    event.preventDefault();
    appendFiles(pastedImages);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!notes.trim() && files.length === 0) return;
    await addTrade({
      sessionId: session.id,
      direction,
      notes: notes.trim(),
      relatedFlowBlockId: relatedFlowBlockId || undefined,
      screenshots: files,
    });
    setNotes('');
    setFiles([]);
    setRelatedFlowBlockId('');
    onAdded();
  };

  return (
    <section className="tool-panel trade-panel">
      <div className="section-heading compact-heading">
        <h2 className="inline-panel-title">
          <span>Trades Taken</span>
          <span className="title-link-wrap">
            (<Link to="/trades" className="text-link">View Trade Log</Link>)
          </span>
        </h2>
      </div>
      {!locked && (
        <form onSubmit={handleSubmit} onPaste={handlePaste} className="stacked-form">
          <div className="segmented two">
            <button type="button" className={direction === 'long' ? 'selected' : ''} onClick={() => setDirection('long')}>
              Long
            </button>
            <button type="button" className={direction === 'short' ? 'selected' : ''} onClick={() => setDirection('short')}>
              Short
            </button>
          </div>
          <select value={relatedFlowBlockId} onChange={(event) => setRelatedFlowBlockId(event.target.value)}>
            <option value="">Related entry block optional</option>
            {entryBlocks.map((block) => (
              <option value={block.id} key={block.id}>
                {block.text}
              </option>
            ))}
          </select>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onKeyDown={submitFormOnEnter}
            rows={3}
            placeholder="Decision notes only."
          />
          <label className="file-drop" tabIndex={0}>
            <Upload size={16} /> Screenshots
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                appendFiles(Array.from(event.target.files ?? []));
                event.currentTarget.value = '';
              }}
            />
          </label>
          {files.length > 0 && <p className="muted">{files.length} image(s) queued</p>}
          <button className="button primary full" type="submit">
            <ArrowRight size={17} /> Add Trade Note
          </button>
        </form>
      )}
      <div className="review-list">
        {trades.map((trade) => (
          <TradeReview
            key={trade.id}
            trade={trade}
            screenshots={screenshots.filter((shot) => shot.tradeId === trade.id)}
            locked={locked}
            onOutcomeChange={onTradeOutcomeChange}
          />
        ))}
        {trades.length === 0 && <p className="muted">No trades recorded.</p>}
      </div>
    </section>
  );
}

function TradeReview({
  trade,
  screenshots,
  locked,
  onOutcomeChange,
}: {
  trade: TradeTaken;
  screenshots: ScreenshotAttachment[];
  locked: boolean;
  onOutcomeChange: (tradeId: string, outcome: TradeOutcome) => void;
}) {
  return (
    <article className={`review-item ${trade.outcome ? `outcome-${trade.outcome}` : ''}`}>
      <div className="review-item-header">
        <div>
          <strong>{trade.direction.toUpperCase()}</strong>
          <span>{formatTime(trade.createdAt)}</span>
        </div>
        <select
          className="outcome-select"
          value={trade.outcome ?? ''}
          onChange={(event) => onOutcomeChange(trade.id, event.target.value as TradeOutcome)}
          disabled={locked}
          aria-label="Trade result"
        >
          <option value="" disabled>
            Result
          </option>
          {tradeOutcomeOptions.map((outcome) => (
            <option value={outcome} key={outcome}>
              {tradeOutcomeLabels[outcome]}
            </option>
          ))}
        </select>
      </div>
      <p>{trade.notes || 'No notes.'}</p>
      {screenshots.length > 0 && (
        <div className="screenshot-grid">
          {screenshots.map((shot) => (
            <ScreenshotImage key={shot.id} shot={shot} />
          ))}
        </div>
      )}
    </article>
  );
}

function ScreenshotImage({ shot }: { shot: ScreenshotAttachment }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(shot.localBlobReference);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [shot.localBlobReference]);

  return url ? <img src={url} alt={shot.filename} /> : null;
}

function TakeawayPanel({
  session,
  takeaways,
  locked,
  onAdded,
}: {
  session: TradingSession;
  takeaways: Takeaway[];
  locked: boolean;
  onAdded: () => void;
}) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    await addTakeaway({
      sessionId: session.id,
      sessionDate: session.dateCreated,
      text: text.trim(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    setText('');
    setTags('');
    onAdded();
  };

  return (
    <section className="tool-panel takeaway-panel">
      <div className="section-heading compact-heading">
        <h2 className="inline-panel-title">
          <span>Takeaways</span>
          <span className="title-link-wrap">
            (<Link to="/takeaways" className="text-link">View Global Takeaways</Link>)
          </span>
        </h2>
      </div>
      {!locked && (
        <form onSubmit={handleSubmit} className="stacked-form">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={submitFormOnEnter}
            rows={3}
            placeholder="Different-ink takeaway..."
          />
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tags optional, comma separated" />
          <button className="button gold full" type="submit">
            <Lightbulb size={17} /> Add Takeaway
          </button>
        </form>
      )}
      <div className="review-list">
        {takeaways.map((takeaway) => (
          <article className="review-item takeaway-review" key={takeaway.id}>
            <p>{takeaway.text}</p>
            {takeaway.tags?.length ? <span className="muted">{takeaway.tags.join(', ')}</span> : null}
          </article>
        ))}
        {takeaways.length === 0 && <p className="muted">No takeaways yet.</p>}
      </div>
    </section>
  );
}

function TradeLogPage() {
  const [trades, setTrades] = useState<TradeTaken[]>([]);
  const [sessions, setSessions] = useState<TradingSession[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotAttachment[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    Promise.all([listTrades(), listSessions()]).then(async ([nextTrades, nextSessions]) => {
      const nextScreenshots = await listTradeScreenshots(nextTrades.map((trade) => trade.id));
      setTrades(nextTrades);
      setSessions(nextSessions);
      setScreenshots(nextScreenshots);
    });
  }, []);

  const sessionMap = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const screenshotsByTradeId = useMemo(() => {
    const map = new Map<string, ScreenshotAttachment[]>();
    screenshots.forEach((shot) => {
      map.set(shot.tradeId, [...(map.get(shot.tradeId) ?? []), shot]);
    });
    return map;
  }, [screenshots]);
  const normalizedQuery = query.toLowerCase();
  const filtered = trades.filter((trade) => {
    const session = sessionMap.get(trade.sessionId);
    const tradeScreenshots = screenshotsByTradeId.get(trade.id) ?? [];
    const haystack = [
      trade.direction,
      trade.notes,
      trade.outcome ? tradeOutcomeLabels[trade.outcome] : '',
      ...tradeScreenshots.map((shot) => shot.filename),
      session?.instrument ?? '',
      session ? formatDate(session.dateCreated) : '',
      formatDate(trade.createdAt),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <Link to="/" className="text-link">
            Dashboard
          </Link>
          <h1>Trade Log</h1>
        </div>
        <div className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search trades" />
        </div>
      </header>
      <section className="takeaway-library trade-log">
        {filtered.map((trade) => {
          const session = sessionMap.get(trade.sessionId);
          const tradeScreenshots = screenshotsByTradeId.get(trade.id) ?? [];
          return (
            <Link to={`/session/${trade.sessionId}`} className="library-row trade-log-row" key={trade.id}>
              <div className="trade-log-main">
                <div className="trade-log-title">
                  <span className={`trade-direction ${trade.direction}`}>{trade.direction.toUpperCase()}</span>
                  {trade.outcome ? (
                    <span className="small-pill">{tradeOutcomeLabels[trade.outcome]}</span>
                  ) : (
                    <span className="small-pill">Result pending</span>
                  )}
                </div>
                <p>{trade.notes || 'No notes.'}</p>
                <span>{session?.instrument || 'NQ'} session</span>
              </div>
              <div className="trade-log-side">
                {tradeScreenshots.length > 0 && (
                  <div className="trade-log-screenshots" aria-label={`${tradeScreenshots.length} attached image(s)`}>
                    {tradeScreenshots.map((shot) => (
                      <ScreenshotImage key={shot.id} shot={shot} />
                    ))}
                  </div>
                )}
                <time>{formatDate(trade.createdAt)}</time>
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && <div className="empty-state">No trades found.</div>}
      </section>
    </main>
  );
}

function GlobalTakeawaysPage() {
  const [takeaways, setTakeaways] = useState<Takeaway[]>([]);
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');

  const refresh = async () => {
    const nextTakeaways = await listTakeaways();
    setTakeaways(nextTakeaways);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    await addTakeaway({
      text: text.trim(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    setText('');
    setTags('');
    await refresh();
  };

  const filtered = takeaways.filter((takeaway) => {
    const haystack = `${takeaway.text} ${takeaway.tags?.join(' ') ?? ''} ${takeaway.sessionId ? 'session' : 'manual global'}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <Link to="/" className="text-link">
            Dashboard
          </Link>
          <h1>Global Takeaways</h1>
        </div>
        <div className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search takeaways" />
        </div>
      </header>
      <section className="tool-panel takeaway-panel global-takeaway-form">
        <div className="section-heading compact-heading">
          <h2>Add Takeaway</h2>
        </div>
        <form onSubmit={handleSubmit} className="stacked-form">
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} placeholder="Manual takeaway..." />
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tags optional, comma separated" />
          <button className="button gold" type="submit">
            <Lightbulb size={17} /> Add Takeaway
          </button>
        </form>
      </section>
      <section className="takeaway-library">
        {filtered.map((takeaway) => {
          const rowContents = (
            <>
              <div className="library-row-main">
                <p>{takeaway.text}</p>
                {(!takeaway.sessionId || takeaway.tags?.length) && (
                  <div className="library-row-meta">
                    {!takeaway.sessionId && <span>Manual</span>}
                    {takeaway.tags?.length ? <span>{takeaway.tags.join(', ')}</span> : null}
                  </div>
                )}
              </div>
              <time>{formatDate(takeaway.sourceDate)}</time>
            </>
          );

          return takeaway.sessionId ? (
            <Link to={`/session/${takeaway.sessionId}`} className="library-row" key={takeaway.id}>
              {rowContents}
            </Link>
          ) : (
            <article className="library-row static-row" key={takeaway.id}>
              {rowContents}
            </article>
          );
        })}
        {filtered.length === 0 && <div className="empty-state">No takeaways found.</div>}
      </section>
    </main>
  );
}

function PDFExportButton({ targetId }: { targetId: string }) {
  const [exporting, setExporting] = useState(false);
  const printRef = useRef<HTMLButtonElement>(null);

  const handleExport = async () => {
    const target = document.getElementById(targetId);
    if (!target) return;
    setExporting(true);
    const canvas = await html2canvas(target, { scale: 1.6, backgroundColor: '#f8fafc' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgHeight = (canvas.height * pageWidth) / canvas.width;
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, pageWidth, imgHeight);
    let heightLeft = imgHeight - pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save('trading-session-review.pdf');
    setExporting(false);
  };

  return (
    <button ref={printRef} onClick={handleExport} className="button secondary" disabled={exporting}>
      <FileDown size={18} /> {exporting ? 'Exporting...' : 'Export PDF'}
    </button>
  );
}

function blockIcon(type: BlockType): ComponentType<{ size?: number }> {
  const icons: Record<BlockType, ComponentType<{ size?: number }>> = {
    zone: MapPin,
    event: Zap,
    condition: CheckCircle2,
    invalidation: AlertTriangle,
    entry: ArrowDownUp,
    takeaway: Lightbulb,
  };
  return icons[type];
}

function deriveActiveBlockId(blocks: FlowBlock[]) {
  const selected = blocks
    .filter((block) => block.status === 'selected' || block.status === 'entryTaken')
    .sort((a, b) => (b.selectedAt ?? b.createdAt).localeCompare(a.selectedAt ?? a.createdAt))[0];
  if (selected) return selected.id;
  return blocks.filter((block) => block.status !== 'inactive').sort((a, b) => b.orderIndex - a.orderIndex)[0]?.id;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
