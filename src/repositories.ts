import { db, nowIso, uid } from './db';
import {
  BlockType,
  BlockStatus,
  BranchGroup,
  FlowBlock,
  ScreenshotAttachment,
  SessionBundle,
  Takeaway,
  TradeDirection,
  TradeOutcome,
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

export async function deleteFlowBlock(blockId: string) {
  const timestamp = nowIso();

  return db.transaction('rw', db.flowBlocks, db.branchGroups, db.trades, db.sessions, async () => {
    const target = await db.flowBlocks.get(blockId);
    if (!target) return { deletedBlockIds: [] as string[], parentBlockId: undefined };

    const [blocks, branchGroups] = await Promise.all([
      db.flowBlocks.where('sessionId').equals(target.sessionId).toArray(),
      db.branchGroups.where('sessionId').equals(target.sessionId).toArray(),
    ]);
    const blockMap = new Map(blocks.map((block) => [block.id, normalizeFlowBlock(block)]));
    const childrenByParent = new Map<string, string[]>();
    const branchGroupsByParent = new Map<string, BranchGroup[]>();

    blocks.forEach((block) => {
      if (!block.parentBlockId) return;
      childrenByParent.set(block.parentBlockId, [...(childrenByParent.get(block.parentBlockId) ?? []), block.id]);
    });

    branchGroups.forEach((group) => {
      if (!group.parentBlockId) return;
      branchGroupsByParent.set(group.parentBlockId, [...(branchGroupsByParent.get(group.parentBlockId) ?? []), group]);
    });

    const deletedBlockIds = new Set<string>();
    const stack = [blockId];
    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId || deletedBlockIds.has(currentId)) continue;
      deletedBlockIds.add(currentId);

      const current = blockMap.get(currentId);
      current?.childBlockIds.forEach((childId) => stack.push(childId));
      childrenByParent.get(currentId)?.forEach((childId) => stack.push(childId));
      branchGroupsByParent.get(currentId)?.forEach((group) => {
        group.branchBlockIds.forEach((branchBlockId) => stack.push(branchBlockId));
      });
    }

    const ids = Array.from(deletedBlockIds);
    const groupIdsToDelete: string[] = [];
    const branchGroupsNeedingSelectionReset: string[][] = [];
    const branchGroupUpdates: Array<{ id: string; patch: Partial<BranchGroup> }> = [];

    branchGroups.forEach((group) => {
      const survivingBranchBlockIds = group.branchBlockIds.filter((branchBlockId) => !deletedBlockIds.has(branchBlockId));
      const parentWasDeleted = group.parentBlockId ? deletedBlockIds.has(group.parentBlockId) : false;

      if (parentWasDeleted || survivingBranchBlockIds.length === 0) {
        groupIdsToDelete.push(group.id);
        return;
      }

      const selectedBranchWasDeleted = group.selectedBranchId ? deletedBlockIds.has(group.selectedBranchId) : false;
      if (survivingBranchBlockIds.length !== group.branchBlockIds.length || selectedBranchWasDeleted) {
        branchGroupUpdates.push({
          id: group.id,
          patch: {
            branchBlockIds: survivingBranchBlockIds,
            selectedBranchId: selectedBranchWasDeleted ? undefined : group.selectedBranchId,
          },
        });
      }

      if (selectedBranchWasDeleted) {
        branchGroupsNeedingSelectionReset.push(survivingBranchBlockIds);
      }
    });

    const parentUpdates = blocks
      .filter((block) => !deletedBlockIds.has(block.id))
      .map((block) => {
        const normalizedBlock = normalizeFlowBlock(block);
        const childBlockIds = normalizedBlock.childBlockIds.filter((childId) => !deletedBlockIds.has(childId));
        return childBlockIds.length === normalizedBlock.childBlockIds.length
          ? undefined
          : db.flowBlocks.update(block.id, { childBlockIds });
      })
      .filter(Boolean);

    await Promise.all(parentUpdates);
    await Promise.all(branchGroupUpdates.map((group) => db.branchGroups.update(group.id, group.patch)));
    await Promise.all(
      branchGroupsNeedingSelectionReset
        .flat()
        .map((branchBlockId) => db.flowBlocks.update(branchBlockId, { status: 'pending', selectedAt: undefined })),
    );
    await db.branchGroups.bulkDelete(groupIdsToDelete);
    await db.flowBlocks.bulkDelete(ids);
    await db.trades
      .where('relatedFlowBlockId')
      .anyOf(ids)
      .modify((trade) => {
        delete trade.relatedFlowBlockId;
      });
    await db.sessions.update(target.sessionId, { updatedAt: timestamp });

    return { deletedBlockIds: ids, parentBlockId: target.parentBlockId };
  });
}

