import { Client } from "pg";

const { prototype } = Client;

export const countRoundTrips = async <T>(
  run: () => Promise<T>,
): Promise<{ readonly result: T; readonly roundTrips: number }> => {
  const original = Object.getOwnPropertyDescriptor(prototype, "query");
  const sent: unknown[] = [];
  Object.defineProperty(prototype, "query", {
    ...original,
    value(this: Client, ...args: unknown[]) {
      sent.push(args[0]);
      return Reflect.apply(original?.value, this, args);
    },
  });
  try {
    const result = await run();
    return { result, roundTrips: sent.length };
  } finally {
    Object.defineProperty(prototype, "query", { ...original });
  }
};
