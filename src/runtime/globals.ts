import { GlyriaClient, globalBus } from "../core/client.js"
import {
  GlyriaCommand,
  GlyriaUserCommand,
  GlyriaMessageCommand,
} from "../builders/commandBuilder.js"
import { GlyriaEvent } from "../builders/eventBuilder.js"
import { EmbedV2Builder } from "../builders/embedV2Builder.js"
import { GlyriaButton, GlyriaSelect, GlyriaModal } from "../builders/componentBuilder.js"
import { defineGlyriaConfig } from "../core/config.js"
import { defineModule, defineCommand, defineEvent, defineHook } from "../sdk/defineModule.js"
import { createTestContext } from "../sdk/testContext.js"
import { useStore } from "../core/store.js"
import { canvas } from "../core/canvas/index.js"
import { Events } from "discord.js"
import { createReplyableContext } from "../core/context/ReplyableContext.js"
import { hexToNumber } from "../utils/hexToNumber.js"
import { GlyriaBus } from "../core/bus.js"
import * as djs from "discord.js"
import { useCommands } from "../builders/commandBuilder.js"
import { logger } from "../core/logger.js"

Object.assign(globalThis, {
  defineGlyriaConfig,
  GlyriaClient,
  Events,
  GlyriaCommand,
  GlyriaUserCommand,
  GlyriaMessageCommand,
  GlyriaEvent,
  EmbedV2Builder,
  createReplyableContext,
  hexToNumber,
  GlyriaBus,
  globalBus,
  djs,
  useCommands,
  logger,
  GlyriaButton,
  GlyriaSelect,
  GlyriaModal,
  defineModule,
  defineCommand,
  defineEvent,
  defineHook,
  createTestContext,
  useStore,
  canvas,
})
