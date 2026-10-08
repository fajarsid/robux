export interface OrderNumberAllocator {
  /** Returns a new, never-before-issued order number for the business date of `instant`. */
  allocate(instant: Date): Promise<string>;
}

export const ORDER_NUMBER_ALLOCATOR = Symbol('ORDER_NUMBER_ALLOCATOR');
