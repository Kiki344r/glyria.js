// src/core/commandDiff.ts

export interface NamedCommand {
  name: string
  [key: string]: unknown
}

export interface CommandsDiff {
  added: string[]
  removed: string[]
  changed: string[]
}

export const diffCommandBodies = (prev: NamedCommand[], next: NamedCommand[]): CommandsDiff => {
  const prevByName = new Map(prev.map((c) => [c.name, JSON.stringify(c)]))
  const nextByName = new Map(next.map((c) => [c.name, JSON.stringify(c)]))

  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []

  for (const [name, json] of nextByName) {
    const before = prevByName.get(name)
    if (before === undefined) added.push(name)
    else if (before !== json) changed.push(name)
  }

  for (const name of prevByName.keys()) {
    if (!nextByName.has(name)) removed.push(name)
  }

  return { added, removed, changed }
}

export const isDiffEmpty = (diff: CommandsDiff): boolean =>
  !diff.added.length && !diff.removed.length && !diff.changed.length
