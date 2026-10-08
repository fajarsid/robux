/**
 * A planned source no longer has the balance (or left routing) since the plan was made. The
 * reservation transaction rolls back; the caller routes again on fresh balances.
 */
export class ReservationConflictError extends Error {
  constructor(readonly sourceId: string) {
    super(`Source ${sourceId} could not reserve the planned amount`);
    this.name = 'ReservationConflictError';
  }
}
