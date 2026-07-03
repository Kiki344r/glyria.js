// src/core/guards.ts

import type { PermissionFlagsBits } from "discord.js"
import { parseDuration, formatDuration } from "../utils/duration.js"
import type { Duration } from "../utils/duration.js"

// ===== TYPES =====

export type PermissionName = keyof typeof PermissionFlagsBits

export interface CooldownConfig {
  user?: number
  guild?: number
  global?: number
}

export type CooldownInput = Duration | { user?: Duration; guild?: Duration; global?: Duration }

export interface CommandGuards {
  cooldown?: CooldownConfig
  permissions?: PermissionName[]
  ownerOnly?: boolean
}

export interface GuardSubject {
  userId: string
  guildId: string | null
  /** Returns the missing permission names, or null when member permissions are unavailable (DMs). */
  missingPermissions: (permissions: PermissionName[]) => string[] | null
  isOwner: () => Promise<boolean>
}

// ===== NORMALIZATION =====

export const normalizeCooldown = (input: CooldownInput): CooldownConfig => {
  if (typeof input === "string" || typeof input === "number") {
    return { user: parseDuration(input) }
  }

  return {
    ...(input.user !== undefined && { user: parseDuration(input.user) }),
    ...(input.guild !== undefined && { guild: parseDuration(input.guild) }),
    ...(input.global !== undefined && { global: parseDuration(input.global) }),
  }
}

// ===== COOLDOWN STORE =====

const PRUNE_THRESHOLD = 5_000

export class CooldownStore {
  private expiries = new Map<string, number>()

  remaining(key: string, now = Date.now()): number {
    const expiry = this.expiries.get(key)
    if (expiry === undefined || expiry <= now) return 0
    return expiry - now
  }

  set(key: string, ms: number, now = Date.now()): void {
    if (this.expiries.size >= PRUNE_THRESHOLD) this.prune(now)
    this.expiries.set(key, now + ms)
  }

  private prune(now: number): void {
    for (const [key, expiry] of this.expiries) {
      if (expiry <= now) this.expiries.delete(key)
    }
  }
}

// ===== HELPERS =====

const formatPermissionName = (name: string): string => name.replace(/([a-z])([A-Z])/g, "$1 $2")

// ===== GUARD RUNNER =====

/**
 * Runs the declarative guards for a command. Returns null when everything
 * passes, or a user-facing error message when a guard denies execution.
 * Cooldowns are only consumed once every other guard has passed.
 */
export const runGuards = async (
  guards: CommandGuards,
  commandKey: string,
  cooldowns: CooldownStore,
  subject: GuardSubject,
): Promise<string | null> => {
  if (guards.ownerOnly && !(await subject.isOwner())) {
    return "This command is restricted to the bot owner."
  }

  if (guards.permissions?.length) {
    const missing = subject.missingPermissions(guards.permissions)

    if (missing === null || missing.length) {
      const names = (missing ?? guards.permissions).map(formatPermissionName).join(", ")
      return `You need the following permission(s) to use this command: **${names}**`
    }
  }

  if (guards.cooldown) {
    const now = Date.now()
    const scopes: [string, number][] = []

    if (guards.cooldown.user) {
      scopes.push([`${commandKey}:user:${subject.userId}`, guards.cooldown.user])
    }
    if (guards.cooldown.guild && subject.guildId) {
      scopes.push([`${commandKey}:guild:${subject.guildId}`, guards.cooldown.guild])
    }
    if (guards.cooldown.global) {
      scopes.push([`${commandKey}:global`, guards.cooldown.global])
    }

    let maxRemaining = 0
    for (const [key] of scopes) {
      maxRemaining = Math.max(maxRemaining, cooldowns.remaining(key, now))
    }

    if (maxRemaining > 0) {
      return `You're on cooldown — try again in **${formatDuration(maxRemaining)}**.`
    }

    for (const [key, ms] of scopes) {
      cooldowns.set(key, ms, now)
    }
  }

  return null
}
