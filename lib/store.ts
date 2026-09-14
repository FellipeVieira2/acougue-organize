export type StoreRef = {
  id: string;
  name: string;
  active: boolean;
};

export function resolveSelectedStore(
  stores: readonly StoreRef[],
  requestedId: string | null,
): StoreRef | null {
  if (!stores.length) return null;

  const explicitMatch = requestedId
    ? stores.find((store) => store.id === requestedId)
    : undefined;

  if (explicitMatch) return explicitMatch;

  const activeStore = stores.find((store) => store.active);
  return activeStore ?? stores[0] ?? null;
}
