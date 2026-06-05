import Dexie, { Table } from 'dexie';
import {
  BranchGroup,
  FlowBlock,
  ScreenshotAttachment,
  Takeaway,
  TradeTaken,
  TradingSession,
} from './types';

class TradingJournalDb extends Dexie {
  sessions!: Table<TradingSession, string>;
  flowBlocks!: Table<FlowBlock, string>;
  branchGroups!: Table<BranchGroup, string>;
  trades!: Table<TradeTaken, string>;
  screenshots!: Table<ScreenshotAttachment, string>;
  takeaways!: Table<Takeaway, string>;

  constructor() {
    super('tradingDecisionFlowJournal');
    this.version(1).stores({
      sessions: 'id, dateCreated, instrument, isLocked, updatedAt',
      flowBlocks: 'id, sessionId, parentBlockId, branchGroupId, status, orderIndex',
      branchGroups: 'id, sessionId, parentBlockId, selectedBranchId',
      trades: 'id, sessionId, relatedFlowBlockId, createdAt',
      screenshots: 'id, tradeId, createdAt',
      takeaways: 'id, sessionId, sourceDate, createdAt, *tags',
    });
    this.version(2).stores({
      templates: null,
    });
  }
}

export const db = new TradingJournalDb();

export const uid = (prefix: string) =>
  `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

export const nowIso = () => new Date().toISOString();
