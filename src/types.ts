export type BlockType =
  | 'zone'
  | 'event'
  | 'condition'
  | 'invalidation'
  | 'entry'
  | 'takeaway';

export type BlockStatus =
  | 'pending'
  | 'selected'
  | 'inactive'
  | 'entryTaken'
  | 'invalidated';

export type TradeDirection = 'long' | 'short';

export type TradeOutcome =
  | 'smallLoss'
  | 'loss'
  | 'breakeven'
  | 'smallWin'
  | 'win';

export interface TradingSession {
  id: string;
  dateCreated: string;
  instrument: string;
  marketContextText: string;
  isSaved: boolean;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlowBlock {
  id: string;
  sessionId: string;
  parentBlockId?: string;
  childBlockIds: string[];
  branchGroupId?: string;
  type: BlockType;
  text: string;
  status: BlockStatus;
  createdAt: string;
  selectedAt?: string;
  orderIndex: number;
}

export interface BranchGroup {
  id: string;
  sessionId: string;
  parentBlockId?: string;
  branchBlockIds: string[];
  selectedBranchId?: string;
}

export interface TradeTaken {
  id: string;
  sessionId: string;
  relatedFlowBlockId?: string;
  direction: TradeDirection;
  outcome?: TradeOutcome;
  notes: string;
  createdAt: string;
}

export interface ScreenshotAttachment {
  id: string;
  tradeId: string;
  localBlobReference: Blob;
  filename: string;
  caption?: string;
  createdAt: string;
}

export interface Takeaway {
  id: string;
  sessionId?: string;
  text: string;
  createdAt: string;
  tags?: string[];
  sourceDate: string;
}

export interface SessionBundle {
  session: TradingSession;
  blocks: FlowBlock[];
  branchGroups: BranchGroup[];
  trades: TradeTaken[];
  screenshots: ScreenshotAttachment[];
  takeaways: Takeaway[];
}

export const blockTypeLabels: Record<BlockType, string> = {
  zone: 'Zone / Level',
  event: 'Event',
  condition: 'Condition + Confirmation',
  invalidation: 'Invalidation',
  entry: 'Entry',
  takeaway: 'Takeaway Marker',
};

export const blockStatusLabels: Record<BlockStatus, string> = {
  pending: 'Pending',
  selected: 'Occurred',
  inactive: 'Grayed out',
  entryTaken: 'Entry taken',
  invalidated: 'Invalidated',
};

export const tradeOutcomeOptions: TradeOutcome[] = [
  'loss',
  'smallLoss',
  'breakeven',
  'smallWin',
  'win',
];

export const tradeOutcomeLabels: Record<TradeOutcome, string> = {
  smallLoss: 'Small Loss',
  loss: 'Loss',
  breakeven: 'Breakeven',
  smallWin: 'Small Win',
  win: 'Win',
};
