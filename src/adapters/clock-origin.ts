import type { Compiled } from '../core/runtime/ir';
/** Convert monotonic timestamps between same-machine performance clock origins. */
export function convertClockOrigin(
  ir: Compiled,
  sourceOrigin: number,
  targetOrigin: number,
): Compiled {
  const offset = sourceOrigin - targetOrigin;
  return {
    ...ir,
    receivedAt: ir.receivedAt + offset,
    ...(ir.deadlineAt === undefined ? {} : { deadlineAt: ir.deadlineAt + offset }),
  };
}
