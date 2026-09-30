export { default as TravelEvidence } from './TravelEvidence';
export { default as FraudRingEvidence } from './FraudRingEvidence';
export { default as AmountEvidence } from './AmountEvidence';
export { default as BalanceEvidence } from './BalanceEvidence';
export { default as TravelMap } from '../TravelMap';

/** Rule names that have a dedicated evidence card. */
export const EVIDENCE_RULES = ['impossible_travel', 'shared_device', 'unusual_amount', 'balance_drain'];
