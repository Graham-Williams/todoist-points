// Rewards: create, edit and delete. Listing (in drag order) is getRewards() in
// queries.ts; redeeming is the /api/rewards/[id]/redeem route.
//
// A redemption is a 'redeem' ledger row that captures the reward's name and
// cost at the time (description `Redeemed: <name>`, points `-cost`). Editing
// or deleting a reward never touches the ledger, so past redemptions keep the
// name and cost they were redeemed at; changes apply to future redemptions.
import { getDb } from "./db";
import type { Reward } from "./queries";
import { DESCRIPTION_MAX, REWARD_COST_MAX, REWARD_NAME_MAX } from "./validate";

const REWARD_COLS = `id, name, description, cost, active, created_at`;

function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > REWARD_NAME_MAX) {
    throw new RangeError(`Name must be 1–${REWARD_NAME_MAX} characters`);
  }
  return trimmed;
}

function checkCost(cost: number): number {
  if (!Number.isInteger(cost) || cost < 1 || cost > REWARD_COST_MAX) {
    throw new RangeError(`Cost must be an integer between 1 and ${REWARD_COST_MAX}`);
  }
  return cost;
}

// Trimmed; blank -> NULL. (Routes validate with parseDescription first.)
function checkDescription(description: string | null | undefined): string | null {
  const trimmed = (description ?? "").trim();
  if (trimmed.length > DESCRIPTION_MAX) {
    throw new RangeError(`Description must be at most ${DESCRIPTION_MAX} characters`);
  }
  return trimmed === "" ? null : trimmed;
}

function getReward(id: number): Reward | undefined {
  return getDb()
    .prepare(`SELECT ${REWARD_COLS} FROM rewards WHERE id = ?`)
    .get(id) as Reward | undefined;
}

export function createReward(
  name: string,
  cost: number,
  description: string | null = null
): Reward {
  const values = [checkName(name), checkDescription(description), checkCost(cost)];
  const id = Number(
    getDb()
      .prepare(`INSERT INTO rewards (name, description, cost, active) VALUES (?, ?, ?, 1)`)
      .run(...values).lastInsertRowid
  );
  return getReward(id)!;
}

export interface RewardUpdate {
  name?: string;
  description?: string | null; // null or blank clears it
  cost?: number;
  active?: boolean;
}

// Edit a reward's name / description / cost / active flag (only the fields
// given). Inactive rewards can be edited too. Name and cost changes apply to
// FUTURE redemptions only: past 'redeem' ledger rows keep their value and
// description. Returns null if there is no such reward.
export function updateReward(id: number, update: RewardUpdate): Reward | null {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (update.name !== undefined) {
    sets.push("name = ?");
    values.push(checkName(update.name));
  }
  if (update.description !== undefined) {
    sets.push("description = ?");
    values.push(checkDescription(update.description));
  }
  if (update.cost !== undefined) {
    sets.push("cost = ?");
    values.push(checkCost(update.cost));
  }
  if (update.active !== undefined) {
    sets.push("active = ?");
    values.push(update.active ? 1 : 0);
  }
  if (!getReward(id)) return null;
  if (sets.length > 0) {
    getDb().prepare(`UPDATE rewards SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }
  return getReward(id)!;
}

// Hard delete (rewards have no history of their own; past redemptions live in
// the ledger and stay). Returns false if there was no such reward.
export function deleteReward(id: number): boolean {
  return getDb().prepare(`DELETE FROM rewards WHERE id = ?`).run(id).changes > 0;
}
