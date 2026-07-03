// src/builders/componentBuilder.ts

import type {
  ButtonInteraction,
  AnySelectMenuInteraction,
  ModalSubmitInteraction,
} from "discord.js"
import type { GlyriaContext } from "../core/context/ReplyableContext.js"

// ===== TYPED CUSTOM IDS =====

/**
 * Infers the params encoded in a customId pattern:
 * PatternParams<"role_picker:{roleId}:{userId}"> = { roleId: string; userId: string }
 */
export type PatternParams<P extends string> = P extends `${string}{${infer Name}}${infer Rest}`
  ? { [K in Name | keyof PatternParams<Rest>]: string }
  : Record<never, string>

const PARAM_REGEX = /\{(\w+)\}/g

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Compiles "role_picker:{roleId}" into /^role_picker:(?<roleId>[^:]+)$/ */
export const compilePattern = (pattern: string): RegExp => {
  let source = "^"
  let lastIndex = 0

  for (const match of pattern.matchAll(PARAM_REGEX)) {
    source += escapeRegex(pattern.slice(lastIndex, match.index))
    source += `(?<${match[1]}>[^:]+)`
    lastIndex = match.index + match[0].length
  }

  source += escapeRegex(pattern.slice(lastIndex)) + "$"
  return new RegExp(source)
}

/** Builds a concrete customId from a pattern and its params. */
export const buildCustomId = <P extends string>(pattern: P, params: PatternParams<P>): string => {
  return pattern.replace(PARAM_REGEX, (_, name: string) => {
    const value = (params as Record<string, string>)[name]
    if (value === undefined) throw new Error(`customId: missing param "${name}" for "${pattern}"`)
    if (value.includes(":")) throw new Error(`customId: param "${name}" cannot contain ":"`)
    return value
  })
}

// ===== DEFINITIONS =====

export type ComponentKind = "button" | "select" | "modal"

export interface ComponentDefinition {
  kind: ComponentKind
  pattern: string
  regex: RegExp
  handler: (ctx: never, params: Record<string, string>) => unknown
}

// ===== BUILDERS =====

abstract class BaseComponent<P extends string, I extends { reply(options: unknown): Promise<unknown> }> {
  abstract readonly kind: ComponentKind
  private handler?: (ctx: GlyriaContext<I>, params: PatternParams<P>) => unknown

  constructor(readonly pattern: P) {}

  execute(handler: (ctx: GlyriaContext<I>, params: PatternParams<P>) => unknown): this {
    this.handler = handler
    return this
  }

  /** Builds a concrete customId for this component (use when rendering). */
  id(params: PatternParams<P>): string {
    return buildCustomId(this.pattern, params)
  }

  build(): ComponentDefinition {
    if (!this.handler) throw new Error(`component "${this.pattern}" has no execute() handler`)
    return {
      kind: this.kind,
      pattern: this.pattern,
      regex: compilePattern(this.pattern),
      handler: this.handler as unknown as ComponentDefinition["handler"],
    }
  }
}

export class GlyriaButton<P extends string = string> extends BaseComponent<P, ButtonInteraction> {
  readonly kind = "button" as const
}

export class GlyriaSelect<P extends string = string> extends BaseComponent<
  P,
  AnySelectMenuInteraction
> {
  readonly kind = "select" as const
}

export class GlyriaModal<P extends string = string> extends BaseComponent<
  P,
  ModalSubmitInteraction
> {
  readonly kind = "modal" as const
}
