import type {
  DeskAction,
  DeskState,
  PhotoPhase,
  PhotoRecord,
  Store,
} from "../contracts";
import { isCorrect } from "./rotation";

type Listener = (state: DeskState, action: DeskAction) => void;

export function initialDeskState(total: number): DeskState {
  return { records: new Map(), order: [], nextSlot: 0, total };
}

function withRecord(state: DeskState, record: PhotoRecord): DeskState {
  const records = new Map(state.records);
  records.set(record.id, record);
  return { ...state, records };
}

function advance(
  state: DeskState,
  id: string,
  from: PhotoPhase,
  update: (record: PhotoRecord) => PhotoRecord,
): DeskState {
  const record = state.records.get(id);
  if (!record || record.phase !== from) {
    return state;
  }
  return withRecord(state, update(record));
}

export function reduceDesk(state: DeskState, action: DeskAction): DeskState {
  switch (action.type) {
    case "added": {
      const { source } = action;
      if (state.records.has(source.id)) {
        return state;
      }
      const added = withRecord(state, {
        id: source.id,
        source,
        simulated: action.simulated,
        phase: "loading",
        aspect: source.aspect ?? 1,
        prediction: null,
        slot: null,
        correct: null,
        addedAt: action.at,
        decidedAt: null,
        error: null,
      });
      return { ...added, order: [...state.order, source.id] };
    }
    case "loaded": {
      const loaded = advance(state, action.id, "loading", (record) => ({
        ...record,
        phase: "landing",
        aspect: action.aspect,
        slot: state.nextSlot,
      }));
      return loaded === state
        ? state
        : { ...loaded, nextSlot: state.nextSlot + 1 };
    }
    case "landed":
      return advance(state, action.id, "landing", (record) => ({
        ...record,
        phase: "waiting",
      }));
    case "scanStarted":
      return advance(state, action.id, "waiting", (record) => ({
        ...record,
        phase: "scanning",
      }));
    case "decided":
      return advance(state, action.id, "scanning", (record) => ({
        ...record,
        phase: "placing",
        prediction: action.prediction,
        decidedAt: action.at,
        correct: isCorrect(
          record.source.uprightFix,
          record.simulated,
          action.prediction.correction,
        ),
      }));
    case "placed":
      return advance(state, action.id, "placing", (record) => ({
        ...record,
        phase: "placed",
      }));
    case "failed": {
      const record = state.records.get(action.id);
      if (!record) {
        return state;
      }
      return withRecord(state, {
        ...record,
        phase: "failed",
        error: action.error,
      });
    }
    case "totalChanged":
      return action.total === state.total
        ? state
        : { ...state, total: action.total };
  }
}

export function createStore(initial: DeskState): Store {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState() {
      return state;
    },
    dispatch(action) {
      const next = reduceDesk(state, action);
      if (next === state) {
        return;
      }
      state = next;
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) {
          listener(next, action);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
