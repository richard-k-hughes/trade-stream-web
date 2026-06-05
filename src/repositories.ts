import { db, nowIso, uid } from './db';
import {
  BlockType,
  BlockStatus,
  BranchGroup,
  FlowBlock,
  SessionBundle,
  Takeaway,
  TradeDirection,
  TradeTaken,
  TradingSession,
} from './types';

export async function createSession(): Promise<TradingSession> {
  const timestamp = nowIso();
  const session: TradingSession = {
    id: uid('session'),
    dateCreated: timestamp,
    instrument: 'NQ',
    marketContextText: '',
    isSaved: false,
    isLocked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.sessions.add(session);
  return session;
}

export async function listSessions() {
  return db.sessions.orderBy('updatedAt').reverse().toArray();
}

export async function getSessionBundle(sessionId: string): Promise<SessionBundle | undefined> {
  const session = await db.sessions.get(sessionId);
  if (!session) return undefined;

  const [rawBlocks, rawBranchGroups, trades, takeaways] = await Promise.all([
    db.flowBlocks.where('sessionId').equals(sessionId).sortBy('orderIndex'),
    db.branchGroups.where('sessionId').equals(sessionId).toArray(),
    db.trades.where('sessionId').equals(sessionId).reverse().sortBy('createdAt'),
    db.takeaways.where('sessionId').equals(sessionId).reverse().sortBy('createdAt'),
  ]);
  const blocks = rawBlocks.map(normalizeFlowBlock);
  const blockIds = new Set(blocks.map((block) => block.id));
  const branchGroups = rawBranchGroups.map((group) => ({
    ...group,
    branchBlockIds: Array.isArray(group.branchBlockIds)
      ? group.branchBlockIds.filter((blockId) => blockIds.has(blockId))
      : [],
  }));
  const screenshots = trades.length
    ? await db.screenshots.where('tradeId').anyOf(trades.map((trade) => trade.id)).toArray()
    : [];

  return { session, blocks, branchGroups, trades, screenshots, takeaways };
}

export async function updateSession(session: TradingSession, patch: Partial<TradingSession>) {
  const next = { ...session, ...patch, updatedAt: nowIso() };
  await db.sessions.put(next);
  return next;
}

export async function lockSession(sessionId: string) {
  await db.sessions.update(sessionId, {
    isSaved: true,
    isLocked: true,
    updatedAt: nowIso(),
  });
}

export async function addFlowBlock(input: {
  sessionId: string;
  parentBlockId?: string;
  type: BlockType;
  text: string;
  status?: FlowBlock['status'];
}) {
  const timestamp = nowIso();
  const orderIndex = Date.now();
  const block: FlowBlock = {
    id: uid('block'),
    sessionId: input.sessionId,
    parentBlockId: input.parentBlockId,
    childBlockIds: [],
    type: input.type,
    text: input.text,
    status: input.status ?? 'pending',
    createdAt: timestamp,
    orderIndex,
  };

  await db.transaction('rw', db.flowBlocks, db.sessions, async () => {
    await db.flowBlocks.add(block);
    if (input.parentBlockId) {
      const parent = await db.flowBlocks.get(input.parentBlockId);
      if (parent) {
        await db.flowBlocks.update(parent.id, {
          childBlockIds: [...parent.childBlockIds, block.id],
        });
      }
    }
    await db.sessions.update(input.sessionId, { updatedAt: timestamp });
  });
  return block;
}

export async function updateFlowBlock(blockId: string, patch: Partial<FlowBlock>) {
  await db.flowBlocks.update(blockId, patch);
}

export async function addBranchGroup(input: {
  sessionId: string;
  parentBlockId?: string;
  branches: Array<{ type: BlockType; text: string }>;
}) {
  const timestamp = nowIso();
  const branchGroupId = uid('branch');
  const blocks: FlowBlock[] = input.branches.map((branch, index) => ({
    id: uid('block'),
    sessionId: input.sessionId,
    parentBlockId: input.parentBlockId,
    childBlockIds: [],
    branchGroupId,
    type: branch.type,
    text: branch.text,
    status: 'pending',
    createdAt: timestamp,
    orderIndex: Date.now() + index,
  }));
  const branchGroup: BranchGroup = {
    id: branchGroupId,
    sessionId: input.sessionId,
    parentBlockId: input.parentBlockId,
    branchBlockIds: blocks.map((block) => block.id),
  };

  await db.transaction('rw', db.flowBlocks, db.branchGroups, db.sessions, async () => {
    await db.flowBlocks.bulkAdd(blocks);
    await db.branchGroups.add(branchGroup);
    if (input.parentBlockId) {
      const parent = await db.flowBlocks.get(input.parentBlockId);
      if (parent) {
        await db.flowBlocks.update(parent.id, {
          childBlockIds: [...parent.childBlockIds, ...blocks.map((block) => block.id)],
        });
      }
    }
    await db.sessions.update(input.sessionId, { updatedAt: timestamp });
  });

  return { branchGroup, blocks };
}

export async function selectBranch(branchGroupId: string, selectedBranchId: string) {
  const timestamp = nowIso();
  const branchGroup = await db.branchGroups.get(branchGroupId);
  if (!branchGroup) return;

  await db.transaction('rw', db.branchGroups, db.flowBlocks, async () => {
    await db.branchGroups.update(branchGroupId, { selectedBranchId });
    await Promise.all(
      branchGroup.branchBlockIds.map((blockId) =>
        db.flowBlocks.update(blockId, {
          status: blockId === selectedBranchId ? 'selected' : 'inactive',
          selectedAt: blockId === selectedBranchId ? timestamp : undefined,
        }),
      ),
    );
  });
}

export async function addTrade(input: {
  sessionId: string;
  direction: TradeDirection;
  notes: string;
  relatedFlowBlockId?: string;
  screenshots?: File[];
}) {
  const timestamp = nowIso();
  const trade: TradeTaken = {
    id: uid('trade'),
    sessionId: input.sessionId,
    direction: input.direction,
    notes: input.notes,
    relatedFlowBlockId: input.relatedFlowBlockId,
    createdAt: timestamp,
  };

  await db.transaction('rw', db.trades, db.screenshots, db.flowBlocks, db.sessions, async () => {
    await db.trades.add(trade);
    if (input.relatedFlowBlockId) {
      await db.flowBlocks.update(input.relatedFlowBlockId, { status: 'entryTaken' });
    }
    if (input.screenshots?.length) {
      await db.screenshots.bulkAdd(
        input.screenshots.map((file) => ({
          id: uid('shot'),
          tradeId: trade.id,
          localBlobReference: file,
          filename: file.name,
          createdAt: timestamp,
        })),
      );
    }
    await db.sessions.update(input.sessionId, { updatedAt: timestamp });
  });
  return trade;
}

export async function addTakeaway(input: {
  sessionId: string;
  sessionDate: string;
  text: string;
  tags?: string[];
}) {
  const timestamp = nowIso();
  const takeaway: Takeaway = {
    id: uid('takeaway'),
    sessionId: input.sessionId,
    text: input.text,
    tags: input.tags,
    sourceDate: input.sessionDate,
    createdAt: timestamp,
  };
  await db.transaction('rw', db.takeaways, db.sessions, async () => {
    await db.takeaways.add(takeaway);
    await db.sessions.update(input.sessionId, { updatedAt: timestamp });
  });
  return takeaway;
}

export async function listTakeaways() {
  return db.takeaways.orderBy('createdAt').reverse().toArray();
}

function normalizeFlowBlock(block: FlowBlock): FlowBlock {
  return {
    ...block,
    childBlockIds: Array.isArray(block.childBlockIds) ? block.childBlockIds : [],
    type: normalizeBlockType(block.type),
    status: normalizeBlockStatus(block.status),
    text: block.text ?? '',
    orderIndex: Number.isFinite(block.orderIndex) ? block.orderIndex : Date.now(),
  };
}

function normalizeBlockType(type: BlockType): BlockType {
  return ['zone', 'event', 'condition', 'invalidation', 'entry', 'takeaway'].includes(type)
    ? type
    : 'event';
}

function normalizeBlockStatus(status: BlockStatus): BlockStatus {
  return ['pending', 'selected', 'inactive', 'entryTaken', 'invalidated'].includes(status)
    ? status
    : 'pending';
}
