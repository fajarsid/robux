import type { ProductLineName } from '@robux/shared';
import type { SourceCandidate } from './routing';

/**
 * Current sources of one product line as routing sees them; `providerConfigured` is decided by the
 * caller's process. A source only ever serves its own line (Stars never deliver Robux).
 */
export interface SourceCandidateReader {
  candidates(productLine: ProductLineName): Promise<Omit<SourceCandidate, 'providerConfigured'>[]>;
}

export const SOURCE_CANDIDATE_READER = Symbol('SOURCE_CANDIDATE_READER');
