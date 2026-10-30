/** `true` when `A` and `B` are mutually assignable; used for compile-time `const _x: Same<A, B> = true` checks. */
export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
