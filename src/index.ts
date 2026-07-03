export { defineGlyriaConfig } from "./core/config.js"
export { GlyriaClient } from "./core/client.js"
export {
  GlyriaCommand,
  GlyriaUserCommand,
  GlyriaMessageCommand,
  useCommands,
} from "./builders/commandBuilder.js"
export { GlyriaEvent } from "./builders/eventBuilder.js"
export { EmbedV2Builder } from "./builders/embedV2Builder.js"
export {
  GlyriaButton,
  GlyriaSelect,
  GlyriaModal,
  buildCustomId,
  compilePattern,
} from "./builders/componentBuilder.js"
export type { PatternParams, ComponentDefinition } from "./builders/componentBuilder.js"
export {
  GlyriaStore,
  MemoryStoreAdapter,
  JsonFileStoreAdapter,
  configureStore,
  useStore,
} from "./core/store.js"
export type { StoreAdapter, ScopedStore, StoreConfig } from "./core/store.js"
export { canvas, GlyriaCanvasImage, xmlEscape } from "./core/canvas/index.js"
export type {
  GlyriaCanvas,
  RankCardOptions,
  LeaderboardOptions,
  LeaderboardEntry,
} from "./core/canvas/index.js"
export { recordInteraction, readRecording, listRecordings } from "./core/recorder.js"
export type { RecordedInteraction } from "./core/recorder.js"
export { diffCommandBodies, isDiffEmpty } from "./core/commandDiff.js"
export type { CommandsDiff } from "./core/commandDiff.js"
export type { AutocompleteHandler, AutocompleteChoice } from "./builders/commandBuilder.js"
export { createReplyableContext } from "./core/context/ReplyableContext.js"
export { GatewayIntentBits } from "discord.js"

export type { GlyriaConfig } from "./core/config.js"
export type {
  GlyriaContext,
  GlyriaG,
  ReplyOptions,
  ConfirmOptions,
  PaginateOptions,
  LoadingOptions,
  ReplyChain,
  ReplyVariant,
  SentEntry,
  Replyable,
} from "./core/context/ReplyableContext.js"
export type {
  CommandGuards,
  CooldownInput,
  PermissionName,
} from "./core/guards.js"
export { parseDuration, formatDuration } from "./utils/duration.js"
export type { Duration } from "./utils/duration.js"
export { Events } from "discord.js"

export { hexToNumber } from "./utils/hexToNumber.js"
export { GlyriaBus } from "./core/bus.js"

export { globalBus } from "./core/client.js"
export { logger } from "./core/logger.js"

// ===== MODULE SDK =====
export {
  defineModule,
  defineCommand,
  defineEvent,
  defineHook,
  isModuleDefinition,
} from "./sdk/defineModule.js"
export type {
  ModuleDefinition,
  ModuleContext,
  ModuleHooks,
  ModuleLogger,
  CommandRunMeta,
  CommandMiddleware,
  ConfigSchema,
  GlyriaModules,
  ModuleRegistryAccess,
} from "./sdk/defineModule.js"
export { createTestContext } from "./sdk/testContext.js"
export type { TestContext, TestContextOptions, CapturedReply } from "./sdk/testContext.js"
export { ModuleManager, resolveLoadOrder } from "./managers/modules.js"
export type { ModuleStatus, LoadedModule } from "./managers/modules.js"