export async function addBranchGroup(input: {
  sessionId: string;
  parentBlockId?: string;
  branches: Array<{ type: BlockType; text: string }>;
}) {
  const timestamp = nowIso();
  return db.transaction('rw', db.flowBlocks, db.branchGroups, db.sessions, async () => {
    const matchingGroups = (await db.branchGroups.where('sessionId').equals(input.sessionId).toArray()).filter(
      (group) => (group.parentBlockId ?? undefined) === input.parentBlockId,
    );
    const existingGroup = matchingGroups.find((group) => group.selectedBranchId) ?? matchingGroups[0];
    const branchGroupId = existingGroup?.id ?? uid('branch');
    const selectedBranchId = existingGroup?.selectedBranchId;
    const existingBranchBlockIds = Array.from(
      new Set(matchingGroups.flatMap((group) => (Array.isArray(group.branchBlockIds) ? group.branchBlockIds : []))),
    );
    const blocks: FlowBlock[] = input.branches.map((branch, index) => ({
      id: uid('block'),
      sessionId: input.sessionId,
      parentBlockId: input.parentBlockId,
      childBlockIds: [],
      branchGroupId,
      type: branch.type,
      text: branch.text,
      status: selectedBranchId ? 'inactive' : 'pending',
      createdAt: timestamp,
      orderIndex: Date.now() + index,
    }));
    const branchBlockIds = [...existingBranchBlockIds, ...blocks.map((block) => block.id)];
    const branchGroup: BranchGroup = {
      id: branchGroupId,
      sessionId: input.sessionId,
      parentBlockId: input.parentBlockId,
      branchBlockIds,
      selectedBranchId,
    };

    await db.flowBlocks.bulkAdd(blocks);
    if (existingGroup) {
      await Promise.all(
        existingBranchBlockIds.map((blockId) =>
          db.flowBlocks.update(blockId, {
            branchGroupId,
            ...(selectedBranchId && blockId !== selectedBranchId
              ? { status: 'inactive' as const, selectedAt: undefined }
              : !selectedBranchId
                ? { status: 'pending' as const, selectedAt: undefined }
                : {}),
          }),
        ),
      );
      await db.branchGroups.put(branchGroup);
      await db.branchGroups.bulkDelete(
        matchingGroups.filter((group) => group.id !== branchGroupId).map((group) => group.id),
      );
    } else {
      await db.branchGroups.add(branchGroup);
    }
    if (input.parentBlockId) {
      const parent = await db.flowBlocks.get(input.parentBlockId);
      if (parent) {
        await db.flowBlocks.update(parent.id, {
          childBlockIds: [
            ...(Array.isArray(parent.childBlockIds) ? parent.childBlockIds : []),
            ...blocks.map((block) => block.id),
          ],
        });
      }
    }
    await db.sessions.update(input.sessionId, { updatedAt: timestamp });

    return { branchGroup, blocks };
  });
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

export async function updateTradeOutcome(tradeId: string, outcome: TradeOutcome) {
  const timestamp = nowIso();
  await db.transaction('rw', db.trades, db.sessions, async () => {
    const trade = await db.trades.get(tradeId);
    if (!trade) return;
    await db.trades.update(tradeId, { outcome });
    await db.sessions.update(trade.sessionId, { updatedAt: timestamp });
  });
}

export async function addTakeaway(input: {
  sessionId?: string;
  sessionDate?: string;
  text: string;
  tags?: string[];
}) {
  const timestamp = nowIso();
  const takeaway: Takeaway = {
    id: uid('takeaway'),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    text: input.text,
    tags: input.tags,
    sourceDate: input.sessionDate ?? timestamp,
    createdAt: timestamp,
  };
  await db.transaction('rw', db.takeaways, db.sessions, async () => {
    await db.takeaways.add(takeaway);
    if (input.sessionId) {
      await db.sessions.update(input.sessionId, { updatedAt: timestamp });
    }
  });
  return takeaway;
}

export async function listTakeaways() {
  return db.takeaways.orderBy('createdAt').reverse().toArray();
}

export async function listTrades() {
  return db.trades.orderBy('createdAt').reverse().toArray();
}

export async function listTradeScreenshots(tradeIds: string[]): Promise<ScreenshotAttachment[]> {
  if (tradeIds.length === 0) return [];
  return db.screenshots.where('tradeId').anyOf(tradeIds).toArray();
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
