import type { ApprovalRequest, AuditLogEntry, Automation, Creative } from "@/domain/types";

import type { DemoData } from "./demo-data";
import {
  emptyStatusCounts,
  type ApprovalRepository,
  type AuditRepository,
  type AutomationRepository,
  type CreativeRepository,
  type DataStore,
} from "./types";
import { OPEN_APPROVAL_STATUSES } from "@/domain/approvals/state-machine";

/**
 * Process-local store for demos and tests. Data resets on restart and is not
 * shared between server instances — never use it in production.
 */
export function createMemoryStore(seed: DemoData, idPrefix = "mem"): DataStore {
  const state = {
    approvals: structuredClone(seed.approvals),
    creatives: structuredClone(seed.creatives),
    automations: structuredClone(seed.automations),
    audit: structuredClone(seed.audit),
  };
  let counter = 0;
  const newId = (kind: string) => `${idPrefix}_${kind}_${Date.now().toString(36)}_${(counter++).toString(36)}`;
  const clone = <T>(value: T): T => structuredClone(value);
  const byNewest = (a: { createdAt: Date }, b: { createdAt: Date }) =>
    b.createdAt.getTime() - a.createdAt.getTime();

  const approvals: ApprovalRepository = {
    async list(workspaceId, filter) {
      return state.approvals
        .filter((a) => a.workspaceId === workspaceId)
        .filter((a) => !filter?.statuses || filter.statuses.includes(a.status))
        .sort(byNewest)
        .slice(0, filter?.limit ?? Infinity)
        .map(clone);
    },
    async get(workspaceId, id) {
      const found = state.approvals.find((a) => a.workspaceId === workspaceId && a.id === id);
      return found ? clone(found) : null;
    },
    async findOpenForTarget(workspaceId, type, targetExternalId, creativeId) {
      const found = state.approvals.find(
        (a) =>
          a.workspaceId === workspaceId &&
          a.type === type &&
          a.targetExternalId === targetExternalId &&
          (a.creativeId ?? null) === (creativeId ?? null) &&
          OPEN_APPROVAL_STATUSES.includes(a.status),
      );
      return found ? clone(found) : null;
    },
    async create(input) {
      const now = new Date();
      const created = {
        ...clone(input),
        id: newId("apr"),
        status: "PENDING",
        version: 0,
        reviewedById: null,
        reviewNote: null,
        reviewedAt: null,
        executionMode: null,
        executedAt: null,
        executionResult: null,
        createdAt: now,
        updatedAt: now,
      } as ApprovalRequest;
      state.approvals.push(created);
      return clone(created);
    },
    async transition(workspaceId, id, { from, expectedVersion, patch }) {
      const index = state.approvals.findIndex(
        (a) => a.workspaceId === workspaceId && a.id === id && a.status === from && a.version === expectedVersion,
      );
      if (index === -1) return null;
      const updated = {
        ...state.approvals[index],
        ...clone(patch),
        version: expectedVersion + 1,
        updatedAt: new Date(),
      } as ApprovalRequest;
      state.approvals[index] = updated;
      return clone(updated);
    },
    async countByStatus(workspaceId) {
      const counts = emptyStatusCounts();
      for (const a of state.approvals) if (a.workspaceId === workspaceId) counts[a.status]++;
      return counts;
    },
  };

  const creatives: CreativeRepository = {
    async list(workspaceId) {
      return state.creatives.filter((c) => c.workspaceId === workspaceId).sort(byNewest).map(clone);
    },
    async get(workspaceId, id) {
      const found = state.creatives.find((c) => c.workspaceId === workspaceId && c.id === id);
      return found ? clone(found) : null;
    },
    async create(input) {
      const now = new Date();
      const created: Creative = { ...clone(input), id: newId("crv"), createdAt: now, updatedAt: now };
      state.creatives.push(created);
      return clone(created);
    },
    async setStatus(workspaceId, id, status) {
      const found = state.creatives.find((c) => c.workspaceId === workspaceId && c.id === id);
      if (found) {
        found.status = status;
        found.updatedAt = new Date();
      }
    },
  };

  const automations: AutomationRepository = {
    async list(workspaceId) {
      return state.automations
        .filter((a) => a.workspaceId === workspaceId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(clone);
    },
    async get(workspaceId, id) {
      const found = state.automations.find((a) => a.workspaceId === workspaceId && a.id === id);
      return found ? clone(found) : null;
    },
    async setEnabled(workspaceId, id, enabled) {
      const found = state.automations.find((a) => a.workspaceId === workspaceId && a.id === id);
      if (!found) return null;
      found.enabled = enabled;
      found.updatedAt = new Date();
      return clone(found);
    },
    async markEvaluated(workspaceId, id, at) {
      const found: Automation | undefined = state.automations.find(
        (a) => a.workspaceId === workspaceId && a.id === id,
      );
      if (found) found.lastEvaluatedAt = at;
    },
  };

  const audit: AuditRepository = {
    async record(entry) {
      const created: AuditLogEntry = { ...clone(entry), id: newId("aud"), createdAt: new Date() };
      state.audit.unshift(created);
    },
    async list(workspaceId, options) {
      return state.audit
        .filter((e) => e.workspaceId === workspaceId)
        .sort(byNewest)
        .slice(0, options?.limit ?? 50)
        .map(clone);
    },
  };

  const store: DataStore = {
    kind: "memory",
    approvals,
    creatives,
    automations,
    audit,
    // Single process, single thread: operations are applied in order.
    transaction: (fn) => fn(store),
    ping: async () => {},
  };
  return store;
}
